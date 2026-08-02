//! Reading a repository — and the **only** module permitted to name `gix` (ADR-PROJ-001 C3).
//!
//! Same discipline as `terminal::pty`: everything above speaks the DTOs, so swapping the Git
//! implementation costs this file rather than a rewrite. `gix` was chosen over `git2` because it is
//! pure Rust — no libgit2 C build to get working on three platforms — at the cost of a much larger
//! dependency tree, which is recorded rather than discovered later.
//!
//! **Read-only, on purpose.** Nothing here stages, commits, pushes or checks anything out. The tool
//! exists to show you what the harness in the terminal is doing to your repository; a button that
//! rewrites history sitting next to an agent that edits files is a combination nobody asked for.

pub mod details;
pub mod diff;
pub mod fetch;

use crate::dto::{GitChange, GitCommit, GitSnapshot};
use crate::error::{AppError, Result};
use std::collections::HashMap;
use std::path::Path;

/// How much history the tool shows. Enough to see where a branch stands without walking a repository
/// with a decade in it on every refresh.
const HISTORY_LIMIT: usize = 40;

/// Read everything the Git tool renders, in one pass.
///
/// `Ok(None)` means "this directory is not in a repository", which is the normal case for most of the
/// filesystem and not a failure worth surfacing as an error.
pub fn snapshot(cwd: &Path) -> Result<Option<GitSnapshot>> {
    let repo = match gix::discover(cwd) {
        Ok(repo) => repo,
        Err(e) => {
            tracing::debug!(path = %cwd.display(), error = %e, "not a git repository");
            return Ok(None);
        }
    };

    let root = repo
        .workdir()
        .unwrap_or_else(|| repo.git_dir())
        .to_string_lossy()
        .into_owned();

    let head = repo.head().map_err(other("read HEAD"))?;
    let detached = head.is_detached();
    let branch = repo
        .head_name()
        .map_err(other("read HEAD name"))?
        .map(|name| name.shorten().to_string());
    let head_id = repo.head_id().ok().map(|id| id.detach());

    let changes = read_changes(&repo)?;
    let refs = refs_by_commit(&repo);
    let commits = read_history(&repo, head_id, &refs)?;
    let (ahead, behind) = ahead_behind(&repo, head_id);

    tracing::debug!(
        root = %root,
        branch = branch.as_deref().unwrap_or("<detached>"),
        changes = changes.len(),
        commits = commits.len(),
        ahead,
        behind,
        "git snapshot"
    );

    Ok(Some(GitSnapshot {
        root,
        remote: origin_url(&repo),
        branch,
        detached,
        head: head_id.map(|id| id.to_hex_with_len(7).to_string()),
        ahead,
        behind,
        changes,
        commits,
    }))
}

/// The `origin` remote's URL, read from the repository's own config.
///
/// `None` for a repository with no remote, which is a normal state and not a failure — the notes
/// tool falls back to the folder name for those.
fn origin_url(repo: &gix::Repository) -> Option<String> {
    repo.find_remote("origin")
        .ok()?
        .url(gix::remote::Direction::Fetch)
        .map(|url| url.to_bstring().to_string())
}

