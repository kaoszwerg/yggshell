//! The Git tool's IPC surface (ADR-PROJ-001). Read-only: nothing here writes to a repository.

use crate::dto::GitSnapshot;
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
