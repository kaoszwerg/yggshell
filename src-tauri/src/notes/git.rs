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

/// Pull, keeping both sides of a conflict rather than resolving one away.
///
/// Rebase, so the history stays linear; on a conflict the markers are left in the file and the sync
/// reports it. The file is briefly ugly and nothing is ever lost — where "newest wins" is clean and
/// silently drops a paragraph written on the other machine, discovered only by going to look for it.
pub fn pull(clone_dir: &Path) -> Result<()> {
    run(clone_dir, &["pull", "--rebase", "--autostash"])?;
    Ok(())
}

/// Stage everything, commit if there is anything to commit, and push.
///
/// Returns `false` when there was nothing to send, so the caller can tell "up to date" from "sent".
pub fn push(clone_dir: &Path, message: &str) -> Result<bool> {
    run(clone_dir, &["add", "--all", "--", "."])?;
    let staged = run(clone_dir, &["status", "--porcelain"])?;
    if staged.trim().is_empty() {
        return Ok(false);
    }
    run(clone_dir, &["commit", "--message", message])?;
    run(clone_dir, &["push"])?;
    tracing::info!("notes pushed");
    Ok(true)
}

/// Whether the clone is there and looks like a git repository.
pub fn is_clone(clone_dir: &Path) -> bool {
    clone_dir.join(".git").is_dir()
}
