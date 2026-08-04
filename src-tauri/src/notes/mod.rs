//! The notes store: markdown files in a git repository the app keeps in sync.
//!
//! **This module owns the only write access to a git repository in the whole application.**
//! Everything else git-related — status, diff, log, the auto-fetch of ADR-PROJ-002 — reads. YggShell
//! runs `git` inside *every project the user has a tab in*, so a write path aimed at the wrong
//! directory would commit and push the maintainer's own work from a background timer, unasked. That
//! is why `notes/git.rs` is the only file allowed to name a writing subcommand, and why
//! `scripts/project/check-git-writes.mjs` fails the build if one appears anywhere else
//! (ADR-PROJ-004).
//!
//! **The root is derived here, never supplied by the frontend.** The webview may ask to sync or to
//! write a note; it may not say *which directory*. Same principle as ADR-PROJ-001 §5 — the frontend
//! must not be able to choose what runs — and every write re-checks that its target canonicalises
//! under the root even though the path never left this process.
//!
//! **Layout.** Everything lives under a fixed `notes/` subdirectory of the repository, whether the
//! repository was empty or not. That is what makes "what if it already has something in it" stop
//! being a question: there is no adopt-or-refuse branch and nothing of the user's is ever mixed with
//! ours.
//!
//! ```text
//! <clone>/notes/<project>/inbox.md
//! <clone>/notes/<project>/<topic>.md
//! <clone>/notes/<project>/assets/<stamp>-<name>
//! ```

pub mod git;
pub mod images;
pub mod import;
pub mod offsets;

use crate::dto::NoteFile;
use crate::error::{AppError, Result};
use std::path::{Path, PathBuf};

/// The subdirectory inside the repository that this app owns. See the module note.
pub const ROOT_DIR: &str = "notes";

/// Where a quick capture lands when no topic was chosen.
pub const INBOX: &str = "inbox";

/// The project used by a tab that has no repository of its own, so a thought is never refused for
/// being had in the wrong window.
pub const LOOSE: &str = "_inbox";

/// The clone's location inside the app's data directory.
///
/// Not configurable, deliberately: a user-chosen checkout would be a second thing to keep consistent
/// and a way to point the app at a working tree somebody else is using. The path is *shown* in
/// settings, because a directory you cannot find is a directory you cannot back up.
pub fn clone_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("notes-repo")
}

/// The directory this app writes into: `<clone>/notes`.
pub fn root(data_dir: &Path) -> PathBuf {
    clone_dir(data_dir).join(ROOT_DIR)
}

/// Turn a git remote URL into the directory a project's notes live in.
///
/// `git@github.com:kaoszwerg/yggshell.git` and `https://github.com/kaoszwerg/yggshell` both become
/// `github.com/kaoszwerg/yggshell`, so the same project is the same folder on every machine however
/// differently it is checked out. Nested rather than flattened with separators: the result is
/// readable in any file browser and cannot collide.
pub fn project_key(remote: &str) -> Option<String> {
    let trimmed = remote.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .or_else(|| trimmed.strip_prefix("ssh://"))
        .unwrap_or(trimmed);
    // `user@host:path` — the SSH short form, where the colon is the separator and not a port.
    let without_user = without_scheme
        .split_once('@')
        .map_or(without_scheme, |(_, rest)| rest);
    let normalised = without_user.replacen(':', "/", 1);
    let path = normalised.trim_end_matches('/').trim_end_matches(".git");
    let cleaned: Vec<&str> = path
        .split('/')
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    Some(cleaned.join("/"))
}

/// A name the user typed, reduced to something that is safe as one path segment.
///
/// Refuses rather than mangles when nothing is left: a topic called `../..` must not quietly become
/// a file somewhere else, and a topic that is only punctuation is a mistake worth reporting.
pub fn safe_segment(name: &str) -> Result<String> {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return Err(AppError::Other(format!("not a usable name: {name}")));
    }
    Ok(cleaned)
}

