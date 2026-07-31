//! The environment a *login shell* provides — captured once, because a GUI application does not get
//! it.
//!
//! macOS launches an app from Finder or Dock through `launchd`, which hands it a minimal
//! `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. Everything a developer actually has — Homebrew, mise, asdf,
//! a language toolchain — lives in `PATH` entries that only exist after a login shell has run
//! `/etc/zprofile` (`path_helper`) and `~/.zprofile`. None of that is visible to the process.
//!
//! The symptom is not subtle once you know it, and thoroughly confusing before: the bundled app
//! reports `command not found: direnv` from the user's own `.zshrc`, and the tmux integration
//! quietly falls back to a plain shell because `tmux` is "not installed". Both were true of the
//! process; neither was true of the machine. In `tauri dev` it never shows, because the app inherits
//! the environment of the terminal that started it — which is exactly the environment that is missing
//! in a real build.
//!
//! So the login shell is asked, once, what it would have set. That answer is the base environment for
//! every terminal, and the search path for anything the backend itself looks up.

use std::collections::HashMap;
use std::process::Command;
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::Duration;

/// How long the login shell is given to answer.
///
/// Bounded because this runs before the FIRST terminal appears: a profile that blocks — waiting on a
/// network mount, a version manager fetching something — would otherwise mean a window that never
/// opens, and "the app is broken" is a much worse outcome than "the app has a short PATH".
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(5);

static LOGIN_ENV: OnceLock<HashMap<String, String>> = OnceLock::new();

/// The environment a login shell sets, as `(key, value)` pairs.
///
/// Captured on first use and cached for the process: running the user's profile is not free, and its
/// answer does not change while the app is open. An empty map means the capture failed — every caller
/// then simply falls back to the process environment, which is what they had before.
pub fn login_env() -> &'static HashMap<String, String> {
    LOGIN_ENV.get_or_init(capture)
}

/// The `PATH` a login shell would have, falling back to this process's own.
pub fn path() -> Option<String> {
    login_env()
        .get("PATH")
        .cloned()
        .or_else(|| std::env::var("PATH").ok())
}

fn capture() -> HashMap<String, String> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(capture_blocking());
    });
    match rx.recv_timeout(CAPTURE_TIMEOUT) {
        Ok(env) => env,
        Err(_) => {
            // The thread is left running: it is waiting on a child process we cannot safely kill from
            // here, and it will simply finish into a dropped channel. What matters is that the caller
            // stops waiting.
            tracing::warn!(
                seconds = CAPTURE_TIMEOUT.as_secs(),
                "the login shell did not answer in time — using this process's environment"
            );
            HashMap::new()
        }
    }
}

fn capture_blocking() -> HashMap<String, String> {
    let shell = super::pty::default_shell();
    // `-l` for the profile files where PATH is actually built; deliberately NOT `-i`, which would
    // also run the interactive configuration — prompt frameworks, completion systems, everything —
    // for an answer that does not depend on any of it.
    let output = match Command::new(&shell)
        .args(["-l", "-c", "/usr/bin/env -0"])
        .output()
    {
        Ok(out) if out.status.success() => out,
        Ok(out) => {
            tracing::warn!(
                shell = %shell,
                status = ?out.status,
                "could not read the login environment — using this process's own"
            );
            return HashMap::new();
        }
        Err(e) => {
            tracing::warn!(shell = %shell, error = %e, "could not run a login shell");
            return HashMap::new();
        }
    };

    // NUL-separated, because a value may contain newlines and splitting on those would silently
    // truncate someone's environment.
    let env: HashMap<String, String> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let text = String::from_utf8_lossy(entry);
            let (key, value) = text.split_once('=')?;
            Some((key.to_string(), value.to_string()))
        })
        .collect();

    tracing::info!(
        vars = env.len(),
        path = env.get("PATH").map_or("<none>", String::as_str),
        "login environment captured"
    );
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_login_shell_knows_more_than_this_process_might() {
        // Not asserting a particular PATH — that is the developer's machine. Asserting that the
        // capture works at all and produces the one variable everything else depends on.
        let env = login_env();
        assert!(!env.is_empty(), "a login shell sets something");
        assert!(env.contains_key("PATH"), "PATH is what this exists for");
    }

    #[test]
    fn path_always_answers() {
        // Even a failed capture must not leave callers without a search path; they had the process's
        // own before this module existed.
        assert!(path().is_some_and(|p| !p.is_empty()));
    }
}
