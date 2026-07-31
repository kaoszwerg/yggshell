//! Reading an iTerm2 colour scheme (`.itermcolors`).
//!
//! **Parsed here rather than with an XML crate, and that is a security decision, not a size one.**
//! An `.itermcolors` file is an Apple XML plist, and every one of them opens with
//! `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/…">`. A general
//! XML parser is a machine for resolving exactly that sort of thing — external entities, nested entity
//! expansion, DTDs — and the file in question is one a user downloaded from the internet and dropped
//! onto the window. This reader resolves nothing: it walks tags, reads the text between them, and
//! understands five element names. There is no entity to expand, so the class of attack does not
//! exist rather than being configured away.
//!
//! The structure it needs is flat and completely regular:
//!
//! ```xml
//! <key>Ansi 0 Color</key>
//! <dict>
//!   <key>Red Component</key><real>0.0</real>
//!   <key>Green Component</key><real>0.0</real>
//!   <key>Blue Component</key><real>0.0</real>
//! </dict>
//! ```
//!
//! Components are 0–1 floats. Anything else in the file — `Alpha Component`, `Color Space`, keys we
//! do not know — is skipped rather than rejected: schemes in the wild carry extras, and refusing a
//! perfectly usable palette over a field nobody reads would be the wrong trade.

use crate::error::{AppError, Result};
use std::collections::HashMap;

/// Largest scheme we will read. A real one is a few kilobytes; this is three orders of magnitude of
/// headroom and still bounds what a hostile file can make us allocate.
pub const MAX_BYTES: usize = 1024 * 1024;

/// One colour, as the parser found it: 0–1 components.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Component {
    red: f64,
    green: f64,
    blue: f64,
}

impl Component {
    /// `#rrggbb`. Values are clamped rather than trusted: a hand-edited file can hold `2.0`, and a
    /// wrapped byte would be a wrong colour presented as a right one.
    fn to_hex(self) -> String {
        let channel = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        format!(
            "#{:02x}{:02x}{:02x}",
            channel(self.red),
            channel(self.green),
            channel(self.blue)
        )
    }
}

/// Every colour a scheme defines, keyed by its plist name (`Ansi 0 Color`, `Background Color`, …).
pub type Colours = HashMap<String, String>;

/// Parse the colours out of an `.itermcolors` document.
///
/// Fails only when the document has no colours at all — at that point it is not a colour scheme,
/// whatever it is, and importing it would leave the user with an entry that does nothing.
pub fn parse(xml: &str) -> Result<Colours> {
    let mut colours = Colours::new();
    let mut scanner = Scanner::new(xml);
    // Depth relative to the top-level dict, so a `<key>` inside a colour's own dict is never mistaken
    // for the name of the next colour.
    let mut pending_name: Option<String> = None;

    while let Some(event) = scanner.next_event() {
        match event {
            Event::Key(name) => pending_name = Some(name),
            Event::DictStart => {
                if let Some(name) = pending_name.take() {
                    if let Some(colour) = read_colour(&mut scanner) {
                        colours.insert(name, colour.to_hex());
                    }
                }
            }
            // A `<string>`/`<real>` at the top level belongs to a key we do not care about.
            Event::Other => pending_name = None,
            Event::DictEnd => {}
        }
    }

    if colours.is_empty() {
        return Err(AppError::Other(
            "not an iTerm2 colour scheme: no colours found".into(),
        ));
    }
    Ok(colours)
}

/// Read one colour dict, consuming it up to and including its `</dict>`.
fn read_colour(scanner: &mut Scanner<'_>) -> Option<Component> {
    let mut red = None;
    let mut green = None;
    let mut blue = None;
    let mut pending: Option<String> = None;
    let mut depth = 0usize;

    loop {
        match scanner.next_event()? {
            Event::DictStart => depth += 1,
            Event::DictEnd => {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            }
            Event::Key(name) => pending = Some(name),
            Event::Other => {
                let value = scanner.take_text();
                let Some(name) = pending.take() else { continue };
                let parsed = value.trim().parse::<f64>().ok();
                match name.as_str() {
                    "Red Component" => red = parsed,
                    "Green Component" => green = parsed,
                    "Blue Component" => blue = parsed,
                    _ => {}
                }
            }
        }
    }

    // A dict missing a channel is not a colour. Treated as absent rather than as black: a silently
    // black entry in a palette is worse than a missing one, because nobody notices it is wrong.
    Some(Component {
        red: red?,
        green: green?,
        blue: blue?,
    })
}

