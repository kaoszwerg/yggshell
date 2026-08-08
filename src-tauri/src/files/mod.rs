//! Listing a directory for the file browser.
//!
//! **One level at a time, never a recursive walk.** A tree that fetched everything under the working
//! directory would read `node_modules` and `target` on the first frame — hundreds of thousands of
//! entries for a panel showing twenty. Each folder is listed when it is opened, which is also what
//! keeps the tree honest: what it shows is what is there *now*, not what was there when the tab
//! opened.
//!
//! **The path is not trusted.** It arrives from the webview and is checked against the root it
//! claims to be under before anything is read (`rule:security`): a browser rooted at a project must
//! not become a way to enumerate the user's home directory by sending `../..`.

use crate::dto::DirEntry;
use crate::error::{AppError, Result};
use std::io::Read;
use std::path::{Path, PathBuf};

/// How many entries one directory may return.
///
/// A generated directory can hold a hundred thousand files, and every one of them would cross the
/// IPC boundary, be turned into a DOM node, and be sorted on the way. The cap is high enough that a
/// real source folder is never truncated, and the frontend is *told* when it happened rather than
/// quietly shown a shorter list — a truncation nobody mentions is a lie about the filesystem.
const MAX_ENTRIES: usize = 2_000;

/// One directory's entries, sorted, plus whether the listing was capped.
pub struct Listing {
    pub entries: Vec<DirEntry>,
    pub truncated: bool,
}

/// Resolve `path` and refuse anything that escapes `root`.
///
/// Both are canonicalised first: without that, `root/../root` and a symlink pointing outside would
/// both pass a string comparison. The check is on the canonical forms, which is the only version of
/// this that holds (rule:security).
fn within(root: &Path, path: &Path) -> Result<PathBuf> {
    let root = root
        .canonicalize()
        .map_err(|e| AppError::io(root.display().to_string(), e))?;
    let target = path
        .canonicalize()
        .map_err(|e| AppError::io(path.display().to_string(), e))?;
    if !target.starts_with(&root) {
        tracing::warn!(
            root = %root.display(),
            target = %target.display(),
            "refused a directory listing outside the tab's own tree"
        );
        return Err(AppError::Other(format!(
            "{} is outside {}",
            target.display(),
            root.display()
        )));
    }
    Ok(target)
}

/// Resolve a path the webview supplied and confirm it is inside `root`.
///
/// Public because revealing an item needs exactly the same check as listing one, and two copies of
/// a security check is one copy too many (ADR-CORE-005).
pub fn verify(root: &Path, path: &Path) -> Result<PathBuf> {
    within(root, path)
}

/// Hand `target` to whatever the platform opens it with.
///
/// **This starts an application chosen by the FILE**, which is exactly what `reveal` was written to
/// avoid — and the maintainer overruled that restriction deliberately (2026-08-02), after it was
/// raised: YggShell is meant to be a complete everyday environment for agentic development, a PDF or
/// an image has no inline viewer, and every terminal it competes with does this. The narrower stance
/// was defensible for a terminal and is not for a development environment.
///
/// What remains, and is not negotiable: the path is checked against the tab's own root before it gets
/// here, so nothing outside the tree on screen can be opened; the action is explicit, from a menu the
/// user chose; and it is logged. A text file has an inline viewer that runs nothing at all
/// (`read_text`) — this is for the rest.
#[cfg(target_os = "macos")]
pub fn open_default(target: &Path) -> Result<()> {
    run(
        std::process::Command::new("/usr/bin/open").arg(target.as_os_str()),
        target,
    )
}