/// Everything the index and the working tree disagree about, staged and unstaged alike.
fn read_changes(repo: &gix::Repository) -> Result<Vec<GitChange>> {
    let platform = repo
        .status(gix::progress::Discard)
        .map_err(other("open status"))?;
    let iter = platform
        .into_iter(None)
        .map_err(other("walk the working tree"))?;

    let mut changes = Vec::new();
    for item in iter {
        let item = item.map_err(other("read a status entry"))?;
        match item {
            // HEAD vs index: what a commit would contain.
            gix::status::Item::TreeIndex(change) => {
                use gix::diff::index::Change;
                let (path, status) = match &change {
                    Change::Addition { location, .. } => (location, "added"),
                    Change::Deletion { location, .. } => (location, "deleted"),
                    Change::Modification { location, .. } => (location, "modified"),
                    Change::Rewrite { location, .. } => (location, "renamed"),
                };
                changes.push(GitChange {
                    path: path.to_string(),
                    status: status.to_string(),
                    staged: true,
                });
            }
            // Index vs working tree: what is edited but not staged — untracked files included.
            gix::status::Item::IndexWorktree(change) => {
                use gix::status::index_worktree::Item;
                let (path, status) = match &change {
                    Item::Modification {
                        rela_path, status, ..
                    } => {
                        use gix::status::plumbing::index_as_worktree::EntryStatus;
                        let kind = match status {
                            EntryStatus::Conflict { .. } => "conflicted",
                            _ => "modified",
                        };
                        (rela_path.to_string(), kind)
                    }
                    Item::DirectoryContents { entry, .. } => {
                        (entry.rela_path.to_string(), "untracked")
                    }
                    Item::Rewrite { dirwalk_entry, .. } => {
                        (dirwalk_entry.rela_path.to_string(), "renamed")
                    }
                };
                changes.push(GitChange {
                    path,
                    status: status.to_string(),
                    staged: false,
                });
            }
        }
    }

    // Stable order, so a refresh does not reshuffle the list under the pointer.
    changes.sort_by(|a, b| a.path.cmp(&b.path).then(b.staged.cmp(&a.staged)));
    Ok(changes)
}

/// Branch and tag names, grouped by the commit they point at, so the history can be labelled.
fn refs_by_commit(repo: &gix::Repository) -> HashMap<gix::ObjectId, Vec<String>> {
    let mut map: HashMap<gix::ObjectId, Vec<String>> = HashMap::new();
    let Ok(platform) = repo.references() else {
        return map;
    };
    let Ok(all) = platform.all() else { return map };

    for reference in all.flatten() {
        let name = reference.name().shorten().to_string();
        // Peeled, so an annotated tag lands on the commit it names rather than on the tag object.
        let Ok(id) = reference.into_fully_peeled_id() else {
            continue;
        };
        map.entry(id.detach()).or_default().push(name);
    }
    map
}

/// The last [`HISTORY_LIMIT`] commits, newest first, from **every local branch** — not only HEAD's.
///
/// Walking from HEAD alone hides exactly what a history view is for: a branch you are not on. The
/// walk therefore starts at every local branch tip (plus HEAD, which may be detached and on none of
/// them) and is sorted by commit time, so the rows read as one timeline the way they do in an editor.
fn read_history(
    repo: &gix::Repository,
    head: Option<gix::ObjectId>,
    refs: &HashMap<gix::ObjectId, Vec<String>>,
) -> Result<Vec<GitCommit>> {
    let mut tips: Vec<gix::ObjectId> = Vec::new();
    if let Some(head) = head {
        tips.push(head);
    }
    if let Ok(platform) = repo.references() {
        if let Ok(branches) = platform.local_branches() {
            for branch in branches.flatten() {
                if let Ok(id) = branch.into_fully_peeled_id() {
                    let id = id.detach();
                    if !tips.contains(&id) {
                        tips.push(id);
                    }
                }
            }
        }
    }
    if tips.is_empty() {
        return Ok(Vec::new());
    }

    let walk = repo
        .rev_walk(tips)
        // By time, not by graph order: with several tips, breadth-first would interleave branches in
        // an order that means nothing to a reader.
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .map_err(other("walk the history"))?;

    let mut commits = Vec::with_capacity(HISTORY_LIMIT);
    for info in walk.take(HISTORY_LIMIT) {
        let info = info.map_err(other("read a commit"))?;
        let id = info.id;
        let Ok(commit) = repo.find_commit(id) else {
            continue;
        };
        let message = commit.message_raw_sloppy();
        let summary = String::from_utf8_lossy(message)
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        let author = commit
            .author()
            .map(|a| a.name.to_string())
            .unwrap_or_default();
        let when = commit
            .time()
            .ok()
            .and_then(|t| t.format(gix::date::time::format::ISO8601).ok())
            .unwrap_or_default();

        commits.push(GitCommit {
            sha: id.to_string(),
            short_sha: id.to_hex_with_len(7).to_string(),
            summary,
            author,
            when,
            parents: commit
                .parent_ids()
                .map(|p| p.detach().to_string())
                .collect(),
            refs: refs.get(&id).cloned().unwrap_or_default(),
        });
    }
    Ok(commits)
}