/// Resolve a path under the notes root and refuse anything that escapes it.
///
/// The path never came from the webview — the frontend names a project and a topic, not a path — so
/// this is belt and braces. It is here anyway because it is the check that survives a refactor
/// moving code between modules, and because `![](../../../etc/passwd)` in a pasted note is a real
/// abuse case (ADR-PROJ-004). Unlike `files::verify` it does not require the target to exist: a note
/// being created for the first time has no canonical form yet, so the *parent* is checked instead.
pub fn within_root(root: &Path, target: &Path) -> Result<PathBuf> {
    let root = root
        .canonicalize()
        .map_err(|e| AppError::io(root.display().to_string(), e))?;
    let parent = target
        .parent()
        .ok_or_else(|| AppError::Other(format!("{} has no parent", target.display())))?;
    let parent = parent
        .canonicalize()
        .map_err(|e| AppError::io(parent.display().to_string(), e))?;
    if !parent.starts_with(&root) {
        tracing::warn!(
            root = %root.display(),
            target = %target.display(),
            "refused a notes path outside the notes root"
        );
        return Err(AppError::Other(format!(
            "{} is outside {}",
            target.display(),
            root.display()
        )));
    }
    let name = target
        .file_name()
        .ok_or_else(|| AppError::Other(format!("{} has no name", target.display())))?;
    Ok(parent.join(name))
}

/// The file a note lives in, creating the project directory if it is not there yet.
pub fn note_path(root: &Path, project: &str, topic: &str) -> Result<PathBuf> {
    let project_dir = project_dir(root, project)?;
    std::fs::create_dir_all(&project_dir)
        .map_err(|e| AppError::io(project_dir.display().to_string(), e))?;
    let topic = safe_segment(topic)?;
    within_root(root, &project_dir.join(format!("{topic}.md")))
}

/// A project's directory, created if missing. `project` is a `/`-separated key from
/// [`project_key`], so each segment is checked on its own.
pub fn project_dir(root: &Path, project: &str) -> Result<PathBuf> {
    let mut dir = root.to_path_buf();
    for segment in project.split('/') {
        dir = dir.join(safe_segment(segment)?);
    }
    std::fs::create_dir_all(&dir).map_err(|e| AppError::io(dir.display().to_string(), e))?;
    within_root(root, &dir)
}

/// Read a note, or an empty document if it does not exist yet.
///
/// Missing is not an error: an empty inbox and a note nobody has written to are the same thing to a
/// reader, and refusing would make the first capture in a project a two-step affair.
pub fn read(root: &Path, project: &str, topic: &str) -> Result<String> {
    let path = note_path(root, project, topic)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(AppError::io(path.display().to_string(), e)),
    }
}

/// Write a note, atomically.
///
/// Same discipline as the settings file: write a sibling and rename it. A crash halfway through a
/// direct write leaves a truncated note, and a note is the one thing here that cannot be regenerated.
pub fn write(root: &Path, project: &str, topic: &str, text: &str) -> Result<()> {
    let path = note_path(root, project, topic)?;
    let temp = path.with_extension("md.tmp");
    std::fs::write(&temp, text).map_err(|e| AppError::io(temp.display().to_string(), e))?;
    std::fs::rename(&temp, &path).map_err(|e| AppError::io(path.display().to_string(), e))?;
    tracing::info!(project, topic, bytes = text.len(), "notes write");
    Ok(())
}

/// Append a captured line to a project's inbox.
///
/// The line is written as a task — `- [ ] …` — because everything here is handed over and then done,
/// which is what a checkbox says and what makes the done-fold work for prompts as well as chores. A
/// leading `!`/`!!` sets the priority and stays in the text, where the renderer reads it back.
pub fn capture(root: &Path, project: &str, text: &str) -> Result<()> {
    let body = text.trim_end();
    if body.trim().is_empty() {
        return Err(AppError::Other("nothing to capture".into()));
    }
    let mut lines = body.lines();
    let first = lines.next().unwrap_or("").trim();
    let mut entry = format!("- [ ] {first}\n");
    for line in lines {
        // Continuation lines are indented under the item, which is what makes them its body rather
        // than the next item.
        entry.push_str(&format!("      {}\n", line.trim_end()));
    }

    let existing = read(root, project, INBOX)?;
    let separator = if existing.is_empty() || existing.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    write(
        root,
        project,
        INBOX,
        &format!("{existing}{separator}{entry}"),
    )
}

