//! Keeping the notes repository in step with its remote.
//!
//! **This is the only file in the application permitted to run a writing git subcommand**, and
//! `scripts/project/check-git-writes.mjs` fails the build if `commit`, `push`, `add`, `rm`, `reset`,
//! `checkout`, `merge` or `rebase` appears anywhere else. YggShell runs `git` inside every project
//! the user has a tab in and every bit of that is read-only; a write path aimed at the wrong
//! directory would commit and push the maintainer's own work from a background timer, unasked
//! (ADR-PROJ-004).
//!
//! **The app holds no credentials and needs none.** It runs the user's own `git`, which finds them
//! where they already are — the SSH agent, the platform credential helper, `~/.gitconfig`. Nothing is
//! copied, stored or transmitted; `rule:security` allows a client to learn *that* a credential exists
//! and never its value, and here it learns neither.
//!
//! Everything else about how git is invoked is inherited from `git/fetch.rs`, which was built for the
//! auto-fetch and got it right: the binary comes from the captured login environment rather than the
//! process `PATH` (this app is launched from the dock, not a shell), every prompt is disabled because
//! nothing is attached to answer one, and there is a deadline on its own thread because `Command` has
//! none.

use crate::error::{AppError, Result};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// How long any one git call may take before the caller stops waiting.
///
/// Longer than the auto-fetch's, because this one may be pushing a first clone's worth of notes over
/// a slow link, and short enough that a wedged remote does not hold a sync for ever.
const TIMEOUT: Duration = Duration::from_secs(45);

/// What a remote URL is allowed to look like.
///
/// **`--upload-pack=…` is not a URL, it is a command.** Without this the settings field is an
/// execution hole: git would read a leading dash as an option however carefully the argument list was
/// built. Checked here *and* passed after `--` at the call site — the belt and the braces, because
/// this is the one input that reaches a process argument (ADR-PROJ-004).
pub fn valid_remote(url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() || url.starts_with('-') {
        return false;
    }
    if url.contains('\n') || url.contains('\r') || url.contains('\0') {
        return false;
    }
    url.starts_with("https://")
        || url.starts_with("http://")
        || url.starts_with("ssh://")
        // `user@host:path` — the SSH short form.
        || (url.contains('@') && url.contains(':'))
}

/// Where `git` is, from the captured login environment.
pub fn git_binary() -> Option<std::path::PathBuf> {
    crate::terminal::environment::which("git")
}

/// Run one git command in `cwd` and return its stdout, or git's own first error line.
///
/// **git's message is passed through verbatim**, and that is deliberate: "Permission denied
/// (publickey)" is actionable and "sync failed" is not. It is the whole reason the settings panel
/// carries the last error rather than a status word.
fn run(cwd: &Path, args: &[&str]) -> Result<String> {
    let Some(git) = git_binary() else {
        return Err(AppError::Other(
            "git is not on the PATH — notes stay local until it is".into(),
        ));
    };

    let mut command = Command::new(&git);
    command
        .current_dir(cwd)
        .args(args)
        // No prompts, from any of the three things that might raise one. There is no terminal
        // attached to a background sync, so a credential prompt would block until the timeout with
        // nothing on screen to explain it.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "")
        .env("SSH_ASKPASS", "")
        // `BatchMode` makes ssh fail instead of asking for a passphrase. The honest consequence: a
        // key that is not in the agent means the sync never succeeds — which is right for a
        // background task, and why the error is shown verbatim rather than swallowed.
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // The one addition over the fetch path, because pushing raises the stakes: without a socket ssh
    // has no agent at all, and a desktop launch does not inherit the shell's. "It works in my
    // terminal but not in the app" is a real and very confusing state.
    if std::env::var_os("SSH_AUTH_SOCK").is_none() {
        if let Some(sock) = crate::terminal::environment::login_env().get("SSH_AUTH_SOCK") {
            command.env("SSH_AUTH_SOCK", sock);
        }
    }

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(command.output());
    });

    match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(output)) if output.status.success() => {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        }
        Ok(Ok(output)) => {
            let reason = String::from_utf8_lossy(&output.stderr)
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("git failed")
                .trim()
                .to_string();
            tracing::info!(?args, %reason, "notes git failed");
            Err(AppError::Other(reason))
        }
        Ok(Err(error)) => {
            tracing::info!(?args, %error, "could not run git");
            Err(AppError::Other(error.to_string()))
        }
        Err(_) => {
            // The thread finishes into a dropped channel: the child cannot be killed safely from
            // here, and what matters is that the caller is not held any longer.
            tracing::info!(?args, "notes git timed out");
            Err(AppError::Other(format!(
                "no answer from the remote within {}s",
                TIMEOUT.as_secs()
            )))
        }
    }
}

