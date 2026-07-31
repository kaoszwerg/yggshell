//! The two things you get by clicking in the Git tool: what changed in a file, and what a commit is.
//!
//! Still read-only (see the module header of the parent): this reads blobs and walks trees, and there
//! is no path from here to a write.
//!
//! **A path from the frontend is a path from outside** (rule:security). Every one of these commands
//! takes a repository-relative path chosen from a list the backend itself produced — but it arrives
//! over the IPC, so it is checked against the repository rather than trusted: it is rejected if it
//! escapes the working tree, and the blob it names is read through git, not through the filesystem,
//! wherever git has it.

use super::{diff, other};
use crate::dto::{GitCommitDetail, GitDiff, GitFileStat};
use crate::error::{AppError, Result};
use std::path::{Component, Path};

/// What changed in one working-tree file.
///
/// `staged` selects which side of the change is meant: the staged side compares `HEAD` with the
/// index, the unstaged side compares the index with the file on disk. They are genuinely different
/// diffs — a file can be both, which is why the tool lists it twice.
pub fn file_diff(cwd: &Path, path: &str, staged: bool) -> Result<Option<GitDiff>> {
    let Some(repo) = open(cwd)? else {
        return Ok(None);
    };
    let relative = relative(path)?;

    let (old, old_present) = if staged {
        blob_in_head(&repo, &relative)?
    } else {
        blob_in_index(&repo, &relative)?
    };
    let (new, new_present) = if staged {
        blob_in_index(&repo, &relative)?
    } else {
        blob_in_worktree(&repo, &relative)?
    };

    let status = match (old_present, new_present) {
        (false, true) => "added",
        (true, false) => "deleted",
        _ => "modified",
    };

    Ok(Some(build(
        path.to_string(),
        None,
        status.to_string(),
        staged,
        &old,
        &new,
    )))
}

/// Everything about one commit: its whole message, who wrote it, and which files it touched.
pub fn commit_detail(cwd: &Path, rev: &str) -> Result<Option<GitCommitDetail>> {
    let Some(repo) = open(cwd)? else {
        return Ok(None);
    };
    let id = resolve(&repo, rev)?;
    let commit = repo.find_commit(id).map_err(other("read a commit"))?;

    let message = commit.message().map_err(other("read a commit message"))?;
    let summary = message.summary().to_string();
    let body = message
        .body()
        .map(|b| b.to_string())
        .unwrap_or_else(String::new);

    let author = commit.author().map_err(other("read a commit author"))?;
    let refs = super::refs_by_commit(&repo)
        .get(&id)
        .cloned()
        .unwrap_or_default();

    let files = changed_files(&repo, &commit)?;

    Ok(Some(GitCommitDetail {
        sha: id.to_string(),
        short_sha: id.to_hex_with_len(7).to_string(),
        summary,
        body,
        author_name: author.name.to_string(),
        author_email: author.email.to_string(),
        authored_at: author
            .time()
            .ok()
            .and_then(|t| t.format(gix::date::time::format::ISO8601_STRICT).ok())
            .unwrap_or_default(),
        parents: commit
            .parent_ids()
            .map(|p| p.detach().to_string())
            .collect(),
        refs,
        files,
    }))
}

/// What one file looks like inside one commit, compared with its first parent.
///
/// The first parent, not all of them: a merge diffed against every side produces the combined diff
/// git itself only shows on request, and it is not what someone clicking a file in a merge wants to
/// read.
pub fn commit_file_diff(cwd: &Path, rev: &str, path: &str) -> Result<Option<GitDiff>> {
    let Some(repo) = open(cwd)? else {
        return Ok(None);
    };
    let relative = relative(path)?;
    let id = resolve(&repo, rev)?;
    let commit = repo.find_commit(id).map_err(other("read a commit"))?;

    let new = blob_in_commit(&commit, &relative)?;
    let old = match commit.parent_ids().next() {
        Some(parent) => {
            let parent = repo
                .find_commit(parent.detach())
                .map_err(other("read a parent commit"))?;
            blob_in_commit(&parent, &relative)?
        }
        None => (Vec::new(), false),
    };

    let status = match (old.1, new.1) {
        (false, true) => "added",
        (true, false) => "deleted",
        _ => "modified",
    };

    Ok(Some(build(
        path.to_string(),
        None,
        status.to_string(),
        true,
        &old.0,
        &new.0,
    )))
}

