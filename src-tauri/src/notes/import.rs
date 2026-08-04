//! Taking markdown somebody else wrote — and the pictures it points at — into the notes repository.
//!
//! **Copying the file is the easy half.** A note whose images stayed behind is a note full of broken
//! pictures on the second machine, which is exactly what a synced repository exists to prevent. So
//! every local image the file refers to is copied into the project's own `assets/` and the link is
//! rewritten to point there, the same shape a pasted screenshot already gets (`images::add`).
//!
//! **The half that matters is what is NOT copied.** A markdown file is content that arrives from
//! anywhere, and the destination is a repository that is **pushed to a remote**. A reference like
//! `![](../../.ssh/id_rsa)` is therefore not an odd edge case, it is the abuse case: without a check,
//! importing an offered file would put a private key somewhere it can never be taken back from.
//!
//! So an image is copied **only when it resolves under the source file's own directory**. Anything
//! else keeps its link, is never read, and is named in the report. That is `rule:security`'s
//! canonicalise-and-verify-against-a-root, applied to a root that is chosen per file rather than
//! fixed (ADR-PROJ-004).
//!
//! Two more things follow from the same reasoning:
//!
//! - **An image nobody references is not copied.** Sweeping a whole folder in would import files
//!   that `images::orphans` immediately reports as unreferenced — a mess the user did not make.
//! - **Nothing is fetched.** A remote image keeps its URL and stays subject to the press-to-load rule
//!   the reader already applies.
//!
//! The path of a *source* is named by the frontend, which is the one place that is allowed: the user
//! picked it in a native dialog the **backend** opened, it is only ever read, and where the result is
//! written is still derived here and nowhere else.

use super::images;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// The largest markdown file taken in, in bytes. A note is text; anything past this is a data file
/// that happens to end in `.md`.
const MAX_NOTE: u64 = 2 * 1024 * 1024;

/// The largest image copied in, in bytes.
///
/// Well above the 4 MB that still renders inline (`images::MAX_INLINE`) — a photograph that has to be
/// opened in a viewer is still a legitimate part of a note — but not so far that a video ends up in a
/// repository that is pushed on every edit.
const MAX_IMAGE: u64 = 64 * 1024 * 1024;

/// What became of one source file.
#[derive(Debug, Clone)]
pub struct Entry {
    /// The file, as the user would recognise it in the dialog they picked it from.
    pub file: String,
    /// The topic it became, or `None` when nothing was written.
    pub topic: Option<String>,
    /// How many images were copied in with it.
    pub images: usize,
    /// Everything deliberately not done, in words the user can act on.
    ///
    /// **Never empty by accident.** A skipped image and a skipped file are both reported; an import
    /// that silently did less than it appeared to is indistinguishable from a broken one
    /// (`rule:logging`).
    pub skipped: Vec<String>,
}

impl Entry {
    fn refused(source: &Path, why: String) -> Self {
        Self {
            file: name_of(source),
            topic: None,
            images: 0,
            skipped: vec![why],
        }
    }
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string())
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
}

/// Import every source the user picked into `project`.
///
/// A source is either a markdown file or a directory, in which case every markdown file **directly**
/// inside it is taken. Not recursive: a subfolder would have to be flattened, which collides, or
/// mapped onto nested projects, which is a naming policy nobody asked for.
///
/// One source failing never stops the others — **this cannot fail as a whole**, which is why it
/// returns a report rather than a `Result`: every refusal belongs to one file and is that file's
/// entry, and an early `Err` would throw away what had already been imported.
pub fn run(root: &Path, project: &str, sources: &[PathBuf], stamp: &str) -> Vec<Entry> {
    let mut entries = Vec::new();
    let mut copied: HashMap<PathBuf, String> = HashMap::new();

    for source in sources {
        if source.is_dir() {
            let Ok(listing) = std::fs::read_dir(source) else {
                entries.push(Entry::refused(source, "could not be read".into()));
                continue;
            };
            let mut files: Vec<PathBuf> = listing
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_file() && is_markdown(path))
                .collect();
            // Sorted, so the numbering of the copied images is the same on every machine and a
            // second import of the same folder is comparable to the first.
            files.sort();
            for file in files {
                entries.push(one(root, project, &file, stamp, &mut copied));
            }
            continue;
        }
        entries.push(one(root, project, source, stamp, &mut copied));
    }

    tracing::info!(
        project,
        files = entries.len(),
        imported = entries.iter().filter(|e| e.topic.is_some()).count(),
        images = entries.iter().map(|e| e.images).sum::<usize>(),
        skipped = entries.iter().map(|e| e.skipped.len()).sum::<usize>(),
        "notes import"
    );
    entries
}