/// Prepare the clone for `remote`, cloning it if there is nothing there yet.
///
/// **The repository must already exist.** The app never creates one: a creation flow would have to
/// choose a visibility, and choosing wrong is silent and permanent (ADR-PROJ-004). A remote it cannot
/// reach is reported with git's own words, where the URL was typed.
pub fn connect(clone_dir: &Path, remote: &str, branch: &str) -> Result<()> {
    if !valid_remote(remote) {
        return Err(AppError::Other(format!(
            "not a usable git remote: {remote}"
        )));
    }
    let parent = clone_dir
        .parent()
        .ok_or_else(|| AppError::Other("the clone has nowhere to live".into()))?;
    std::fs::create_dir_all(parent).map_err(|e| AppError::io(parent.display().to_string(), e))?;

    if clone_dir.join(".git").is_dir() {
        // Already a clone: point it at the remote the user named now, rather than the one they named
        // before. Changing the URL must never discard notes, so the working tree is left exactly as
        // it is — the local files are then offered to the new repository by the next push.
        let _ = run(clone_dir, &["remote", "remove", "origin"]);
        run(clone_dir, &["remote", "add", "origin", "--", remote])?;
        tracing::info!(remote, branch, "notes remote repointed");
        return Ok(());
    }

    // **A directory that already holds notes is ADOPTED, never cloned over.**
    //
    // Writing notes before naming a remote is the normal first path, not an edge case: the tool works
    // local-only until somebody types a URL, so by the time they do, the directory is full. `git
    // clone` refuses a non-empty destination — *"already exists and is not an empty directory"* — and
    // that error is what the maintainer saw the first time they connected.
    //
    // Adopting rather than cloning is also what keeps the promise that changing the remote never
    // discards notes: nothing is checked out over the working tree, so no local file is touched. The
    // local state becomes a commit, the remote's history is fetched, and ours is rebased on top —
    // where a conflict leaves both sides in the file, exactly as `pull` does.
    if clone_dir.exists() && std::fs::read_dir(clone_dir).is_ok_and(|mut d| d.next().is_some()) {
        return adopt(clone_dir, remote, branch);
    }

    let target = clone_dir.to_string_lossy().to_string();
    // `--` before the URL: the second half of the argument-injection defence in `valid_remote`.
    run(parent, &["clone", "--", remote, &target])?;
    if !branch.trim().is_empty() {
        // A branch that does not exist yet is not a failure — it is a repository being used for the
        // first time, and the first push creates it.
        let _ = run(clone_dir, &["checkout", branch]);
    }
    tracing::info!(remote, branch, "notes cloned");
    Ok(())
}

/// Turn a directory of existing local notes into a clone of `remote`, without touching a file.
///
/// The order matters and each step is there for a reason:
/// 1. `init` + `remote add` — the directory becomes a repository where it stands.
/// 2. commit what is there, so the local notes are *history* rather than uncommitted work that a
///    later operation could stash or discard.
/// 3. `fetch` — the remote's side, if it has one.
/// 4. `rebase` ours on top. Nothing is checked out over the working tree at any point, so a note
///    written here cannot be replaced by one written elsewhere without the user seeing both.
fn adopt(clone_dir: &Path, remote: &str, branch: &str) -> Result<()> {
    if !clone_dir.join(".git").is_dir() {
        run(clone_dir, &["init"])?;
    }
    union_merge(clone_dir)?;
    let _ = run(clone_dir, &["remote", "remove", "origin"]);
    run(clone_dir, &["remote", "add", "origin", "--", remote])?;

    run(clone_dir, &["add", "--all", "--", "."])?;
    let staged = run(clone_dir, &["status", "--porcelain"])?;
    if !staged.trim().is_empty() {
        run(
            clone_dir,
            &["commit", "--message", "notes: adopt local notes"],
        )?;
    }

    let target = if branch.trim().is_empty() {
        current_branch(clone_dir)
    } else {
        branch.trim().to_string()
    };
    let heads = run(clone_dir, &["ls-remote", "--heads", "origin", &target])?;
    if heads.trim().is_empty() {
        tracing::info!(remote, branch = %target, "notes adopted — the remote is empty");
        return Ok(());
    }

    run(clone_dir, &["fetch", "origin", &target])?;
    // A conflict here keeps BOTH sides' lines (see `union_merge`). If a rebase still stops for some
    // other reason, it is aborted rather than left standing: a repository frozen mid-rebase is a
    // state the user cannot get out of from inside this app, and the notes would silently stop
    // syncing until somebody opened a terminal in a directory they have never heard of.
    if let Err(error) = run(clone_dir, &["rebase", "FETCH_HEAD"]) {
        let _ = run(clone_dir, &["rebase", "--abort"]);
        return Err(error);
    }
    tracing::info!(remote, branch = %target, "notes adopted onto the remote's history");
    Ok(())
}

