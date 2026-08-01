//! The Git tool's IPC surface (ADR-PROJ-001). Read-only: nothing here writes to a repository.

use crate::dto::{GitCommitDetail, GitDiff, GitSnapshot};
use crate::error::Result;
use std::path::PathBuf;

/// Everything the Git tool renders for the repository containing `cwd`, in one call.
///
/// `null` when that directory is not inside a repository — which is the normal case for most of the
/// filesystem, not a failure. The path comes from the terminal's own reported working directory
/// (OSC 7), so it follows the user around as they `cd`.
#[tauri::command]
pub fn git_snapshot(cwd: String) -> Result<Option<GitSnapshot>> {
    tracing::debug!(%cwd, "git_snapshot");
    let snapshot = crate::git::snapshot(&PathBuf::from(&cwd))?;
    tracing::debug!(
        %cwd,
        found = snapshot.is_some(),
        changes = snapshot.as_ref().map_or(0, |s| s.changes.len()),
        "git_snapshot ok"
    );
    Ok(snapshot)
}

/// What changed in one file of the working tree.
///
/// `staged` picks which side is meant: `true` compares `HEAD` with the index, `false` the index with
/// the file on disk. A file can be both at once — which is why the tool lists it twice — and they are
/// different diffs.
///
/// `path` is repository-relative and always one the tool itself listed, but it arrives from the
/// webview and is therefore validated in `git::details`, not trusted (rule:security).
#[tauri::command]
pub fn git_file_diff(cwd: String, path: String, staged: bool) -> Result<Option<GitDiff>> {
    tracing::debug!(%cwd, %path, staged, "git_file_diff");
    let diff = crate::git::details::file_diff(&PathBuf::from(&cwd), &path, staged)?;
    tracing::debug!(
        %path,
        hunks = diff.as_ref().map_or(0, |d| d.hunks.len()),
        binary = diff.as_ref().is_some_and(|d| d.binary),
        "git_file_diff ok"
    );
    Ok(diff)
}

/// Everything about one commit: the whole message, its author, and the files it touched.
#[tauri::command]
pub fn git_commit(cwd: String, rev: String) -> Result<Option<GitCommitDetail>> {
    tracing::debug!(%cwd, %rev, "git_commit");
    let detail = crate::git::details::commit_detail(&PathBuf::from(&cwd), &rev)?;
    tracing::debug!(
        %rev,
        files = detail.as_ref().map_or(0, |d| d.files.len()),
        "git_commit ok"
    );
    Ok(detail)
}

/// What one file looks like inside one commit, against its first parent.
#[tauri::command]
pub fn git_commit_file_diff(cwd: String, rev: String, path: String) -> Result<Option<GitDiff>> {
    tracing::debug!(%cwd, %rev, %path, "git_commit_file_diff");
    let diff = crate::git::details::commit_file_diff(&PathBuf::from(&cwd), &rev, &path)?;
    tracing::debug!(%rev, %path, found = diff.is_some(), "git_commit_file_diff ok");
    Ok(diff)
}

/// Ask the remote what it has, so the ahead/behind counts are current.
///
/// The counts come from the local remote-tracking ref, which only moves when something fetches —
/// without this the tool reports `↓0` while upstream has moved on, which is a wrong number rather than
/// a missing one.
///
/// Never fails the caller: no remote, no `git`, no network and a refused credential are all reported
/// as an outcome rather than raised. Refreshing a display is not something worth an error dialog.
#[tauri::command]
pub async fn git_fetch(cwd: String) -> Result<String> {
    tracing::debug!(%cwd, "git_fetch");
    // `async` + `spawn_blocking`: a sync command runs on Tauri's main thread, and this one talks to a
    // REMOTE — it is bounded by somebody else's network, not by us (rule:rust-conventions).
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        crate::git::fetch::fetch(&PathBuf::from(&cwd))
    })
    .await
    .map_err(|e| crate::error::AppError::Other(format!("the fetch task failed: {e}")))??;
    Ok(match outcome {
        crate::git::fetch::Outcome::Fetched => String::new(),
        crate::git::fetch::Outcome::NoRemote => "no remote".into(),
        crate::git::fetch::Outcome::Unavailable => "git is not available".into(),
        crate::git::fetch::Outcome::Failed(reason) => reason,
    })
}