fn one(
    root: &Path,
    project: &str,
    source: &Path,
    stamp: &str,
    copied: &mut HashMap<PathBuf, String>,
) -> Entry {
    if !is_markdown(source) {
        return Entry::refused(
            source,
            format!("{} is not a markdown file", name_of(source)),
        );
    }
    let Ok(source) = source.canonicalize() else {
        return Entry::refused(source, format!("{} is no longer there", name_of(source)));
    };
    match std::fs::metadata(&source) {
        Ok(meta) if meta.len() > MAX_NOTE => {
            return Entry::refused(
                &source,
                format!(
                    "{} is larger than a note ({} bytes)",
                    name_of(&source),
                    meta.len()
                ),
            );
        }
        Ok(_) => {}
        Err(error) => return Entry::refused(&source, error.to_string()),
    }
    let Ok(text) = std::fs::read_to_string(&source) else {
        return Entry::refused(&source, format!("{} is not text", name_of(&source)));
    };

    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let topic = match super::safe_segment(&stem) {
        Ok(topic) => topic,
        Err(error) => return Entry::refused(&source, error.to_string()),
    };

    // Refused, never merged and never clobbered: a note is the one thing here that cannot be
    // regenerated, so an existing one is the user's to resolve.
    match super::note_path(root, project, &topic) {
        Ok(path) if path.exists() => {
            return Entry::refused(&source, format!("a note called {topic} is already there"));
        }
        Ok(_) => {}
        Err(error) => return Entry::refused(&source, error.to_string()),
    }

    let base = source.parent().unwrap_or(&source).to_path_buf();
    let rewritten = rewrite(root, project, &text, &base, stamp, copied);

    if let Err(error) = super::write(root, project, &topic, &rewritten.text) {
        return Entry::refused(&source, error.to_string());
    }

    Entry {
        file: name_of(&source),
        topic: Some(topic),
        images: rewritten.images,
        skipped: rewritten.skipped,
    }
}

struct Rewritten {
    text: String,
    images: usize,
    skipped: Vec<String>,
}

/// Copy every local image the text points at, and point the text at the copies.
fn rewrite(
    root: &Path,
    project: &str,
    text: &str,
    base: &Path,
    stamp: &str,
    copied: &mut HashMap<PathBuf, String>,
) -> Rewritten {
    let mut out = String::with_capacity(text.len());
    let mut images = 0usize;
    let mut skipped = Vec::new();
    let mut cursor = 0usize;
    // Built once per file, and only if something actually needs it.
    let mut names: Option<HashMap<String, Vec<PathBuf>>> = None;

    for span in targets(text) {
        let Some(raw) = text.get(span.start..span.end) else {
            continue;
        };
        out.push_str(text.get(cursor..span.start).unwrap_or_default());
        cursor = span.end;

        let literal = resolve(base, raw);
        // **The literal path did not land inside the note's folder — try its NAME there instead.**
        // A markdown file exported by a Windows editor carries `C:\Users\…\Images\shot.png`, which
        // is an absolute path on a machine that is not this one; the picture itself travelled along
        // in `Images/` beside the note. The search never leaves the note's own folder, so an
        // absolute path is only ever a hint about a name and never a way out of it.
        let resolved = match literal {
            Resolved::Missing(_) | Resolved::Outside(_) => {
                let index = names.get_or_insert_with(|| index_by_name(base));
                by_name(index, raw).unwrap_or(literal)
            }
            other => other,
        };

        match resolved {
            Resolved::Remote | Resolved::NotAPath => out.push_str(raw),
            Resolved::Outside(what) => {
                skipped.push(format!(
                    "{what} is outside the note's own folder — left as a link"
                ));
                out.push_str(raw);
            }
            Resolved::TooBig(what, size) => {
                skipped.push(format!("{what} is {size} bytes — too large to bring in"));
                out.push_str(raw);
            }
            Resolved::Missing(what) => {
                skipped.push(format!("{what} was not found next to the note"));
                out.push_str(raw);
            }
            Resolved::Ambiguous(what, count) => {
                skipped.push(format!(
                    "more than one file next to the note is called {what} ({count}) — none taken"
                ));
                out.push_str(raw);
            }
            Resolved::Local(path) => {
                if let Some(already) = copied.get(&path) {
                    out.push_str(already);
                    continue;
                }
                // A stamp per image: one timestamp for the whole import would let two screenshots
                // called `shot.png` from different folders overwrite each other in silence.
                match images::add(root, project, &path, &format!("{stamp}-{}", copied.len())) {
                    Ok(rel) => {
                        images += 1;
                        out.push_str(&rel);
                        copied.insert(path, rel);
                    }
                    Err(error) => {
                        skipped.push(error.to_string());
                        out.push_str(raw);
                    }
                }
            }
        }
    }
    out.push_str(text.get(cursor..).unwrap_or_default());

    Rewritten {
        text: out,
        images,
        skipped,
    }
}

