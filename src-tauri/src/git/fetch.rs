//! Asking the remote what it has, so `↑2 ↓0` is a fact rather than a memory.
//!
//! **Why this exists at all.** The ahead/behind counts are read from the local remote-tracking ref
//! (`refs/remotes/origin/main`), and that ref only moves when something fetches. Without this, the
//! tool shows `↓0` while upstream has moved on — and it does not say "I do not know", it says "none".
//! A number that is quietly wrong is worse than no number.
//!
//! **Why the `git` binary rather than gix's network client.** The hard part of talking to a remote is
//! not the protocol, it is the authentication: an SSH agent, a credential helper, a hardware key, a
//! host the user has an entry for in their own config. `git` already has all of that set up on the
//! machine, from the user's own configuration. Reimplementing it — or shipping a second network and
//! TLS stack to try — would be a large amount of code whose best possible outcome is behaving exactly
//! like the tool already installed. Same reasoning as tmux: use the program the user has.
//!
//! **It cannot touch the working tree.** `git fetch` writes remote-tracking refs and objects and
//! nothing else — no merge, no checkout, no index. That is precisely why this is the one network
//! operation the tool performs, and why nothing else here writes at all.

use crate::error::Result;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// How long a fetch is given before it is abandoned.
///
/// Bounded because this runs on a timer in the background: a remote that hangs — a VPN that is not up,
/// a host that blackholes the connection — must not leave a process waiting forever and a stale count
/// on screen with no explanation.
const TIMEOUT: Duration = Duration::from_secs(20);

/// What happened, in enough detail for the UI to say something true.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The remote was reached; the counts on screen are now current.
    Fetched,
    /// There is no remote to ask. Not a failure — plenty of repositories have none.
    NoRemote,
    /// `git` is not on PATH. Also not a failure; the counts simply cannot be refreshed.
    Unavailable,
    /// It was tried and did not work — offline, no credentials, a host that refused.
    Failed(String),
}

/// Fetch, without ever asking the user for anything.
///
/// **Every prompt is disabled**, and that is not a nicety: this runs on a timer with no terminal
/// attached, so a credential prompt would block until the timeout with nothing on screen to explain
/// why. A remote that needs credentials we do not have simply fails, which the caller can report.
pub fn fetch(cwd: &Path) -> Result<Outcome> {
    let Some(git) = crate::terminal::environment::which("git") else {
        tracing::debug!("git is not on PATH — cannot refresh the remote counts");
        return Ok(Outcome::Unavailable);
    };

    if !has_remote(&git, cwd) {
        return Ok(Outcome::NoRemote);
    }

    let mut command = Command::new(&git);
    command
        .current_dir(cwd)
        .args(["fetch", "--quiet", "--no-tags", "--prune"])
        // No prompts, from any of the three things that might raise one.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "")
        .env("SSH_ASKPASS", "")
        // `BatchMode` makes ssh fail instead of asking for a passphrase.
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    // On its own thread with a deadline: `Command` has no timeout, and a hanging remote would
    // otherwise hold this call — and the timer behind it — indefinitely.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(command.output());
    });

    match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(output)) if output.status.success() => {
            tracing::debug!(path = %cwd.display(), "fetched");
            Ok(Outcome::Fetched)
        }
        Ok(Ok(output)) => {
            // git's own message, trimmed to one line: it names the actual problem far better than
            // anything invented here would ("Could not read from remote repository", "Host key…").
            let reason = String::from_utf8_lossy(&output.stderr)
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("git fetch failed")
                .trim()
                .to_string();
            tracing::info!(path = %cwd.display(), %reason, "could not fetch");
            Ok(Outcome::Failed(reason))
        }
        Ok(Err(error)) => {
            tracing::info!(path = %cwd.display(), %error, "could not run git fetch");
            Ok(Outcome::Failed(error.to_string()))
        }
        Err(_) => {
            // The thread is left to finish into a dropped channel: the child cannot be killed safely
            // from here, and what matters is that the caller is not held any longer.
            tracing::info!(path = %cwd.display(), "git fetch timed out");
            Ok(Outcome::Failed(format!(
                "no answer from the remote within {}s",
                TIMEOUT.as_secs()
            )))
        }
    }
}

/// Whether this repository has any remote configured at all.
///
/// Asked before fetching so a repository with none reports that rather than an error, and so the
/// common case of a purely local repository costs one cheap call instead of a network attempt.
fn has_remote(git: &Path, cwd: &Path) -> bool {
    Command::new(git)
        .current_dir(cwd)
        .args(["remote"])
        .stdin(Stdio::null())
        .output()
        .is_ok_and(|out| out.status.success() && !out.stdout.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_directory_with_no_repository_is_reported_rather_than_erroring() {
        // The tool follows the terminal, and most of the filesystem is not a repository.
        let dir = tempfile::tempdir().expect("tempdir");
        let outcome = fetch(dir.path()).expect("no error");
        assert!(
            matches!(outcome, Outcome::NoRemote | Outcome::Unavailable),
            "got {outcome:?}"
        );
    }

    #[test]
    fn a_repository_without_a_remote_says_so() {
        let dir = tempfile::tempdir().expect("tempdir");
        gix::init(dir.path()).expect("init");

        let outcome = fetch(dir.path()).expect("no error");
        assert!(
            matches!(outcome, Outcome::NoRemote | Outcome::Unavailable),
            "a repository with no remote is not a failure, got {outcome:?}"
        );
    }

    #[test]
    fn a_remote_that_cannot_be_reached_fails_without_waiting_for_a_password() {
        // The property that matters most: this runs on a timer with no terminal attached, so a
        // credential prompt would hang until the timeout with nothing on screen to explain it.
        let dir = tempfile::tempdir().expect("tempdir");
        gix::init(dir.path()).expect("init");
        std::process::Command::new("git")
            .current_dir(dir.path())
            .args([
                "remote",
                "add",
                "origin",
                "https://example.invalid/nothing.git",
            ])
            .output()
            .expect("add remote");

        let started = std::time::Instant::now();
        let outcome = fetch(dir.path()).expect("no error");

        assert!(matches!(outcome, Outcome::Failed(_)), "got {outcome:?}");
        assert!(
            started.elapsed() < TIMEOUT,
            "it must fail rather than sit on the timeout"
        );
    }

    #[test]
    fn fetching_never_touches_the_working_tree() {
        // The reason this is the one network operation the tool performs: `git fetch` writes
        // remote-tracking refs and objects, and nothing a user would notice.
        let dir = tempfile::tempdir().expect("tempdir");
        gix::init(dir.path()).expect("init");
        std::fs::write(dir.path().join("work.txt"), "mine").expect("write");

        let _ = fetch(dir.path());

        assert_eq!(
            std::fs::read_to_string(dir.path().join("work.txt")).expect("read"),
            "mine"
        );
    }
}
