//! Putting `ygg` and `yggshell` on the user's `PATH`.
//!
//! **Why the app installs it rather than an installer doing it.** A DMG drag-install cannot run
//! anything, and a `.pkg` that writes to `/usr/local/bin` needs an admin prompt at install time —
//! for a convenience most people do not use. So it is a button, the way editors do it: nothing is
//! written to the machine until somebody asks.
//!
//! **Why a copy and not a symlink into the bundle.** A symlink into `/Applications/YggShell.app`
//! breaks the moment the app is rebuilt or replaced, and `ygg` then fails with a message about a
//! missing file inside a bundle — which tells the user nothing. The script is nine lines and calls
//! `open -a` by name, so a copy keeps working across every update.

use crate::error::{AppError, Result};
use std::path::{Path, PathBuf};

/// What the script is called. Both names, because both were asked for and neither is the "real" one.
pub const NAMES: [&str; 2] = ["ygg", "yggshell"];

/// Where the launcher ended up, and whether it will actually be found.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct CliInstall {
    /// The directory the scripts were written to.
    pub directory: String,
    /// The names now available, in that directory.
    pub names: Vec<String>,
    /// Whether that directory is on `PATH`. When false, the caller must say so — a launcher that is
    /// installed and not found is worse than one that was never installed.
    pub on_path: bool,
}

/// Candidate directories, best first — the real ones, for the running app.
///
/// `/usr/local/bin` leads because it is on every macOS `PATH` without the user doing anything. It is
/// only used if it is **already writable** — creating it, or asking for an admin password, is not
/// something a terminal emulator should do on a button press. `~/.local/bin` is the fallback: it can
/// always be created, and it is on `PATH` for anyone who has ever installed a Python tool.
///
/// **The list is a parameter of `install`, not a constant inside it.** A test that called `install`
/// directly would otherwise write into `/usr/local/bin` on any machine where that happens to be
/// writable — which is most developer Macs. A test suite that can install software is a defect
/// (rule:testing).
pub fn default_candidates(home: &Path) -> Vec<PathBuf> {
    vec![PathBuf::from("/usr/local/bin"), home.join(".local/bin")]
}

/// Whether `dir` appears in a `PATH`-style list.
///
/// Compared as strings after trimming a trailing separator, not canonicalised: `PATH` is what the
/// shell will actually search, and a symlinked entry that resolves to the same place is still a
/// different string to the shell.
pub fn is_on_path(dir: &Path, path_var: &str) -> bool {
    let needle = dir.to_string_lossy();
    let needle = needle.trim_end_matches('/');
    path_var
        .split(':')
        .any(|entry| entry.trim_end_matches('/') == needle)
}

/// Pick the directory to install into: the first candidate that exists and is writable, else the
/// user-local one, which is created.
fn choose(candidates: &[PathBuf]) -> Result<PathBuf> {
    for candidate in candidates {
        if candidate.is_dir() && is_writable(candidate) {
            return Ok(candidate.clone());
        }
    }
    // The last candidate is the one we are allowed to create: it is the user's own directory, and
    // creating a system one is not something a button press should do.
    let last = candidates
        .last()
        .ok_or_else(|| AppError::Other("no directory to install the launcher into".into()))?;
    std::fs::create_dir_all(last).map_err(|e| AppError::io(last.to_string_lossy(), e))?;
    Ok(last.clone())
}