#[cfg(target_os = "windows")]
pub fn open_default(target: &Path) -> Result<()> {
    // `explorer <path>` opens a file with its default handler, and it is what `reveal` already uses —
    // so no new program name enters the allow-list that `environment::tests` keeps deliberately short.
    // `cmd /C start "" <path>` would work too and was the first attempt; it needs a shell, needs an
    // empty window TITLE argument that reads like a mistake, and would have cost an entry on that
    // list for nothing.
    run(
        std::process::Command::new("explorer").arg(target.as_os_str()),
        target,
    )
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn open_default(target: &Path) -> Result<()> {
    run(
        std::process::Command::new("xdg-open").arg(target.as_os_str()),
        target,
    )
}

/// Show `target` in the system file manager, with the item selected.
///
/// One function per platform rather than one with three branches: each desktop says "reveal"
/// differently, and a single body would be a chain of `cfg` blocks in which only one is ever
/// compiled — which reads as dead code to every reader and to clippy (rule:cross-platform).
#[cfg(target_os = "macos")]
pub fn reveal(target: &Path) -> Result<()> {
    run(
        std::process::Command::new("/usr/bin/open").args(["-R", &target.to_string_lossy()]),
        target,
    )
}

#[cfg(target_os = "windows")]
pub fn reveal(target: &Path) -> Result<()> {
    run(
        std::process::Command::new("explorer").arg(format!("/select,{}", target.display())),
        target,
    )
}

/// No portable "reveal" exists across Linux desktops, so the containing folder is opened instead.
/// The honest degradation: the user still lands where they asked to be, without the selection.
#[cfg(all(unix, not(target_os = "macos")))]
pub fn reveal(target: &Path) -> Result<()> {
    let folder = if target.is_dir() {
        target
    } else {
        target.parent().unwrap_or(target)
    };
    run(std::process::Command::new("xdg-open").arg(folder), folder)
}

/// Run a reveal command, tagging any failure with the path it was about.
fn run(command: &mut std::process::Command, target: &Path) -> Result<()> {
    command
        .stdin(std::process::Stdio::null())
        .status()
        .map_err(|e| AppError::io(target.display().to_string(), e))?;
    Ok(())
}

/// List one directory, sorted the way a file browser sorts.
///
/// Folders before files, then case-insensitively by name — the order every file manager uses, and
/// the one a reader can scan without thinking about it. Hidden entries are included: this is a
/// developer's tool and `.github`, `.env` and `.claude` are exactly what they are looking for. The
/// frontend decides whether to show them.
pub fn list(root: &Path, path: &Path) -> Result<Listing> {
    let dir = within(root, path)?;
    let read = std::fs::read_dir(&dir).map_err(|e| AppError::io(dir.display().to_string(), e))?;

    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in read.flatten() {
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        // `file_type` does not follow symlinks, which is what we want: a link to a directory is
        // shown as a link, and following it is the user's decision, not the lister's.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let meta = entry.metadata().ok();
        entries.push(DirEntry {
            name: name.clone(),
            path: entry.path().to_string_lossy().to_string(),
            directory: kind.is_dir(),
            symlink: kind.is_symlink(),
            // A directory's byte size means nothing to a reader, so it is not reported.
            size: if kind.is_dir() {
                None
            } else {
                meta.as_ref().map(|m| m.len())
            },
            hidden: name.starts_with('.'),
        });
    }

    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    tracing::debug!(
        dir = %dir.display(),
        count = entries.len(),
        truncated,
        "listed a directory"
    );
    Ok(Listing { entries, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir(dir.path().join("src")).expect("src");
        fs::create_dir(dir.path().join(".github")).expect(".github");
        fs::write(dir.path().join("README.md"), "hi").expect("readme");
        fs::write(dir.path().join("apple.txt"), "a").expect("apple");
        fs::write(dir.path().join(".env"), "SECRET=1").expect("env");
        dir
    }

    #[test]
    fn folders_come_first_then_names_regardless_of_case() {
        let dir = fixture();
        let listing = list(dir.path(), dir.path()).expect("list");
        let names: Vec<_> = listing.entries.iter().map(|e| e.name.as_str()).collect();

        // Directories, then files; `README.md` after `apple.txt` would be wrong — a reader scanning
        // a list does not think in ASCII.
        assert_eq!(
            names,
            vec![".github", "src", ".env", "apple.txt", "README.md"]
        );
    }

    #[test]
    fn hidden_entries_are_listed_and_marked() {
        // A developer's file browser that hides `.github` and `.env` hides what they came for. The
        // frontend decides whether to show them; the backend must not decide for it.
        let dir = fixture();
        let listing = list(dir.path(), dir.path()).expect("list");
        let env = listing
            .entries
            .iter()
            .find(|e| e.name == ".env")
            .expect(".env is listed");
        assert!(env.hidden);
        assert!(!env.directory);
    }

    #[test]
    fn a_file_carries_its_size_and_a_directory_does_not() {
        let dir = fixture();
        let listing = list(dir.path(), dir.path()).expect("list");
        let readme = listing.entries.iter().find(|e| e.name == "README.md");
        let src = listing.entries.iter().find(|e| e.name == "src");

        assert_eq!(readme.and_then(|e| e.size), Some(2));
        assert_eq!(
            src.and_then(|e| e.size),
            None,
            "a directory's byte count tells a reader nothing"
        );
    }

    #[test]
    fn a_path_outside_the_root_is_refused() {
        // The path comes from the webview. A browser rooted at a project must never become a way to
        // read the home directory by sending `..` (rule:security).
        let dir = fixture();
        let root = dir.path().join("src");
        let escape = dir.path().join("src/..");

        assert!(
            list(&root, &escape).is_err(),
            "`..` must not escape the root"
        );
    }

    #[test]
    fn a_directory_that_is_not_there_is_an_error_not_an_empty_list() {
        // An empty list reads as "this folder is empty", which is a different fact entirely.
        let dir = fixture();
        assert!(list(dir.path(), &dir.path().join("nope")).is_err());
    }

    #[test]
    fn the_root_itself_is_allowed() {
        let dir = fixture();
        assert!(list(dir.path(), dir.path()).is_ok());
    }

    #[test]
    fn a_symlink_is_marked_rather_than_followed() {
        // Following it in the lister would let a link inside the project show a tree from outside
        // it, without the escape check ever seeing the real path.
        let dir = fixture();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("src"), dir.path().join("link"))
                .expect("symlink");
            let listing = list(dir.path(), dir.path()).expect("list");
            let link = listing
                .entries
                .iter()
                .find(|e| e.name == "link")
                .expect("the link is listed");
            assert!(link.symlink);
        }
    }
}