/// Keep BOTH sides of a conflicting note, without markers and without stopping.
///
/// `*.md merge=union` is git's own answer to exactly this shape of file: a list that grows at both
/// ends on two machines. The alternative behaviours are both worse here — "newest wins" silently
/// drops a paragraph written on the other machine, discovered only by going to look for it, and a
/// conflict that STOPS leaves the repository mid-rebase, which the user cannot get out of from inside
/// this app.
///
/// The cost is honest and small: a note that was edited on both machines briefly shows both versions'
/// lines, and the user deletes one. Briefly ugly, nothing ever lost (ADR-PROJ-004).
fn union_merge(clone_dir: &Path) -> Result<()> {
    let path = clone_dir.join(".gitattributes");
    let wanted = "*.md merge=union\n";
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    if !current.contains("merge=union") {
        std::fs::write(&path, format!("{current}{wanted}"))
            .map_err(|e| AppError::io(path.display().to_string(), e))?;
    }
    Ok(())
}

/// Pull, keeping both sides of a conflict rather than resolving one away.
///
/// Rebase, so the history stays linear; on a conflict the markers are left in the file and the sync
/// reports it. The file is briefly ugly and nothing is ever lost — where "newest wins" is clean and
/// silently drops a paragraph written on the other machine, discovered only by going to look for it.
///
/// **A branch the remote does not have yet is not a failure.** A repository being used for the first
/// time has no commits at all, and `git pull` answers that with *"Your configuration specifies to
/// merge with the ref 'refs/heads/main'"* — which would have been shown to the user as the sync's
/// error, for ever, on the one day it means nothing is wrong. Found by pushing to a real empty
/// repository; no unit test would have produced an unborn branch.
pub fn pull(clone_dir: &Path) -> Result<()> {
    union_merge(clone_dir)?;
    let branch = current_branch(clone_dir);
    let heads = run(clone_dir, &["ls-remote", "--heads", "origin", &branch])?;
    if heads.trim().is_empty() {
        tracing::info!(%branch, "nothing to pull — the remote has no such branch yet");
        return Ok(());
    }
    run(clone_dir, &["pull", "--rebase", "--autostash"])?;
    Ok(())
}

/// The branch the clone is on, or `main` when HEAD is unborn and git has no answer.
fn current_branch(clone_dir: &Path) -> String {
    run(clone_dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty() && name != "HEAD")
        .unwrap_or_else(|| "main".into())
}

/// Stage everything, commit if there is anything to commit, and push.
///
/// Returns `false` when there was nothing to send, so the caller can tell "up to date" from "sent".
pub fn push(clone_dir: &Path, message: &str) -> Result<bool> {
    run(clone_dir, &["add", "--all", "--", "."])?;
    let staged = run(clone_dir, &["status", "--porcelain"])?;
    let committed = !staged.trim().is_empty();
    if committed {
        run(clone_dir, &["commit", "--message", message])?;
    }
    // **Push even with nothing to commit.** The two are not the same question, and conflating them
    // was a real defect: after `connect` adopts a directory of existing notes, everything is already
    // committed — so an early return here left the notes sitting in a local commit that never went
    // anywhere, and the app reported success. Found by pushing to the real repository and looking.
    // A push with nothing to send answers "Everything up-to-date" and costs one cheap round trip.
    // `--set-upstream HEAD`, always. A fresh clone of an empty repository has no upstream to push
    // to, and a bare `git push` answers that with "has no upstream branch" — the same first-run
    // failure as the pull above, on the same day. Harmless once it is set.
    run(clone_dir, &["push", "--set-upstream", "origin", "HEAD"])?;
    tracing::info!("notes pushed");
    Ok(true)
}

/// Whether the clone is there and looks like a git repository.
pub fn is_clone(clone_dir: &Path) -> bool {
    clone_dir.join(".git").is_dir()
}