/// Assemble a `GitDiff` from two blobs, deciding first whether there is anything to show.
fn build(
    path: String,
    old_path: Option<String>,
    status: String,
    staged: bool,
    old: &[u8],
    new: &[u8],
) -> GitDiff {
    let binary = diff::is_binary(old) || diff::is_binary(new);
    let hunks = if binary {
        Vec::new()
    } else {
        diff::hunks(old, new)
    };
    let (added, removed) = diff::totals(&hunks);
    GitDiff {
        path,
        old_path,
        status,
        staged,
        binary,
        hunks,
        added,
        removed,
    }
}

/// The files a commit touched, against its first parent, with line counts.
fn changed_files(repo: &gix::Repository, commit: &gix::Commit<'_>) -> Result<Vec<GitFileStat>> {
    let tree = commit.tree().map_err(other("read a commit tree"))?;
    let parent_tree = match commit.parent_ids().next() {
        Some(parent) => Some(
            repo.find_commit(parent.detach())
                .map_err(other("read a parent commit"))?
                .tree()
                .map_err(other("read a parent tree"))?,
        ),
        None => None,
    };

    let changes = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .map_err(other("compare two trees"))?;

    let mut files = Vec::new();
    for change in changes {
        let stat = match change {
            gix::object::tree::diff::ChangeDetached::Addition { location, id, .. } => {
                stat_for(repo, location.to_string(), None, "added", None, Some(id))
            }
            gix::object::tree::diff::ChangeDetached::Deletion { location, id, .. } => {
                stat_for(repo, location.to_string(), None, "deleted", Some(id), None)
            }
            gix::object::tree::diff::ChangeDetached::Modification {
                location,
                previous_id,
                id,
                ..
            } => stat_for(
                repo,
                location.to_string(),
                None,
                "modified",
                Some(previous_id),
                Some(id),
            ),
            gix::object::tree::diff::ChangeDetached::Rewrite {
                location,
                source_location,
                source_id,
                id,
                ..
            } => stat_for(
                repo,
                location.to_string(),
                Some(source_location.to_string()),
                "renamed",
                Some(source_id),
                Some(id),
            ),
        };
        files.push(stat);
    }
    // A directory listing order is an implementation detail; a reader expects paths in order.
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Line counts for one changed file. A blob that cannot be read counts as empty rather than failing
/// the whole commit: one unreadable object must not cost the user the other twenty files.
fn stat_for(
    repo: &gix::Repository,
    path: String,
    old_path: Option<String>,
    status: &str,
    old: Option<gix::ObjectId>,
    new: Option<gix::ObjectId>,
) -> GitFileStat {
    let read = |id: Option<gix::ObjectId>| -> Vec<u8> {
        id.and_then(|id| repo.find_object(id).ok())
            .map(|object| object.data.clone())
            .unwrap_or_default()
    };
    let old = read(old);
    let new = read(new);
    let binary = diff::is_binary(&old) || diff::is_binary(&new);
    let (added, removed) = if binary {
        (0, 0)
    } else {
        diff::totals(&diff::hunks(&old, &new))
    };
    GitFileStat {
        path,
        old_path,
        status: status.to_string(),
        added,
        removed,
        binary,
    }
}

/// Open the repository `cwd` is in, or report that there is none.
fn open(cwd: &Path) -> Result<Option<gix::Repository>> {
    match gix::discover(cwd) {
        Ok(repo) => Ok(Some(repo)),
        Err(e) => {
            tracing::debug!(path = %cwd.display(), error = %e, "not a git repository");
            Ok(None)
        }
    }
}

/// Validate a repository-relative path that arrived over the IPC.
///
/// The frontend only ever sends a path this backend listed, but "only ever" is a statement about the
/// frontend, and the frontend is the untrusted side (rule:security). An absolute path or a `..`
/// component would let a caller read outside the repository, so both are refused here rather than
/// somewhere deeper where the consequence is a file read.
fn relative(path: &str) -> Result<String> {
    let candidate = Path::new(path);
    let escapes = candidate.is_absolute()
        || candidate
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)));
    if path.is_empty() || escapes {
        tracing::warn!(%path, "refusing a path that is not inside the repository");
        return Err(AppError::Other(format!(
            "git: not a path inside the repository: {path}"
        )));
    }
    Ok(path.replace('\\', "/"))
}