/// How far HEAD is ahead of and behind its upstream branch.
///
/// Best-effort by design: a branch with no upstream, an unborn HEAD or a missing remote ref all mean
/// "nothing to compare", not an error. Returning `(0, 0)` is the honest answer there — the tool then
/// simply shows no counters, rather than a failure the user can do nothing about.
fn ahead_behind(repo: &gix::Repository, head: Option<gix::ObjectId>) -> (u32, u32) {
    let Some(head) = head else { return (0, 0) };
    let Some(Ok(upstream)) = repo
        .head_ref()
        .ok()
        .flatten()
        .and_then(|r| r.remote_tracking_ref_name(gix::remote::Direction::Fetch))
    else {
        return (0, 0);
    };
    let Ok(mut upstream_ref) = repo.find_reference(upstream.as_ref()) else {
        return (0, 0);
    };
    let Ok(upstream_id) = upstream_ref.peel_to_id() else {
        return (0, 0);
    };
    let upstream_id = upstream_id.detach();
    if upstream_id == head {
        return (0, 0);
    }

    // Counted by hiding the other side: what is reachable from HEAD but not from the upstream is
    // exactly what is unpushed, and the mirror image is what has not been merged in.
    let count = |from: gix::ObjectId, hide: gix::ObjectId| -> u32 {
        repo.rev_walk([from])
            .with_hidden([hide])
            .all()
            .map(|walk| u32::try_from(walk.take_while(|c| c.is_ok()).count()).unwrap_or(u32::MAX))
            .unwrap_or(0)
    };
    (count(head, upstream_id), count(upstream_id, head))
}

/// Every `gix` error becomes the same shape, tagged with what was being attempted — "read HEAD
/// failed" is actionable, a bare library error string is not.
fn other<E: std::fmt::Display>(what: &'static str) -> impl Fn(E) -> AppError {
    move |e| AppError::Other(format!("git: could not {what}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_directory_outside_a_repository_is_not_an_error() {
        // Most of the filesystem is not a repository. Reporting that as a failure would put an error
        // in front of the user every time a terminal sits in /tmp.
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(snapshot(dir.path()).expect("no error").is_none());
    }

    #[test]
    fn a_fresh_repository_reports_its_root_and_its_untracked_files() {
        // Against a real repository, created here: the non-repo cases below prove the guard, not that
        // reading one works. Built with gix itself rather than by shelling out to `git`, so the test
        // does not depend on a binary being installed (rule:testing).
        let dir = tempfile::tempdir().expect("tempdir");
        gix::init(dir.path()).expect("init");
        std::fs::write(dir.path().join("notes.txt"), b"hello").expect("write");

        let snapshot = snapshot(dir.path())
            .expect("no error")
            .expect("a repository");

        assert!(
            snapshot.root.contains(
                dir.path()
                    .file_name()
                    .expect("name")
                    .to_string_lossy()
                    .as_ref()
            ),
            "the root points at the working tree, got {}",
            snapshot.root
        );
        // A repository with no commits has an unborn HEAD — a branch name but nothing to point at.
        assert!(snapshot.head.is_none());
        assert!(snapshot.commits.is_empty());
        assert_eq!(snapshot.ahead, 0);
        assert_eq!(snapshot.behind, 0);

        let untracked = snapshot
            .changes
            .iter()
            .find(|c| c.path == "notes.txt")
            .expect("the new file shows up");
        assert_eq!(untracked.status, "untracked");
        assert!(!untracked.staged);
    }

    #[test]
    fn a_missing_path_is_not_an_error_either() {
        assert!(snapshot(Path::new("/definitely/not/here"))
            .expect("no error")
            .is_none());
    }
}
