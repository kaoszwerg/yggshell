//! The unit an offset is counted in when it crosses to the webview.
//!
//! **The boundary counts UTF-16 code units. Rust counts bytes. This is where they meet.**
//!
//! Every offset the frontend has comes from one of two places, and both of them are UTF-16:
//! `node.position.start.offset`, which the markdown parser reports as an index into the JavaScript
//! string, and `textarea.setSelectionRange`, which is the only way to put a caret anywhere. Neither
//! can be made to count anything else — a JavaScript string *is* a sequence of UTF-16 code units.
//!
//! Rust's are bytes, because `&str` is UTF-8 and every slice of one is taken in bytes.
//!
//! For ASCII the two numbers are identical, which is why this went unnoticed: `- [ ] one` counts the
//! same either way. One German word breaks it — `Grüße` is five code units and seven bytes — and
//! every task below one became unreachable, reported to the user as *"that item is no longer a
//! task"* about an item plainly sitting there. Pinned by
//! `tests::ticking_a_task_below_an_umlaut_uses_the_offset_the_view_actually_has`.
//!
//! **The conversion belongs on this side.** The frontend cannot choose its unit; this side holds the
//! string and can walk it. Doing it in JavaScript would mean `TextEncoder` on every keystroke to
//! recover a number Rust already has.

/// The byte index of the UTF-16 code-unit offset `at`.
///
/// `None` when the offset runs past the end of the text, or lands **inside** a character — which is
/// what a stale view looks like once the file has changed underneath it. Refusing is the point: the
/// caller rewrites bytes at this position, and guessing a nearby boundary is how a note quietly loses
/// a letter.
pub fn to_byte(text: &str, at: usize) -> Option<usize> {
    let mut units = 0usize;
    for (byte, character) in text.char_indices() {
        if units == at {
            return Some(byte);
        }
        if units > at {
            // Landed inside a surrogate pair — an offset that was never a boundary.
            return None;
        }
        units += character.len_utf16();
    }
    // The very end is a valid position: a caret sits after the last character.
    if units == at {
        Some(text.len())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_counts_the_same_in_both_units() {
        // The reason the defect hid for as long as it did: for the text everything was tested with,
        // the two numbers are equal.
        assert_eq!(to_byte("- [ ] one", 0), Some(0));
        assert_eq!(to_byte("- [ ] one", 6), Some(6));
        assert_eq!(to_byte("- [ ] one", 9), Some(9));
    }

    #[test]
    fn a_two_byte_character_moves_the_byte_index_and_not_the_offset() {
        // `ü` and `ß` are one UTF-16 code unit each and two bytes each.
        let text = "Grüße";
        assert_eq!(to_byte(text, 2), Some(2)); // before ü
        assert_eq!(to_byte(text, 3), Some(4)); // before ß
        assert_eq!(to_byte(text, 4), Some(6)); // before e
        assert_eq!(to_byte(text, 5), Some(7)); // the end
    }

    #[test]
    fn an_emoji_is_two_code_units_and_four_bytes() {
        // Outside the basic plane the frontend's own unit stops being one-per-character too, so this
        // is the case that a naive `chars().take(at)` would get wrong in the opposite direction.
        let text = "a🌱b";
        assert_eq!(to_byte(text, 1), Some(1)); // before the emoji
        assert_eq!(to_byte(text, 3), Some(5)); // before b — the emoji spent two units, four bytes
        assert_eq!(to_byte(text, 4), Some(6)); // the end
    }

    #[test]
    fn an_offset_inside_a_character_or_past_the_end_is_refused() {
        // A stale view, not a licence to rewrite bytes at whatever position is nearest.
        assert_eq!(to_byte("a🌱b", 2), None); // between the emoji's two code units
        assert_eq!(to_byte("Grüße", 6), None); // past the end
        assert_eq!(to_byte("", 1), None);
        assert_eq!(to_byte("", 0), Some(0));
    }
}