/// Resolve a revision the frontend named — always a full sha it got from us, but resolved rather
/// than assumed, so a stale one fails as an error instead of reading the wrong object.
fn resolve(repo: &gix::Repository, rev: &str) -> Result<gix::ObjectId> {
    Ok(repo
        .rev_parse_single(rev)
        .map_err(other("resolve a revision"))?
        .detach())
}

/// The blob at `path` in `HEAD`, and whether it was there at all.
fn blob_in_head(repo: &gix::Repository, path: &str) -> Result<(Vec<u8>, bool)> {
    let Ok(commit) = repo.head_commit() else {
        // An unborn HEAD: nothing is committed yet, so everything staged is an addition.
        return Ok((Vec::new(), false));
    };
    blob_in_commit(&commit, path)
}

fn blob_in_commit(commit: &gix::Commit<'_>, path: &str) -> Result<(Vec<u8>, bool)> {
    let mut tree = commit.tree().map_err(other("read a commit tree"))?;
    let Ok(Some(entry)) = tree.peel_to_entry_by_path(path) else {
        return Ok((Vec::new(), false));
    };
    let object = entry.object().map_err(other("read a blob"))?;
    Ok((object.data.clone(), true))
}

/// The blob at `path` in the index — what a commit right now would contain.
fn blob_in_index(repo: &gix::Repository, path: &str) -> Result<(Vec<u8>, bool)> {
    let index = match repo.index_or_empty() {
        Ok(index) => index,
        Err(e) => return Err(other("read the index")(e)),
    };
    let Some(entry) = index.entry_by_path(path.into()) else {
        return Ok((Vec::new(), false));
    };
    let object = repo.find_object(entry.id).map_err(other("read a blob"))?;
    Ok((object.data.clone(), true))
}

