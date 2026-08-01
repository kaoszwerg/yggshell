//! Managing direnv on the user's behalf: is it there, may this file run, and installing it.
//!
//! ## Approving a file is spending a safety, so it is bounded
//!
//! `direnv allow` records that a human has read an `.envrc` and accepts that it will be executed on
//! entering the directory. It exists precisely because an `.envrc` is arbitrary code. An application
//! that approves on the user's behalf has spent that safety for them.
//!
//! It is defensible here, and only under these conditions, all of which the caller must satisfy:
//!
//!  - **YggShell wrote the file itself**, in this same action, at the user's request;
//!  - the content is **one `export` line** plus whatever was already there;
//!  - the user is **shown the path** that was approved.
//!
//! Approving a file the app did not just write is not on the table, and there is no command here
//! that would let it.
//!
//! ## Installing is asking a package manager, never fetching a binary
//!
//! No download, no script piped anywhere: the platform's own package manager is asked to install a
//! package by name, and that name is a constant in this file. If no manager is present the answer is
//! "install it yourself, here is the name" — which is a better outcome than an app that acquires
//! executables by its own means.

use crate::error::{AppError, Result};
use std::path::Path;
use std::process::{Command, Stdio};

/// Whether direnv is installed at all.
pub fn is_installed() -> bool {
    crate::terminal::environment::which("direnv").is_some()
}

/// Whether direnv would load this project's `.envrc` as it stands.
///
/// Asked of direnv rather than derived from its data directory: the approval is a hash of the file's
/// content, and reimplementing that hash here would be a second source of truth that goes wrong
/// silently the day direnv changes it.
pub fn is_allowed(project: &Path) -> bool {
    let Some(direnv) = crate::terminal::environment::which("direnv") else {
        return false;
    };
    // `status` reports on the .envrc for a directory. Non-zero, or "not allowed" in the output,
    // both mean the file would not load.
    let Ok(output) = Command::new(direnv)
        .args(["status"])
        .current_dir(project)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return false;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    parse_status(&text)
}

/// Read direnv's own `status` output.
///
/// The line that matters is `Found RC allowed <state>`: `true`/`0` mean loaded, anything else does
/// not. Split out so the shape of that output — the contract — is testable without direnv.
pub fn parse_status(text: &str) -> bool {
    text.lines()
        .map(str::trim)
        .filter_map(|line| line.strip_prefix("Found RC allowed "))
        .any(|state| state == "true" || state == "0")
}

/// Approve an `.envrc` this app has just written.
///
/// See the module comment for why this is bounded rather than offered freely. The path is logged,
/// because "which file did it approve" must be answerable afterwards (rule:logging).
pub fn allow(project: &Path) -> Result<()> {
    let Some(direnv) = crate::terminal::environment::which("direnv") else {
        return Err(AppError::Other("direnv is not installed".to_string()));
    };
    let status = Command::new(direnv)
        .args(["allow"])
        .current_dir(project)
        .stdin(Stdio::null())
        .status()
        .map_err(|e| AppError::io(project.display().to_string(), e))?;
    if !status.success() {
        return Err(AppError::Other(format!(
            "direnv allow failed in {} (exit {:?})",
            project.display(),
            status.code()
        )));
    }
    tracing::info!(project = %project.display(), "approved an .envrc this app wrote");
    Ok(())
}

/// The package managers this app will ask, in order of preference per platform.
///
/// A fixed list of `(binary, arguments)`: the *whole* command is here, and nothing about it comes
/// from the webview (ADR-PROJ-001 §5). Adding a manager is a change to this constant, reviewed like
/// any other.
#[cfg(target_os = "macos")]
const MANAGERS: &[(&str, &[&str])] = &[("brew", &["install", "direnv"])];
#[cfg(target_os = "windows")]
const MANAGERS: &[(&str, &[&str])] = &[
    ("winget", &["install", "--id", "direnv.direnv", "-e"]),
    ("scoop", &["install", "direnv"]),
];
#[cfg(all(unix, not(target_os = "macos")))]
const MANAGERS: &[(&str, &[&str])] = &[
    ("apt-get", &["install", "-y", "direnv"]),
    ("dnf", &["install", "-y", "direnv"]),
    ("pacman", &["-S", "--noconfirm", "direnv"]),
    ("nix-env", &["-iA", "nixpkgs.direnv"]),
];

/// Install direnv through whichever package manager this machine has.
///
/// Returns the manager that did it. An error naming the packages to install by hand is the honest
/// outcome where there is none — better than an app that goes and fetches a binary itself.
pub fn install() -> Result<String> {
    for (manager, args) in MANAGERS {
        let Some(path) = crate::terminal::environment::which(manager) else {
            continue;
        };
        tracing::info!(manager, "installing direnv");
        let status = Command::new(path)
            .args(*args)
            .stdin(Stdio::null())
            .status()
            .map_err(|e| AppError::io((*manager).to_string(), e))?;
        if status.success() {
            tracing::info!(manager, "direnv installed");
            return Ok((*manager).to_string());
        }
        // A manager that needs a password, or a lock held elsewhere. Say which one failed rather
        // than silently trying the next and reporting on that instead.
        return Err(AppError::Other(format!(
            "{manager} could not install direnv (exit {:?}) — try it in the terminal to see why",
            status.code()
        )));
    }
    Err(AppError::Other(
        "no package manager was found — install direnv yourself and try again".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direnv_status_is_read_from_its_own_words() {
        // The contract with `direnv status`. Its own output is the only honest source: the approval
        // is a hash of the file, and computing that hash here would go wrong silently the day
        // direnv changes it.
        assert!(parse_status(
            "direnv exec path /usr/bin\nFound RC path /p/.envrc\nFound RC allowed true\n"
        ));
        assert!(parse_status("Found RC allowed 0\n"));
        assert!(!parse_status("Found RC allowed false\n"));
        assert!(!parse_status("Found RC allowed 2\n"));
    }

    #[test]
    fn no_rc_at_all_is_not_allowed() {
        // A directory with no `.envrc` must not read as approved — nothing is loaded there.
        assert!(!parse_status(
            "direnv exec path /usr/bin\nNo .envrc or .env loaded\n"
        ));
        assert!(!parse_status(""));
    }

    #[test]
    fn every_install_command_is_a_constant_in_this_file() {
        // The rule this protects: no part of a command line comes from the webview
        // (ADR-PROJ-001 §5). If this list ever takes a parameter, that is the moment to stop.
        for (manager, args) in MANAGERS {
            assert!(!manager.is_empty());
            assert!(args.iter().any(|a| a.contains("direnv")));
        }
    }
}