/// How much of a file the inline viewer will read.
///
/// **A viewer is not a reason to load a gigabyte into a webview.** A minified bundle, a log or a
/// generated lockfile will all exceed this, and the honest answer to those is the first part plus a
/// note — not a frozen window while a 200 MB string crosses the IPC boundary and is then tokenised.
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

/// How much of the head is inspected to decide whether a file is text at all.
const SNIFF_BYTES: usize = 8 * 1024;

/// A file's contents for the inline viewer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextFile {
    pub text: String,
    /// True when the file was longer than [`MAX_TEXT_BYTES`] and only its head is here.
    pub truncated: bool,
}

/// Read a file as text, or refuse it.
///
/// **Reading, never running.** This is the whole reason the viewer exists rather than handing the
/// path to the platform's default handler: opening a file that way *starts an application chosen by
/// the file*, which is the threat `reveal` was written to avoid (`commands::reveal_in_file_manager`).
/// Here the file's type decides only which syntax highlighter colours it.
///
/// Binary is refused rather than mangled. A NUL byte in the first few kilobytes is the same test
/// `git` uses, and it is enough: the alternative — showing replacement characters for a PNG — looks
/// like a corrupt file rather than the wrong question.
pub fn read_text(target: &Path) -> Result<TextFile> {
    let meta =
        std::fs::metadata(target).map_err(|e| AppError::io(target.display().to_string(), e))?;
    if meta.is_dir() {
        return Err(AppError::Other(format!(
            "{} is a directory, not a file",
            target.display()
        )));
    }

    let mut file =
        std::fs::File::open(target).map_err(|e| AppError::io(target.display().to_string(), e))?;
    let truncated = meta.len() > MAX_TEXT_BYTES;
    let mut bytes = Vec::new();
    std::io::Read::take(&mut file, MAX_TEXT_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|e| AppError::io(target.display().to_string(), e))?;

    if is_binary(&bytes) {
        return Err(AppError::Other(format!(
            "{} is not a text file",
            target.display()
        )));
    }

    // Lossy on purpose: a file that is text apart from one stray byte is still worth reading, and
    // refusing it would be a worse answer than one replacement character.
    Ok(TextFile {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
    })
}