/// Whether a directory can be written to, asked by trying rather than by reading permission bits.
///
/// Bits lie: they say nothing about ACLs, a read-only mount or SIP. Creating and removing a file is
/// the only answer that is true at the moment it matters.
fn is_writable(dir: &Path) -> bool {
    let probe = dir.join(".yggshell-write-probe");
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Write the launcher under every name, and report where it went.
///
/// Overwrites an existing copy deliberately: this is also how the script is *updated*, and refusing
/// would leave the user with an old one and no way to say so.
pub fn install(script: &str, candidates: &[PathBuf], path_var: &str) -> Result<CliInstall> {
    let directory = choose(candidates)?;

    for name in NAMES {
        let target = directory.join(name);
        std::fs::write(&target, script).map_err(|e| AppError::io(target.to_string_lossy(), e))?;
        make_executable(&target)?;
    }

    let install = CliInstall {
        directory: directory.to_string_lossy().to_string(),
        names: NAMES.iter().map(|n| (*n).to_string()).collect(),
        on_path: is_on_path(&directory, path_var),
    };
    tracing::info!(
        directory = %install.directory,
        on_path = install.on_path,
        "installed the command-line launcher"
    );
    Ok(install)
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    // 0o755: the user can rewrite it on the next install, everyone can run it. A script nobody can
    // execute is the one failure mode this whole function exists to avoid.
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| AppError::io(path.to_string_lossy(), e))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<()> {
    // Windows has no execute bit; a `.cmd` shim is a separate piece of work with its own launcher.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCRIPT: &str = "#!/bin/sh\necho hi\n";

    /// Candidates that live entirely inside a temp directory.
    ///
    /// Never `default_candidates`: that starts at `/usr/local/bin`, which is writable on most
    /// developer Macs — so the suite would install software on the machine running it.
    fn only(home: &Path) -> Vec<PathBuf> {
        vec![home.join(".local/bin")]
    }

    #[test]
    fn it_installs_under_both_names() {
        // Both were asked for, and a user who types the one that is missing gets "command not found"
        // with no clue that the other exists.
        let home = tempfile::tempdir().expect("tempdir");
        let result = install(SCRIPT, &only(home.path()), "/usr/bin").expect("install");

        for name in NAMES {
            let path = PathBuf::from(&result.directory).join(name);
            assert!(path.is_file(), "{name} was not written");
            assert_eq!(std::fs::read_to_string(&path).expect("read"), SCRIPT);
        }
    }

    #[test]
    fn the_launcher_is_executable() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().expect("tempdir");
        let result = install(SCRIPT, &only(home.path()), "").expect("install");

        let mode = std::fs::metadata(PathBuf::from(&result.directory).join("ygg"))
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o111, 0o111, "nobody can execute it");
    }

    #[test]
    fn it_creates_the_user_local_directory_when_it_has_to() {
        let home = tempfile::tempdir().expect("tempdir");
        let result = install(SCRIPT, &only(home.path()), "").expect("install");

        assert!(result.directory.ends_with(".local/bin"));
        assert!(home.path().join(".local/bin").is_dir());
    }

    #[test]
    fn it_says_when_the_directory_is_not_on_path() {
        // Installed and not found is worse than not installed: the user runs `ygg`, gets nothing,
        // and has no reason to suspect where the problem is.
        let home = tempfile::tempdir().expect("tempdir");
        let result = install(SCRIPT, &only(home.path()), "/usr/bin:/bin").expect("install");
        assert!(!result.on_path);

        let with = format!("/usr/bin:{}", result.directory);
        let result = install(SCRIPT, &only(home.path()), &with).expect("install");
        assert!(result.on_path);
    }

    #[test]
    fn a_trailing_slash_does_not_hide_a_directory_that_is_on_path() {
        assert!(is_on_path(Path::new("/opt/bin"), "/usr/bin:/opt/bin/"));
        assert!(is_on_path(Path::new("/opt/bin/"), "/usr/bin:/opt/bin"));
    }

    #[test]
    fn the_real_candidates_prefer_a_directory_that_is_already_on_path() {
        // Pinned because the ORDER is the decision: /usr/local/bin needs nothing of the user, and
        // ~/.local/bin often needs a PATH edit. Getting this backwards would make the common case
        // the one that does not work.
        let home = Path::new("/home/someone");
        let list = default_candidates(home);
        assert_eq!(list[0], PathBuf::from("/usr/local/bin"));
        assert_eq!(list[1], home.join(".local/bin"));
    }

    #[test]
    fn a_directory_whose_name_merely_starts_the_same_is_not_a_match() {
        // `/opt/bin` must not be satisfied by `/opt/binaries`.
        assert!(!is_on_path(Path::new("/opt/bin"), "/opt/binaries"));
    }

    #[test]
    fn installing_again_replaces_what_is_there() {
        // This is also how the script is UPDATED. Refusing would leave an old copy with no way to
        // say so.
        let home = tempfile::tempdir().expect("tempdir");
        install("old", &only(home.path()), "").expect("first install");
        let result = install("new", &only(home.path()), "").expect("second install");

        let path = PathBuf::from(&result.directory).join("ygg");
        assert_eq!(std::fs::read_to_string(path).expect("read"), "new");
    }

    #[test]
    fn writability_is_decided_by_trying_rather_than_by_reading_bits() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(is_writable(dir.path()));
        assert!(
            !is_writable(&dir.path().join("does-not-exist")),
            "a directory that is not there cannot be written to"
        );
        // The probe must leave nothing behind.
        assert_eq!(
            std::fs::read_dir(dir.path()).expect("read_dir").count(),
            0,
            "the write probe left a file behind"
        );
    }
}