enum Resolved {
    /// An https/http target, or any other scheme. Kept verbatim; nothing is ever fetched here.
    Remote,
    /// An anchor, an empty target — nothing that names a file.
    NotAPath,
    /// Exists, and lies under the note's own directory.
    Local(PathBuf),
    /// Exists, and does not. **This is the one the whole module is built around.**
    Outside(String),
    /// Under the note's directory, but too big to belong in a repository that is pushed.
    TooBig(String, u64),
    Missing(String),
    /// Several files under the note's folder carry the name the link ends in.
    Ambiguous(String, usize),
}

/// How deep the name search goes under the note's folder, and how many files it will look at.
///
/// Bounded because the folder is the user's and could be anything — an export beside a
/// `node_modules`, a Downloads folder somebody picked a file out of. Deep enough for the shapes this
/// exists for (`Images/`, `media/`, `<note>.assets/`), and it stops rather than crawling a disk.
const NAME_DEPTH: usize = 4;
const NAME_BUDGET: usize = 20_000;

/// Every file under `base`, by file name, so a link that only gets the name right can still be met.
fn index_by_name(base: &Path) -> HashMap<String, Vec<PathBuf>> {
    let mut out: HashMap<String, Vec<PathBuf>> = HashMap::new();
    let mut budget = NAME_BUDGET;
    walk_names(base, 0, &mut budget, &mut out);
    out
}

fn walk_names(
    dir: &Path,
    depth: usize,
    budget: &mut usize,
    out: &mut HashMap<String, Vec<PathBuf>>,
) {
    if depth > NAME_DEPTH || *budget == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let path = entry.path();
        if path.is_dir() {
            walk_names(&path, depth + 1, budget, out);
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            out.entry(name.to_lowercase()).or_default().push(path);
        }
    }
}

/// The file the link's **name** points at, inside the note's own folder.
///
/// `None` when the link names nothing usable; otherwise the outcome, including the deliberate
/// refusal when two files share the name — copying the wrong picture is worse than copying none,
/// because it is wrong *silently* and the note reads as finished.
fn by_name(index: &HashMap<String, Vec<PathBuf>>, raw: &str) -> Option<Resolved> {
    let decoded = percent_decode(raw.trim());
    // Both separators: the whole point is a path written on another operating system.
    let name = decoded.rsplit(['/', '\\']).next()?.trim().to_string();
    if name.is_empty() {
        return None;
    }
    let found = index.get(&name.to_lowercase())?;
    if found.len() > 1 {
        return Some(Resolved::Ambiguous(name, found.len()));
    }
    let path = found.first()?;
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() > MAX_IMAGE => Some(Resolved::TooBig(name, meta.len())),
        Ok(meta) if meta.is_file() => Some(Resolved::Local(path.clone())),
        _ => None,
    }
}

fn resolve(base: &Path, raw: &str) -> Resolved {
    let target = raw.trim();
    if target.is_empty() || target.starts_with('#') {
        return Resolved::NotAPath;
    }
    // **`file:` is not remote.** Word and Outlook paste `file:///C:/Users/…/Temp/msohtmlclip1/…png`
    // into markdown, and that is a local path from another machine, not a server. Treating it as
    // remote left it verbatim *and* unreported — a dead link the reader meets with no hint that
    // anything was skipped, since `open_external` refuses every scheme but http(s). Reported as
    // missing means the name fallback below gets its chance, and if that finds nothing the user is
    // told about it.
    if target.starts_with("file:") {
        return Resolved::Missing(percent_decode(target));
    }
    if target.contains("://") || target.starts_with("mailto:") || target.starts_with("data:") {
        return Resolved::Remote;
    }

    let decoded = percent_decode(target);
    let joined = base.join(&decoded);
    let Ok(canonical) = joined.canonicalize() else {
        return Resolved::Missing(decoded);
    };
    // The check this module exists for. `base` is canonicalised too, or a symlinked source folder
    // would compare against a path that never matches and every image would look "outside".
    let Ok(root) = base.canonicalize() else {
        return Resolved::Missing(decoded);
    };
    if !canonical.starts_with(&root) {
        return Resolved::Outside(decoded);
    }
    match std::fs::metadata(&canonical) {
        Ok(meta) if meta.len() > MAX_IMAGE => Resolved::TooBig(decoded, meta.len()),
        Ok(meta) if meta.is_file() => Resolved::Local(canonical),
        _ => Resolved::Missing(decoded),
    }
}