/// The file on disk. Absent — deleted, or never tracked — reads as empty and *not present*.
fn blob_in_worktree(repo: &gix::Repository, path: &str) -> Result<(Vec<u8>, bool)> {
    let Some(root) = repo.workdir() else {
        // A bare repository has no working tree; there is no unstaged side to show.
        return Ok((Vec::new(), false));
    };
    let full = root.join(path);
    match std::fs::read(&full) {
        Ok(bytes) => Ok((bytes, true)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((Vec::new(), false)),
        Err(e) => Err(AppError::io(full.display().to_string(), e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A repository with one commit, built with gix itself so the test needs no `git` binary.
    struct Fixture {
        dir: tempfile::TempDir,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("tempdir");
            gix::init(dir.path()).expect("init");
            Self { dir }
        }

        fn path(&self) -> &Path {
            self.dir.path()
        }

        fn write(&self, name: &str, content: &str) -> PathBuf {
            let full = self.dir.path().join(name);
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent).expect("mkdir");
            }
            std::fs::write(&full, content).expect("write");
            full
        }

        /// Commit everything currently on disk, and return the new commit's id.
        fn commit(&self, message: &str) -> gix::ObjectId {
            let repo = gix::discover(self.dir.path()).expect("discover");
            let mut entries: Vec<(String, gix::ObjectId)> = Vec::new();
            for entry in walkdir(self.dir.path(), self.dir.path()) {
                let bytes = std::fs::read(self.dir.path().join(&entry)).expect("read");
                let id = repo.write_blob(bytes).expect("write blob").detach();
                entries.push((entry, id));
            }
            entries.sort();

            let mut tree = gix::objs::Tree::empty();
            for (path, id) in entries {
                tree.entries.push(gix::objs::tree::Entry {
                    mode: gix::objs::tree::EntryKind::Blob.into(),
                    filename: path.into(),
                    oid: id,
                });
            }
            let tree_id = repo.write_object(&tree).expect("write tree").detach();
            let parents: Vec<gix::ObjectId> = repo
                .head_id()
                .ok()
                .map(|id| id.detach())
                .into_iter()
                .collect();
            let id = repo
                .commit("HEAD", message, tree_id, parents)
                .expect("commit")
                .detach();
            // Write the index too. `git commit` does, and a repository whose index is empty while
            // HEAD is not is a state git never leaves behind — testing against it would be testing a
            // shape the code will never meet.
            let mut index = repo.index_from_tree(&tree_id).expect("index from tree");
            index.write(Default::default()).expect("write index");
            id
        }
    }

    /// Flat listing of the working tree, skipping `.git`. Enough for a fixture; not a general tool.
    fn walkdir(root: &Path, at: &Path) -> Vec<String> {
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(at) else {
            return out;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                continue;
            }
            if path.is_dir() {
                out.extend(walkdir(root, &path));
            } else if let Ok(relative) = path.strip_prefix(root) {
                out.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
        out
    }

    #[test]
    fn outside_a_repository_everything_answers_none_rather_than_failing() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(file_diff(dir.path(), "a.txt", false)
            .expect("no error")
            .is_none());
        assert!(commit_detail(dir.path(), "HEAD")
            .expect("no error")
            .is_none());
        assert!(commit_file_diff(dir.path(), "HEAD", "a.txt")
            .expect("no error")
            .is_none());
    }

    #[test]
    fn an_edit_on_disk_shows_as_an_unstaged_modification() {
        let fixture = Fixture::new();
        fixture.write("notes.txt", "one\ntwo\nthree\n");
        fixture.commit("first");
        fixture.write("notes.txt", "one\nTWO\nthree\n");

        let diff = file_diff(fixture.path(), "notes.txt", false)
            .expect("no error")
            .expect("a repository");

        assert_eq!(diff.status, "modified");
        assert!(!diff.staged);
        assert!(!diff.binary);
        assert_eq!((diff.added, diff.removed), (1, 1));
        let hunk = diff.hunks.first().expect("one hunk");
        assert!(hunk.header.starts_with("@@ "));
        assert!(hunk
            .lines
            .iter()
            .any(|l| l.kind == "added" && l.text == "TWO"));
    }

    #[test]
    fn a_file_that_matches_the_index_has_no_hunks_at_all() {
        let fixture = Fixture::new();
        fixture.write("notes.txt", "unchanged\n");
        fixture.commit("first");

        let diff = file_diff(fixture.path(), "notes.txt", false)
            .expect("no error")
            .expect("a repository");
        // Nothing to show is a state the UI must render as such, not an empty panel it mistakes for
        // a failure — which is why this is asserted rather than left to chance.
        assert!(diff.hunks.is_empty());
        assert_eq!((diff.added, diff.removed), (0, 0));
    }

    #[test]
    fn an_untracked_file_reads_as_an_addition_of_its_whole_contents() {
        let fixture = Fixture::new();
        fixture.write("kept.txt", "kept\n");
        fixture.commit("first");
        fixture.write("fresh.txt", "line one\nline two\n");

        let diff = file_diff(fixture.path(), "fresh.txt", false)
            .expect("no error")
            .expect("a repository");

        assert_eq!(diff.status, "added");
        assert_eq!((diff.added, diff.removed), (2, 0));
    }

    #[test]
    fn a_deleted_file_reads_as_a_deletion_rather_than_an_error() {
        let fixture = Fixture::new();
        fixture.write("gone.txt", "here\nfor now\n");
        fixture.commit("first");
        std::fs::remove_file(fixture.path().join("gone.txt")).expect("remove");

        let diff = file_diff(fixture.path(), "gone.txt", false)
            .expect("no error")
            .expect("a repository");

        assert_eq!(diff.status, "deleted");
        assert_eq!((diff.added, diff.removed), (0, 2));
    }

    #[test]
    fn a_binary_file_reports_itself_binary_and_produces_no_hunks() {
        let fixture = Fixture::new();
        fixture.write("data.bin", "placeholder\n");
        fixture.commit("first");
        std::fs::write(fixture.path().join("data.bin"), [0u8, 1, 2, 3, 0, 5]).expect("write");

        let diff = file_diff(fixture.path(), "data.bin", false)
            .expect("no error")
            .expect("a repository");

        assert!(diff.binary);
        assert!(diff.hunks.is_empty());
    }

    #[test]
    fn a_commit_carries_its_whole_message_not_just_the_summary() {
        let fixture = Fixture::new();
        fixture.write("a.txt", "one\n");
        let id = fixture.commit(
            "feat: the summary\n\nThe body, which the graph never shows.\nA second line of it.\n",
        );

        let detail = commit_detail(fixture.path(), &id.to_string())
            .expect("no error")
            .expect("a repository");

        assert_eq!(detail.summary, "feat: the summary");
        assert!(detail
            .body
            .contains("The body, which the graph never shows."));
        assert!(detail.body.contains("A second line of it."));
        assert_eq!(detail.sha, id.to_string());
        assert_eq!(detail.short_sha.len(), 7);
        assert!(detail.parents.is_empty(), "the first commit has no parent");
        assert!(!detail.authored_at.is_empty());
    }

    #[test]
    fn a_commit_lists_the_files_it_touched_with_their_line_counts() {
        let fixture = Fixture::new();
        fixture.write("kept.txt", "same\n");
        fixture.write("edited.txt", "one\ntwo\n");
        fixture.commit("first");
        fixture.write("edited.txt", "one\nTWO\nthree\n");
        fixture.write("added.txt", "new\n");
        let second = fixture.commit("second");

        let detail = commit_detail(fixture.path(), &second.to_string())
            .expect("no error")
            .expect("a repository");

        let paths: Vec<&str> = detail.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            ["added.txt", "edited.txt"],
            "untouched files stay out"
        );

        let edited = detail
            .files
            .iter()
            .find(|f| f.path == "edited.txt")
            .expect("the edited file");
        assert_eq!(edited.status, "modified");
        assert_eq!((edited.added, edited.removed), (2, 1));
    }

    #[test]
    fn a_file_inside_a_commit_diffs_against_its_first_parent() {
        let fixture = Fixture::new();
        fixture.write("notes.txt", "one\ntwo\n");
        fixture.commit("first");
        fixture.write("notes.txt", "one\nTWO\n");
        let second = fixture.commit("second");

        let diff = commit_file_diff(fixture.path(), &second.to_string(), "notes.txt")
            .expect("no error")
            .expect("a repository");

        assert_eq!(diff.status, "modified");
        assert_eq!((diff.added, diff.removed), (1, 1));
    }

    #[test]
    fn a_path_that_escapes_the_repository_is_refused() {
        // The frontend only ever sends a path we listed — but it is the untrusted side, so this is
        // checked rather than assumed (rule:security).
        let fixture = Fixture::new();
        fixture.write("a.txt", "x\n");
        fixture.commit("first");

        for escape in ["../../etc/passwd", "/etc/passwd", ""] {
            let refused = file_diff(fixture.path(), escape, false);
            assert!(refused.is_err(), "{escape:?} must be refused");
        }
    }

    #[test]
    fn a_revision_that_does_not_exist_is_an_error_not_a_wrong_object() {
        let fixture = Fixture::new();
        fixture.write("a.txt", "x\n");
        fixture.commit("first");

        assert!(commit_detail(fixture.path(), "0000000000000000000000000000000000000000").is_err());
    }
}