/// Whether these bytes look like something other than text.
///
/// A NUL in the head, which is what `git` uses. Cheap, and wrong only for encodings this app has no
/// business rendering anyway.
fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(SNIFF_BYTES).any(|byte| *byte == 0)
}

/// What the viewer can make of a file.
///
/// **Three answers, and the third is the point.** The viewer used to have two: text, or an error
/// string rendered raw. So a PNG produced *"…/shot.png is not a text file"* in the panel — which is
/// true, is not a sentence anybody wrote for a reader, and says nothing about what to do instead.
/// A file the viewer cannot draw is a **state**, not a failure (rule:logging: no silent failures,
/// and no unnamed ones either).
pub enum Preview {
    Text(TextFile),
    /// A picture, and its type as decided by the bytes rather than by the name.
    Image {
        bytes: Vec<u8>,
        mime: &'static str,
    },
    /// Nothing this panel can draw. It still says what the file *is*, so the answer is "open it
    /// with something else", not "something went wrong".
    Unsupported {
        reason: Unsupported,
        size: u64,
    },
}

/// Why a file cannot be drawn here.
pub enum Unsupported {
    /// Binary, and not a picture format this viewer knows.
    Binary,
    /// A picture, but past what may be held in a webview at once.
    ImageTooLarge,
}

/// The largest picture the file viewer will hand to the webview.
///
/// **The same ceiling the notes' viewer uses, from the same constant** (ADR-CORE-005). It is one
/// question — *how much image may a webview hold while somebody looks at it* — and answering it
/// twice is how the two come to disagree. `notes::images` states the reasoning: base64 inflates by
/// a third, and the viewer holds exactly one picture for as long as it is open.
pub const MAX_IMAGE_BYTES: u64 = crate::notes::images::MAX_VIEWER as u64;

/// The picture formats this viewer draws, decided by the file's first bytes.
///
/// **By content, never by extension.** A `.png` that is really a JPEG still draws; a `.png` that is
/// really a zip does not, and says so. The name is a claim by whoever wrote the file, and the
/// webview is the thing being handed the result (rule:security).
///
/// **SVG is deliberately absent.** It is text, so it already opens in this viewer as its own source,
/// which is usually what somebody browsing a repository wants — and it is the one image format that
/// carries script. Drawing it belongs with markdown's source/rendered lens rather than here.
fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";
    match bytes {
        _ if bytes.starts_with(PNG) => Some("image/png"),
        _ if bytes.starts_with(b"\xff\xd8\xff") => Some("image/jpeg"),
        _ if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => Some("image/gif"),
        // RIFF containers carry their real type at byte 8; only WEBP is a picture.
        _ if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => Some("image/webp"),
        _ if bytes.starts_with(b"BM") => Some("image/bmp"),
        _ if bytes.starts_with(b"\x00\x00\x01\x00") => Some("image/x-icon"),
        // ISO base media: the brand at byte 4 says which. AVIF and HEIC share the container.
        _ if bytes.get(4..8) == Some(b"ftyp") => match bytes.get(8..12) {
            Some(b"avif") | Some(b"avis") => Some("image/avif"),
            Some(b"heic") | Some(b"heix") | Some(b"mif1") => Some("image/heic"),
            _ => None,
        },
        _ => None,
    }
}

