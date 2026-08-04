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
///
/// **An empty target is refused before anything is opened.** The markdown toolbar's own Image button
/// writes `![]()` for the user to fill in, so a note holding one is the ordinary case — and
/// `dir.join("")` is the *project directory*, which produced `io error at : Is a directory` once a
/// second in a running build, with an empty path in the message that named nothing. A target that
/// does not name a file is not a failure to report, it is a picture that is not there yet.
pub fn read(root: &Path, project: &str, rel: &str) -> Result<Vec<u8>> {
    if rel.contains("://") {
        return Err(AppError::Other(
            "a remote image is fetched on request, never on render".into(),
        ));
    }
    if rel.trim().is_empty() {
        return Err(AppError::Other("an image with no path".into()));
    }
    let dir = project_dir(root, project)?;
    let target = within_root(root, &dir.join(rel))?;
    let meta = std::fs::metadata(&target).map_err(|e| AppError::io(rel.to_string(), e))?;
    if !meta.is_file() {
        return Err(AppError::Other(format!("{rel} is not a file")));
    }
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

/// Fetch a remote image, once, because the user pressed.
///
/// **Never on render.** A `![](https://…)` in a pasted note would otherwise make the app call a
/// stranger's server the instant the note is read, which is exactly what a tracking pixel counts on —
/// and reading a note is not consent to that (ADR-PROJ-004).
///
/// **The BACKEND fetches, never the webview.** The webview then opens no connection of its own, which
/// keeps the CSP posture intact and stops the request carrying a referrer or a user agent anywhere.
/// HTTPS only, with a timeout and a size cap, because this is the one place in the application where
/// a URL out of untrusted content reaches the network (`rule:security`).
pub async fn fetch_remote(url: &str) -> Result<Vec<u8>> {
    if !url.starts_with("https://") {
        return Err(AppError::Other(format!(
            "refusing to fetch a non-https image: {url}"
        )));
    }
    tracing::info!(%url, "notes image fetch");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        // No redirect chase into a different scheme, and a bounded one at that: an open redirect is
        // how an https URL becomes a request somewhere the user never saw.
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "{url} answered {}",
            response.status()
        )));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    if bytes.len() > MAX_INLINE {
        return Err(AppError::Other(format!(
            "{url} is {} bytes, over the {MAX_INLINE}-byte inline limit",
            bytes.len()
        )));
    }
    tracing::info!(%url, bytes = bytes.len(), "notes image fetched");
    Ok(bytes.to_vec())
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