/// Flip the task item whose `- [ ]` marker starts at `offset`.
///
/// Takes an offset rather than a line number because that is what the markdown parser reports, and
/// because a line number is wrong the moment anything above it changes. Verifies what it found
/// before rewriting: an offset that does not point at a marker is a stale view, not a licence to
/// edit the file at that position.
///
/// **`offset` is in UTF-16 code units** — the frontend's unit, and the only one it has
/// (`offsets::to_byte`). It was read as a byte offset until 2026-08-04, which made every task below
/// a German word unreachable.
pub fn toggle(root: &Path, project: &str, topic: &str, offset: usize) -> Result<bool> {
    let text = read(root, project, topic)?;
    let offset = offsets::to_byte(&text, offset)
        .ok_or_else(|| AppError::Other("that item is no longer where it was".into()))?;
    let rest = text
        .get(offset..)
        .ok_or_else(|| AppError::Other("that item is no longer where it was".into()))?;
    let marker_at = rest
        .find("[ ]")
        .into_iter()
        .chain(rest.find("[x]"))
        .chain(rest.find("[X]"))
        .min()
        .ok_or_else(|| AppError::Other("that item is no longer a task".into()))?;
    // Only within the item's own first line: finding a marker three paragraphs later would tick
    // something the user never pointed at.
    if rest[..marker_at].contains('\n') {
        return Err(AppError::Other("that item is no longer a task".into()));
    }
    let at = offset + marker_at;
    let done = !rest[marker_at..].starts_with("[ ]");
    let replacement = if done { "[ ]" } else { "[x]" };
    let mut updated = String::with_capacity(text.len());
    updated.push_str(&text[..at]);
    updated.push_str(replacement);
    updated.push_str(&text[at + 3..]);
    write(root, project, topic, &updated)?;
    tracing::info!(project, topic, offset, done = !done, "notes toggle");
    Ok(!done)
}

/// Delete a note.
pub fn delete_note(root: &Path, project: &str, topic: &str) -> Result<()> {
    let path = note_path(root, project, topic)?;
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(AppError::io(path.display().to_string(), e)),
    }
    tracing::info!(project, topic, "notes delete");
    Ok(())
}

/// Rename a project, keeping every note and image in it.
///
/// **Projects are named by the user, not derived from whatever tab happens to be in front.** They
/// were keyed off the front tab's git remote at first, and the maintainer overruled it: which
/// repository a terminal is sitting in has nothing to do with which project a note belongs to, and a
/// name you cannot change is a name that is wrong for ever.
pub fn rename_project(root: &Path, from: &str, to: &str) -> Result<()> {
    let source = project_dir(root, from)?;
    let target = project_dir(root, to)?;
    if source == target {
        return Ok(());
    }
    if std::fs::read_dir(&target).is_ok_and(|mut d| d.next().is_some()) {
        return Err(AppError::Other(format!("{to} already has notes in it")));
    }
    // Created by `project_dir` a moment ago; a rename onto an existing empty directory fails on some
    // platforms, so it goes first.
    let _ = std::fs::remove_dir(&target);
    std::fs::rename(&source, &target).map_err(|e| AppError::io(target.display().to_string(), e))?;
    tracing::info!(from, to, "notes project renamed");
    Ok(())
}

/// Delete a whole project directory, with everything in it.
pub fn delete_project(root: &Path, project: &str) -> Result<()> {
    let dir = project_dir(root, project)?;
    std::fs::remove_dir_all(&dir).map_err(|e| AppError::io(dir.display().to_string(), e))?;
    tracing::info!(project, "notes delete project");
    Ok(())
}

/// Every project that has notes, as `/`-separated keys.
pub fn projects(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk_projects(root, root, &mut out);
    out.sort();
    out
}