/// Read a file for the viewer, and always answer *something*.
///
/// **This is the one place that decides what a file is**, so the panel never has to guess from an
/// extension or read an error message to find out. Order matters: pictures are recognised before
/// the text sniff, because every one of them would otherwise be "binary".
pub fn preview(target: &Path) -> Result<Preview> {
    let meta =
        std::fs::metadata(target).map_err(|e| AppError::io(target.display().to_string(), e))?;
    if meta.is_dir() {
        return Err(AppError::Other(format!(
            "{} is a directory, not a file",
            target.display()
        )));
    }

    let mut head = [0u8; 16];
    let read = {
        let mut file = std::fs::File::open(target)
            .map_err(|e| AppError::io(target.display().to_string(), e))?;
        let mut filled = 0;
        while filled < head.len() {
            match file.read(&mut head[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(e) => return Err(AppError::io(target.display().to_string(), e)),
            }
        }
        filled
    };

    if let Some(mime) = image_mime(&head[..read]) {
        if meta.len() > MAX_IMAGE_BYTES {
            // **Named rather than truncated.** Half a JPEG renders as a grey block, which reads as a
            // broken file rather than as a file this panel declined to hold.
            return Ok(Preview::Unsupported {
                reason: Unsupported::ImageTooLarge,
                size: meta.len(),
            });
        }
        let bytes =
            std::fs::read(target).map_err(|e| AppError::io(target.display().to_string(), e))?;
        return Ok(Preview::Image { bytes, mime });
    }

    match read_text(target) {
        Ok(text) => Ok(Preview::Text(text)),
        // The only thing `read_text` refuses on its own account is "not text". Anything else — gone,
        // unreadable — is a real error and stays one.
        Err(_) if is_binary(&head[..read]) => Ok(Preview::Unsupported {
            reason: Unsupported::Binary,
            size: meta.len(),
        }),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod preview_tests {
    use super::*;

    fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, bytes).expect("write");
        path
    }

    /// The smallest thing that is unmistakably a PNG: the signature and nothing after it.
    const PNG_HEAD: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR";

    #[test]
    fn a_picture_is_recognised_by_its_bytes_and_not_by_its_name() {
        // **The whole reason this decision is in the backend.** A name is a claim by whoever wrote
        // the file; the bytes are the file. Both directions are asserted, because only checking the
        // helpful one would let an extension quietly become the source of truth again.
        let dir = tempfile::tempdir().expect("tempdir");

        let lying = write(dir.path(), "notes.txt", PNG_HEAD);
        assert!(
            matches!(preview(&lying), Ok(Preview::Image { mime, .. }) if mime == "image/png"),
            "a picture called .txt is still a picture"
        );

        let pretending = write(dir.path(), "shot.png", b"PK\x03\x04\x00\x00");
        assert!(
            matches!(
                preview(&pretending),
                Ok(Preview::Unsupported {
                    reason: Unsupported::Binary,
                    ..
                })
            ),
            "a zip called .png is not one"
        );
    }

    #[test]
    fn every_format_the_viewer_claims_is_actually_recognised() {
        // A list in a doc comment that the code does not implement is worse than no list: it is a
        // promise the panel then breaks on one file type out of eight.
        assert_eq!(image_mime(PNG_HEAD), Some("image/png"));
        assert_eq!(image_mime(b"\xff\xd8\xff\xe0"), Some("image/jpeg"));
        assert_eq!(image_mime(b"GIF89a...."), Some("image/gif"));
        assert_eq!(image_mime(b"GIF87a...."), Some("image/gif"));
        assert_eq!(
            image_mime(b"RIFF\x00\x00\x00\x00WEBPVP8 "),
            Some("image/webp")
        );
        assert_eq!(image_mime(b"BM\x00\x00\x00\x00"), Some("image/bmp"));
        assert_eq!(
            image_mime(b"\x00\x00\x01\x00\x01\x00"),
            Some("image/x-icon")
        );
        assert_eq!(image_mime(b"\x00\x00\x00\x20ftypavif"), Some("image/avif"));
        assert_eq!(image_mime(b"\x00\x00\x00\x20ftypheic"), Some("image/heic"));

        // A RIFF that is not a picture must not be drawn as one: the container also carries audio.
        assert_eq!(image_mime(b"RIFF\x00\x00\x00\x00WAVEfmt "), None);
        // And a video in the same box as AVIF is still not a picture.
        assert_eq!(image_mime(b"\x00\x00\x00\x20ftypmp42"), None);
        assert_eq!(image_mime(b"fn main() {}"), None);
        assert_eq!(image_mime(b""), None, "an empty file is nothing at all");
    }

    #[test]
    fn a_picture_past_the_cap_is_named_rather_than_half_drawn() {
        // Half a JPEG renders as a grey block, which reads as a corrupt file rather than as one the
        // panel declined to hold. The size travels with it so the message can say how far past.
        let dir = tempfile::tempdir().expect("tempdir");
        let mut bytes = PNG_HEAD.to_vec();
        bytes.resize(
            usize::try_from(MAX_IMAGE_BYTES).unwrap_or(usize::MAX) + 1,
            0,
        );
        let path = write(dir.path(), "huge.png", &bytes);

        match preview(&path) {
            Ok(Preview::Unsupported {
                reason: Unsupported::ImageTooLarge,
                size,
            }) => assert!(size > MAX_IMAGE_BYTES),
            other => panic!("expected a named refusal, got {:?}", other.is_ok()),
        }
    }

    #[test]
    fn a_binary_that_is_no_picture_is_a_state_rather_than_an_error() {
        // **The defect this whole enum exists for.** It used to be `Err("… is not a text file")`,
        // which the panel printed raw: true, addressed to nobody, and silent about what to do next.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "a.bin", b"\x00\x01\x02\x03binary");

        assert!(matches!(
            preview(&path),
            Ok(Preview::Unsupported {
                reason: Unsupported::Binary,
                ..
            })
        ));
    }

    #[test]
    fn text_still_comes_back_as_text() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "a.rs", b"fn main() {}\n");

        match preview(&path) {
            Ok(Preview::Text(file)) => {
                assert_eq!(file.text, "fn main() {}\n");
                assert!(!file.truncated);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn a_real_failure_stays_a_failure() {
        // "Gone" and "cannot be drawn" are different facts, and collapsing them would hide a missing
        // file behind a tidy panel (rule:logging).
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(preview(&dir.path().join("nothing-here")).is_err());
        assert!(preview(dir.path()).is_err(), "a directory is not a file");
    }
}

#[cfg(test)]
mod text_tests {
    use super::*;

    #[test]
    fn a_text_file_is_read_whole() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.rs");
        std::fs::write(&path, "fn main() {}\n").expect("write");

        let file = read_text(&path).expect("read");
        assert_eq!(file.text, "fn main() {}\n");
        assert!(!file.truncated);
    }

    #[test]
    fn a_binary_file_is_refused_rather_than_mangled() {
        // Showing replacement characters for a PNG looks like a corrupt file rather than the wrong
        // question. A NUL in the head is the test `git` uses.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("logo.png");
        std::fs::write(&path, [0x89, b'P', b'N', b'G', 0x00, 0x1a]).expect("write");

        assert!(read_text(&path).is_err());
    }

    #[test]
    fn a_directory_is_refused_with_a_message_that_says_which_it_is() {
        let dir = tempfile::tempdir().expect("tempdir");
        let error = read_text(dir.path()).expect_err("a directory is not a file");
        assert!(error.to_string().contains("directory"), "{error}");
    }

    #[test]
    fn a_file_past_the_cap_is_truncated_and_says_so() {
        // A file that silently stops is read as a file that ends there.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("big.log");
        let big = "x".repeat((MAX_TEXT_BYTES as usize) + 1024);
        std::fs::write(&path, &big).expect("write");

        let file = read_text(&path).expect("read");
        assert!(file.truncated);
        assert_eq!(file.text.len() as u64, MAX_TEXT_BYTES);
    }

    #[test]
    fn one_stray_byte_does_not_cost_the_whole_file() {
        // Lossy on purpose: refusing a file that is text apart from one bad byte is a worse answer
        // than one replacement character.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("mixed.txt");
        std::fs::write(&path, [b'h', b'i', 0xff, b'!']).expect("write");

        let file = read_text(&path).expect("read");
        assert!(file.text.starts_with("hi"));
        assert!(file.text.ends_with('!'));
    }
}