/// What the scanner reports. Deliberately tiny — everything else in the document is skipped.
enum Event {
    Key(String),
    DictStart,
    DictEnd,
    /// A `<real>`, `<integer>` or `<string>`; its text is read separately by the caller that wants it.
    Other,
}

/// A tag walker, not an XML parser.
///
/// It knows five element names and reads the text between tags literally. It resolves no entities,
/// follows no DTD, and understands no attributes — see the module header for why that is the point.
struct Scanner<'a> {
    input: &'a str,
    at: usize,
    /// Text collected between the last tag and the one after it.
    text: String,
}

impl<'a> Scanner<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            input,
            at: 0,
            text: String::new(),
        }
    }

    /// The text that preceded the current position, with the five XML predefined entities resolved.
    ///
    /// Only those five, and only as literal replacements — no numeric references, no expansion of
    /// anything a document could define. A colour component never needs one; this exists so a
    /// `<string>` value is not silently mangled.
    fn take_text(&mut self) -> String {
        let raw = std::mem::take(&mut self.text);
        raw.replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&")
    }

    fn next_event(&mut self) -> Option<Event> {
        loop {
            let rest = self.input.get(self.at..)?;
            let open = rest.find('<')?;
            self.text.push_str(rest.get(..open).unwrap_or(""));
            let after = self.at + open + 1;
            let tail = self.input.get(after..)?;
            let close = tail.find('>')?;
            let tag = tail.get(..close).unwrap_or("").trim();
            self.at = after + close + 1;

            // Comments, declarations, the DOCTYPE and processing instructions are skipped whole. The
            // DOCTYPE is never read, let alone followed.
            if tag.starts_with('!') || tag.starts_with('?') {
                continue;
            }

            let name = tag.trim_end_matches('/').trim();
            let name = name.split_whitespace().next().unwrap_or("");
            match name {
                "key" => {
                    self.text.clear();
                    let value = self.read_until_close("key");
                    return Some(Event::Key(value));
                }
                "dict" => {
                    self.text.clear();
                    // A self-closing `<dict/>` opens and closes in one tag; reporting only the start
                    // would leave the reader waiting for an end that never comes.
                    if tag.ends_with('/') {
                        continue;
                    }
                    return Some(Event::DictStart);
                }
                "/dict" => {
                    self.text.clear();
                    return Some(Event::DictEnd);
                }
                "real" | "integer" | "string" => {
                    self.text.clear();
                    if tag.ends_with('/') {
                        return Some(Event::Other);
                    }
                    let value = self.read_until_close(name);
                    self.text = value;
                    return Some(Event::Other);
                }
                _ => {
                    self.text.clear();
                    continue;
                }
            }
        }
    }

    /// Everything up to `</name>`, returned with entities resolved.
    fn read_until_close(&mut self, name: &str) -> String {
        let end = format!("</{name}>");
        let rest = self.input.get(self.at..).unwrap_or("");
        match rest.find(&end) {
            Some(at) => {
                self.text = rest.get(..at).unwrap_or("").to_string();
                self.at += at + end.len();
                self.take_text()
            }
            None => {
                // Unterminated: consume the rest rather than looping. A truncated file yields what it
                // has, and the caller decides whether that is a scheme.
                self.text = rest.to_string();
                self.at = self.input.len();
                self.take_text()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal but honest scheme: two ANSI colours and a background, in the exact shape iTerm2
    /// writes — DOCTYPE, alpha components, colour space and all.
    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Ansi 0 Color</key>
	<dict>
		<key>Alpha Component</key>
		<real>1</real>
		<key>Blue Component</key>
		<real>0.0</real>
		<key>Color Space</key>
		<string>sRGB</string>
		<key>Green Component</key>
		<real>0.0</real>
		<key>Red Component</key>
		<real>0.0</real>
	</dict>
	<key>Ansi 1 Color</key>
	<dict>
		<key>Alpha Component</key>
		<real>1</real>
		<key>Blue Component</key>
		<real>0.2</real>
		<key>Color Space</key>
		<string>sRGB</string>
		<key>Green Component</key>
		<real>0.4</real>
		<key>Red Component</key>
		<real>1.0</real>
	</dict>
	<key>Background Color</key>
	<dict>
		<key>Blue Component</key>
		<real>0.058823529411764705</real>
		<key>Green Component</key>
		<real>0.039215686274509803</real>
		<key>Red Component</key>
		<real>0.039215686274509803</real>
	</dict>
</dict>
</plist>
"#;

    #[test]
    fn reads_the_colours_a_real_scheme_defines() {
        let colours = parse(SAMPLE).expect("a scheme");
        assert_eq!(
            colours.get("Ansi 0 Color").map(String::as_str),
            Some("#000000")
        );
        assert_eq!(
            colours.get("Ansi 1 Color").map(String::as_str),
            Some("#ff6633")
        );
        assert_eq!(
            colours.get("Background Color").map(String::as_str),
            Some("#0a0a0f")
        );
        assert_eq!(colours.len(), 3, "and nothing it invented");
    }

    #[test]
    fn skips_the_fields_nobody_reads_instead_of_refusing_the_file() {
        // `Alpha Component` and `Color Space` are present in the sample and must not become colours.
        let colours = parse(SAMPLE).expect("a scheme");
        assert!(!colours.contains_key("Alpha Component"));
        assert!(!colours.contains_key("Color Space"));
    }

    #[test]
    fn a_key_inside_a_colour_is_never_mistaken_for_the_next_colour_name() {
        let colours = parse(SAMPLE).expect("a scheme");
        assert!(!colours.contains_key("Red Component"));
    }

    #[test]
    fn clamps_a_component_outside_the_range_rather_than_wrapping_it() {
        // A hand-edited file can hold anything. A wrapped byte would be a wrong colour shown as a
        // right one.
        let xml = r#"<plist><dict><key>Cursor Color</key><dict>
            <key>Red Component</key><real>2.0</real>
            <key>Green Component</key><real>-1.0</real>
            <key>Blue Component</key><real>0.5</real>
        </dict></dict></plist>"#;
        let colours = parse(xml).expect("a scheme");
        assert_eq!(
            colours.get("Cursor Color").map(String::as_str),
            Some("#ff0080")
        );
    }

    #[test]
    fn a_colour_missing_a_channel_is_dropped_rather_than_turned_black() {
        // Silently black is worse than absent: nobody notices it is wrong.
        let xml = r#"<plist><dict>
            <key>Broken</key><dict><key>Red Component</key><real>1.0</real></dict>
            <key>Cursor Color</key><dict>
                <key>Red Component</key><real>1.0</real>
                <key>Green Component</key><real>1.0</real>
                <key>Blue Component</key><real>1.0</real>
            </dict>
        </dict></plist>"#;
        let colours = parse(xml).expect("a scheme");
        assert!(!colours.contains_key("Broken"));
        assert_eq!(
            colours.get("Cursor Color").map(String::as_str),
            Some("#ffffff")
        );
    }

    #[test]
    fn a_document_with_no_colours_is_an_error_rather_than_an_empty_theme() {
        assert!(parse("<plist><dict></dict></plist>").is_err());
        assert!(parse("not xml at all").is_err());
        assert!(parse("").is_err());
    }

    #[test]
    fn a_doctype_naming_an_external_entity_is_never_followed() {
        // The reason this parser exists. A general XML reader is a machine for resolving exactly
        // this; here there is nothing to resolve, so `&xxe;` stays four characters of text.
        let xml = r#"<?xml version="1.0"?>
<!DOCTYPE plist [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<plist><dict>
  <key>Cursor Color</key>
  <dict>
    <key>Red Component</key><real>1.0</real>
    <key>Green Component</key><real>0.0</real>
    <key>Blue Component</key><real>0.0</real>
  </dict>
  <key>Note</key><string>&xxe;</string>
</dict></plist>"#;
        let colours = parse(xml).expect("a scheme");
        assert_eq!(
            colours.get("Cursor Color").map(String::as_str),
            Some("#ff0000")
        );
        assert_eq!(colours.len(), 1, "the string key is not a colour");
    }

    #[test]
    fn a_truncated_file_yields_what_it_has_instead_of_hanging() {
        let xml = r#"<plist><dict>
            <key>Cursor Color</key><dict>
                <key>Red Component</key><real>1.0</real>
                <key>Green Component</key><real>1.0</real>
                <key>Blue Component</key><real>1.0</real>
            </dict>
            <key>Half"#;
        let colours = parse(xml).expect("what it has");
        assert_eq!(
            colours.get("Cursor Color").map(String::as_str),
            Some("#ffffff")
        );
    }

    #[test]
    fn a_self_closing_dict_does_not_swallow_the_rest_of_the_document() {
        let xml = r#"<plist><dict>
            <key>Empty</key><dict/>
            <key>Cursor Color</key><dict>
                <key>Red Component</key><real>0.0</real>
                <key>Green Component</key><real>1.0</real>
                <key>Blue Component</key><real>0.0</real>
            </dict>
        </dict></plist>"#;
        let colours = parse(xml).expect("a scheme");
        assert_eq!(
            colours.get("Cursor Color").map(String::as_str),
            Some("#00ff00")
        );
    }
}