fn walk_projects(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut has_notes = false;
    let mut children = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|n| n == images::ASSETS) {
                continue;
            }
            children.push(path);
        } else if path.extension().is_some_and(|e| e == "md") {
            has_notes = true;
        }
    }
    if has_notes {
        if let Ok(rel) = dir.strip_prefix(root) {
            let key = rel.to_string_lossy().replace('\\', "/");
            if !key.is_empty() {
                out.push(key);
            }
        }
    }
    for child in children {
        walk_projects(root, &child, out);
    }
}

/// The topics in one project, without their `.md`, `inbox` first.
pub fn topics(root: &Path, project: &str) -> Result<Vec<String>> {
    let dir = project_dir(root, project)?;
    let mut out: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| AppError::io(dir.display().to_string(), e))?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "md") {
                path.file_stem().map(|s| s.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect();
    out.sort_by_key(|topic| (topic != INBOX, topic.clone()));
    Ok(out)
}

/// Every note of the given projects, contents and all, in one call.
///
/// **Why this exists rather than the frontend looping.** The tool used to ask for a project's topic
/// list and then for each note's text separately — one IPC round trip each, and every one of them
/// executing on Tauri's **main thread**, so they could not overlap with anything, including the
/// window's own events. A handful of notes across two projects was a visible wait before the panel
/// drew at all ("das laden des todo widgets dauert extrem lange"). One call, off the main thread, is
/// the whole fix.
///
/// A project that cannot be read is **skipped**, not an error: it may have been renamed or deleted
/// between the listing and this call, and one missing entry must not empty the panel.
pub fn tree(root: &Path, projects: &[String]) -> Vec<NoteFile> {
    let mut out = Vec::new();
    for project in projects {
        let Ok(topics) = topics(root, project) else {
            continue;
        };
        for topic in topics {
            let Ok(text) = read(root, project, &topic) else {
                continue;
            };
            out.push(NoteFile {
                project: project.clone(),
                topic,
                text,
            });
        }
    }
    out
}

/// Every file in the repository, **named but not read**.
///
/// What a "move to" menu needs. Reading every note to fill a menu would make opening it the most
/// expensive thing the tool does, so `text` stays empty here — deliberately, and asserted by a test.
pub fn index(root: &Path) -> Vec<NoteFile> {
    let mut out = Vec::new();
    for project in projects(root) {
        let Ok(topics) = topics(root, &project) else {
            continue;
        };
        for topic in topics {
            out.push(NoteFile {
                project: project.clone(),
                topic,
                text: String::new(),
            });
        }
    }
    out
}

/// One search hit: which note, and the line it was found on.
pub struct Hit {
    pub project: String,
    pub topic: String,
    pub line: String,
    /// Offset of the line's start, so the view can open at it — in **UTF-16 code units**, which is
    /// what `setSelectionRange` on the other side counts in (`offsets`).
    pub offset: usize,
}

/// Plain-text search across every project, case-insensitive.
///
/// Not a regex. A search box that can throw a syntax error at somebody looking for `(` is a worse
/// tool than one that finds `(`.
pub fn search(root: &Path, query: &str) -> Vec<Hit> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    let mut hits = Vec::new();
    for project in projects(root) {
        let Ok(topics) = topics(root, &project) else {
            continue;
        };
        for topic in topics {
            let Ok(text) = read(root, &project, &topic) else {
                continue;
            };
            // Counted in UTF-16 code units as it goes, rather than converted per hit: the caret this
            // number ends up in counts that way, and accumulating alongside the scan keeps it linear
            // instead of re-measuring the head of the file for every match.
            let mut offset = 0usize;
            for line in text.split_inclusive('\n') {
                if line.to_lowercase().contains(&needle) {
                    hits.push(Hit {
                        project: project.clone(),
                        topic: topic.clone(),
                        line: line.trim_end().to_string(),
                        offset,
                    });
                }
                offset += line.encode_utf16().count();
            }
        }
    }
    hits
}

#[cfg(test)]
mod tests;