/// `%20` and friends. Every markdown editor writes a screenshot's spaces that way, and macOS names
/// screenshots with spaces — so not decoding this makes the commonest pasted image in existence look
/// missing.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut at = 0usize;
    while at < bytes.len() {
        let byte = bytes.get(at).copied().unwrap_or(b'%');
        if byte == b'%' && at + 2 < bytes.len() {
            let high = text
                .get(at + 1..at + 3)
                .and_then(|pair| u8::from_str_radix(pair, 16).ok());
            if let Some(value) = high {
                out.push(value);
                at += 3;
                continue;
            }
        }
        out.push(byte);
        at += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_string())
}

/// The byte range of one image target inside the source.
struct Span {
    start: usize,
    end: usize,
}

/// Every image target in the text, in order.
///
/// Two forms, because both are ordinary markdown and a rewriter that knew only the first would
/// silently leave half the pictures behind:
///
/// - inline — `![alt](path)`, `![alt](path "title")`, `![alt](<path>)`;
/// - a reference definition — `[id]: path "title"` on its own line, which `![alt][id]` points at.
///
/// Only the **path** is spanned, never the title or the brackets, so the rewrite puts the new path
/// exactly where the old one was and leaves everything else byte for byte.
fn targets(text: &str) -> Vec<Span> {
    let mut spans = inline_targets(text);
    spans.extend(definition_targets(text));
    spans.sort_by_key(|span| span.start);
    spans
}

fn inline_targets(text: &str) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut at = 0usize;
    while let Some(found) = text.get(at..).and_then(|rest| rest.find("![")) {
        let open = at + found;
        let after_alt = open + 2;
        let Some(close) = text.get(after_alt..).and_then(|rest| rest.find("](")) else {
            break;
        };
        // An alt text spanning a line break is not an image, it is a stray `![`.
        if text
            .get(after_alt..after_alt + close)
            .is_some_and(|alt| alt.contains('\n'))
        {
            at = after_alt;
            continue;
        }
        let start = after_alt + close + 2;
        let Some(end_rel) = text.get(start..).and_then(|rest| rest.find(')')) else {
            break;
        };
        let end = start + end_rel;
        if let Some(span) = path_within(text, start, end) {
            spans.push(span);
        }
        at = end + 1;
    }
    spans
}

fn definition_targets(text: &str) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut line_start = 0usize;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        if let Some(close) = trimmed.find("]:") {
            if trimmed.starts_with('[') && !trimmed[1..close].contains('\n') {
                let after = line_start + indent + close + 2;
                let rest = text.get(after..line_start + line.len()).unwrap_or_default();
                let lead = rest.len() - rest.trim_start().len();
                let value = rest.trim_start();
                let end = path_end(value);
                if end > 0 {
                    spans.push(Span {
                        start: after + lead,
                        end: after + lead + end,
                    });
                }
            }
        }
        line_start += line.len();
    }
    spans
}

/// Narrow `start..end` down to the path itself, dropping a `<…>` wrapper or a `"title"` after it.
fn path_within(text: &str, start: usize, end: usize) -> Option<Span> {
    let raw = text.get(start..end)?;
    let lead = raw.len() - raw.trim_start().len();
    let body = raw.trim_start();
    if let Some(rest) = body.strip_prefix('<') {
        let close = rest.find('>')?;
        return Some(Span {
            start: start + lead + 1,
            end: start + lead + 1 + close,
        });
    }
    let stop = path_end(body);
    if stop == 0 {
        return None;
    }
    Some(Span {
        start: start + lead,
        end: start + lead + stop,
    })
}

/// How much of `body` is the path, given that a title may follow it.
///
/// **A space does not end a path.** CommonMark says it should — a path with spaces belongs in
/// `<angle brackets>` — but the editors people actually export from do not write it that way:
/// Typora on Windows emits `C:\Users\…\OneDrive - Firma\Images\shot.png` verbatim, and macOS names
/// screenshots with spaces. Cutting at the first space made 37 pictures in one real import
/// unresolvable **and** would have written the remainder of each path into the note as prose.
///
/// A title is what ends a path, and a title is quoted: only whitespace **followed by a quote** counts
/// as the end.
fn path_end(body: &str) -> usize {
    for (at, character) in body.char_indices() {
        if !character.is_whitespace() {
            continue;
        }
        let rest = body.get(at..).unwrap_or_default().trim_start();
        if rest.starts_with('"') || rest.starts_with('\'') || rest.starts_with('(') {
            return body.get(..at).unwrap_or_default().trim_end().len();
        }
    }
    body.trim_end().len()
}
