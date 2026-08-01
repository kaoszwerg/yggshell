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
use std::path::{Path, PathBuf};
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

/// Find an executable on the login shell's `PATH`.
///
/// The login shell's, never this process's: a GUI app is started by launchd with a minimal `PATH`, so
/// `/opt/homebrew/bin/<anything>` is invisible to it and a perfectly installed program reads as
/// missing. Every backend lookup for a program the *user* installed goes through here.
pub fn which(program: &str) -> Option<PathBuf> {
    let path = self::path()?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|candidate| is_executable(candidate))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    // No permission bits to consult; existence is the available answer.
    path.is_file()
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
    // `-l -i`, and the `-i` is not optional — it was, and the assumption behind leaving it out was
    // simply wrong.
    //
    // The old comment said an interactive shell "would run prompt frameworks and completion systems
    // for an answer that does not depend on any of it". Measured on the maintainer's machine, the
    // answer depends on it completely: `~/.local/bin` is added in `.zshrc`, which only an
    // interactive shell reads. Without `-i` that directory does not exist as far as this app is
    // concerned — and `claude`, `ygg` and anything else installed there are invisible. The panel
    // said "not on your PATH" about a directory the user uses constantly, twice, and the usage bars
    // stayed empty because `claude` could not be found. Same root, three symptoms.
    //
    // The cost was measured too, since that was the objection: 110 ms, once, cached for the life of
    // the process, behind a five-second timeout. `.zshrc` files that print or prompt are the reason
    // the timeout exists, and it already did.
    let output = match Command::new(&shell)
        .args(["-l", "-i", "-c", "/usr/bin/env -0"])
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

    /// Nothing outside this module may read `PATH` from the process.
    ///
    /// **The failure is invisible in development and total in a bundle.** `tauri dev` inherits the
    /// shell's environment, so a caller using `std::env::var("PATH")` works perfectly on the machine
    /// that wrote it; installed, the same code gets launchd's `/usr/bin:/bin:/usr/sbin:/sbin` and
    /// concludes that Homebrew, mise and `~/.local/bin` do not exist. It has now cost two features —
    /// the tmux integration, and the launcher panel telling a user their PATH did not contain a
    /// directory that was first in it.
    ///
    /// A grep rather than a type, because the mistake is *reaching for the wrong function*, and no
    /// signature can express that. It is cheap and it cannot be forgotten.
    #[test]
    fn only_this_module_reads_the_process_path() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();

        fn walk(dir: &std::path::Path, offenders: &mut Vec<String>) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, offenders);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    // This module is the one place allowed to — it is the fallback inside `path()`.
                    if path.file_name().is_some_and(|n| n == "environment.rs") {
                        continue;
                    }
                    // Comments are skipped: the very sentence explaining why not to do this
                    // mentions the call, and a gate that flags its own documentation teaches the
                    // next person to delete the documentation.
                    let text = std::fs::read_to_string(&path).unwrap_or_default();
                    let offends = text
                        .lines()
                        .filter(|line| !line.trim_start().starts_with("//"))
                        .any(|line| line.contains("env::var(\"PATH\")"));
                    if offends {
                        offenders.push(path.display().to_string());
                    }
                }
            }
        }
        walk(&src, &mut offenders);

        assert!(
            offenders.is_empty(),
            "these read the process PATH instead of the login shell's \
             (use terminal::environment::path()): {offenders:?}"
        );
    }
    use super::*;

    #[test]
    fn the_captured_shell_is_interactive_and_must_stay_that_way() {
        // THREE separate defects came from this one flag being absent, and they looked unrelated:
        // "that directory is not on your PATH" about a directory in constant use, twice, and empty
        // usage bars because `claude` could not be found. All three were `~/.local/bin`, which is
        // added in `.zshrc` — a file only an INTERACTIVE shell reads.
        //
        // The argument for leaving `-i` out was that an interactive shell runs prompt frameworks
        // "for an answer that does not depend on any of it". Measured, the answer depends on it
        // entirely; the cost of including it is 110 ms, once, behind a timeout that already exists.
        //
        // A source scan rather than a behavioural test, because the failure is invisible at runtime:
        // everything keeps working, and a program installed in the wrong half of the user's
        // configuration simply stops existing.
        let source = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/terminal/environment.rs"),
        )
        .expect("this file");
        let captures = source
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .any(|line| line.contains("\"-l\", \"-i\", \"-c\""));

        assert!(
            captures,
            "the login environment must be captured from an INTERACTIVE login shell (-l -i): \
             without -i, anything the user added in .zshrc — very commonly ~/.local/bin — does not \
             exist as far as this app is concerned"
        );
    }

    #[test]
    fn nothing_looks_up_a_program_without_going_through_here() {
        // The other half of the same rule that cost three defects. `which()` searches the CAPTURED
        // environment; a bare `Command::new("docker")` searches the PROCESS PATH, which on macOS is
        // launchd's four entries — so it finds nothing the user installed, silently, and the feature
        // simply looks broken. An absolute path is fine: it is not a lookup.
        //
        // Programs the operating system itself ships are exempt. They live in a directory every
        // process has, they cannot be missing for the reason this test exists, and two of them run
        // inside the crash handler where spawning a login shell is the last thing to attempt. The
        // list is short and explicit on purpose: adding to it is a decision, and anything the USER
        // installed — `claude`, `docker`, `direnv`, `tmux` — will never belong on it.
        const ALLOWED: [&str; 6] = [
            "osascript",
            "explorer",
            "xdg-open",
            "zenity",
            "kdialog",
            // The deliberate edge: `/usr/bin/git` exists wherever git exists at all, and `git fetch`
            // does not care which build answers.
            "git",
        ];

        fn walk(dir: &std::path::Path, offenders: &mut Vec<String>) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, offenders);
                    continue;
                }
                if path.extension().is_none_or(|e| e != "rs") {
                    continue;
                }
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                for (at, line) in text.lines().enumerate() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("//") {
                        continue;
                    }
                    let Some(rest) = trimmed.split("Command::new(\"").nth(1) else {
                        continue;
                    };
                    let Some(program) = rest.split('"').next() else {
                        continue;
                    };
                    if program.starts_with('/') || program.is_empty() {
                        continue;
                    }
                    if ALLOWED.contains(&program) {
                        continue;
                    }
                    offenders.push(format!("{}:{} — {program}", path.display(), at + 1));
                }
            }
        }

        let mut offenders = Vec::new();
        walk(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut offenders,
        );

        assert!(
            offenders.is_empty(),
            "these look up a program on the PROCESS PATH, which a GUI app does not have — use \
             terminal::environment::which(), or an absolute path: {offenders:?}"
        );
    }

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
