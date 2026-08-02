//! Images in a note: copied in, read back, and the orphans nobody points at any more.
//!
//! **Copied, never referenced.** A note pointing at `~/Desktop/shot.png` is broken on the second
//! machine and again the day the desktop is tidied, which defeats the entire reason the notes live in
//! a synced repository. The file is written into the project's own `assets/` directory and the note
//! refers to it relatively, so the reference survives the clone landing anywhere and still renders in
//! any other markdown tool.
//!
//! **Read through here, never by the webview.** This application has no `assetProtocol` capability at
//! all, so the webview cannot load `file://`; every byte on disk reaches it through a command
//! confined by a root check. Displaying a screenshot does not widen the sandbox (ADR-PROJ-004).

use super::{project_dir, within_root};
use crate::error::{AppError, Result};
use std::path::Path;

/// The directory inside a project that holds its images.
pub const ASSETS: &str = "assets";

/// The largest image handed to the webview inline, in bytes.
///
/// A data URL is held in memory by the webview and base64 inflates by a third, so 4 MB of file is
/// about 5.3 MB of string — held only while that one note is open, so the ceiling is a note and not a
/// project. A full-screen Retina PNG is 1–3 MB, so ordinary screenshots inline; anything past this is
/// a photograph or a capture that deserves a real viewer, and gets one.
pub const MAX_INLINE: usize = 4 * 1024 * 1024;

/// Copy `source` into the project's assets and return the note-relative path to write in the
/// markdown.
///
/// The stamp is what keeps two screenshots called `Bildschirmfoto.png` apart without asking the user
/// to name them — which they would not do, and then one would overwrite the other silently.
pub fn add(root: &Path, project: &str, source: &Path, stamp: &str) -> Result<String> {
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".into());
    let name = super::safe_segment(&name)?;
    let dir = project_dir(root, project)?.join(ASSETS);
    std::fs::create_dir_all(&dir).map_err(|e| AppError::io(dir.display().to_string(), e))?;
    let target = within_root(root, &dir.join(format!("{stamp}-{name}")))?;
    std::fs::copy(source, &target).map_err(|e| AppError::io(target.display().to_string(), e))?;
    tracing::info!(project, file = %target.display(), "notes image added");
    Ok(format!("{ASSETS}/{stamp}-{name}"))
}

/// Write bytes the frontend already holds — a paste from the clipboard — into the project's assets.
pub fn add_bytes(
    root: &Path,
    project: &str,
    name: &str,
    stamp: &str,
    bytes: &[u8],
) -> Result<String> {
    let name = super::safe_segment(name)?;
    let dir = project_dir(root, project)?.join(ASSETS);
    std::fs::create_dir_all(&dir).map_err(|e| AppError::io(dir.display().to_string(), e))?;
    let target = within_root(root, &dir.join(format!("{stamp}-{name}")))?;
    std::fs::write(&target, bytes).map_err(|e| AppError::io(target.display().to_string(), e))?;
    tracing::info!(project, bytes = bytes.len(), file = %target.display(), "notes image pasted");
    Ok(format!("{ASSETS}/{stamp}-{name}"))
}

/// The bytes of one image, or an error saying it is too big to inline.
///
/// `rel` comes out of a note's markdown, which is content that arrives by paste from anywhere, so it
/// is the one path here that is genuinely untrusted: `![](../../../etc/passwd)` is the abuse case
/// this check exists for.
pub fn read(root: &Path, project: &str, rel: &str) -> Result<Vec<u8>> {
    if rel.contains("://") {
        return Err(AppError::Other(
            "a remote image is fetched on request, never on render".into(),
        ));
    }
    let dir = project_dir(root, project)?;
    let target = within_root(root, &dir.join(rel))?;
    let meta = std::fs::metadata(&target).map_err(|e| AppError::io(rel.to_string(), e))?;
    let size = usize::try_from(meta.len()).unwrap_or(usize::MAX);
    if size > MAX_INLINE {
        return Err(AppError::Other(format!(
            "{rel} is {size} bytes, over the {MAX_INLINE}-byte inline limit"
        )));
    }
    std::fs::read(&target).map_err(|e| AppError::io(rel.to_string(), e))
}

/// Every image in the repository that no note refers to, with its size.
///
/// **Nothing is deleted here.** Sweeping unreferenced files automatically would lose data: a note
/// written on another machine and not yet pulled still refers to the image, and this machine cannot
/// see that note. The caller runs this only after a successful pull, shows what it found, and deletes
/// nothing until the user presses (ADR-PROJ-004).
pub fn orphans(root: &Path) -> Vec<(String, u64)> {
    let mut referenced: Vec<String> = Vec::new();
    for project in super::projects(root) {
        let Ok(topics) = super::topics(root, &project) else {
            continue;
        };
        for topic in topics {
            let Ok(text) = super::read(root, &project, &topic) else {
                continue;
            };
            for part in text.split("](").skip(1) {
                if let Some(end) = part.find(')') {
                    let target = part[..end].trim();
                    if !target.contains("://") {
                        referenced.push(format!("{project}/{target}"));
                    }
                }
            }
        }
    }

    let mut out = Vec::new();
    for project in super::projects(root) {
        let Ok(dir) = project_dir(root, &project) else {
            continue;
        };
        let Ok(entries) = std::fs::read_dir(dir.join(ASSETS)) else {
            continue;
        };
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let key = format!("{project}/{ASSETS}/{name}");
            if !referenced.contains(&key) {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                out.push((key, size));
            }
        }
    }
    out.sort();
    out
}

/// Delete the images the user picked from an [`orphans`] listing.
pub fn remove(root: &Path, keys: &[String]) -> Result<usize> {
    let mut removed = 0;
    for key in keys {
        let target = within_root(root, &root.join(key))?;
        match std::fs::remove_file(&target) {
            Ok(()) => removed += 1,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(AppError::io(key.clone(), e)),
        }
    }
    tracing::info!(removed, "notes images cleaned");
    Ok(removed)
}
