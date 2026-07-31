//! Which shells this machine offers, and which one a session should start.
//!
//! **This is a security boundary, not a convenience** (ADR-PROJ-001 §5, rule:security). `terminal_open`
//! deliberately takes no command line, so the webview cannot name the program a terminal runs. A
//! free-text "path to your shell" setting would hand that back: the same webview could store any
//! executable and have the backend spawn it on the next tab.
//!
//! So the choice is a *selection from a list the backend produced*, and it is checked again at spawn
//! time. What is on that list is what the operating system itself declares a login shell — `/etc/shells`
//! on Unix, the known interpreter locations on Windows — plus the user's own `$SHELL`, which is on the
//! list by definition of being their shell. A preference that is not on it is refused when it is
//! stored and ignored if it ever reaches a spawn anyway.

use std::path::Path;

/// A shell the user may pick, as offered to the frontend.
pub struct Offer {
    /// Absolute path to the interpreter.
    pub path: String,
    /// What to call it in the UI — the file name, which is how people say it (`zsh`, `fish`).
    pub name: String,
    /// True for the shell the user's account is configured with (`$SHELL`).
    pub is_default: bool,
}

/// Every shell this machine offers, the user's own first.
///
/// Never empty: the fallback the platform guarantees is always in it, so a machine with no
/// `/etc/shells` still presents a choice rather than an empty list the UI has to apologise for.
pub fn available() -> Vec<Offer> {
    let default = super::pty::default_shell();
    let paths = dedupe(std::iter::once(default.clone()).chain(system_shells()));
    paths
        .into_iter()
        .map(|path| Offer {
            name: label_for(&path),
            is_default: path == default,
            path,
        })
        .collect()
}

/// The shell a session must actually start.
///
/// `preference` is what the user chose. It is honoured only when this machine still offers it —
/// a shell can be uninstalled between being chosen and being spawned, and a settings file is an
/// ordinary file a user may edit. Anything else falls back to `$SHELL`, loudly.
pub fn resolve(preference: &str) -> String {
    let default = super::pty::default_shell();
    let preference = preference.trim();
    if preference.is_empty() {
        return default;
    }
    if available().iter().any(|offer| offer.path == preference) {
        return preference.to_string();
    }
    tracing::warn!(
        %preference,
        %default,
        "configured shell is not one this machine offers — falling back to the default shell"
    );
    default
}

/// Whether a preference may be stored at all. The check that keeps a webview from naming a program.
pub fn is_offered(preference: &str) -> bool {
    let preference = preference.trim();
    preference.is_empty() || available().iter().any(|offer| offer.path == preference)
}

/// What to call a shell in the UI: its file name, falling back to the whole path when there is none.
fn label_for(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_string())
}

/// Keep the first occurrence of each path, in order. `/etc/shells` routinely lists the same
/// interpreter twice, and `$SHELL` is usually in it as well.
fn dedupe(paths: impl Iterator<Item = String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    paths
        .filter(|path| !path.trim().is_empty())
        .filter(|path| seen.insert(path.clone()))
        .filter(|path| Path::new(path).is_file())
        .collect()
}

/// The shells the operating system itself declares.
#[cfg(not(windows))]
fn system_shells() -> Vec<String> {
    match std::fs::read_to_string("/etc/shells") {
        Ok(text) => parse_etc_shells(&text),
        Err(error) => {
            // Not a failure: a container or a minimal system may simply not have the file. The
            // user's own shell is still offered, which is the case that matters.
            tracing::debug!(%error, "no /etc/shells — offering only the default shell");
            Vec::new()
        }
    }
}

/// Windows has no `/etc/shells`, so the equivalent is the interpreters it ships at known locations
/// plus whatever `COMSPEC` names. Anything not installed simply does not appear
/// (rule:cross-platform: gated per OS, absence handled).
#[cfg(windows)]
fn system_shells() -> Vec<String> {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
    let mut candidates = vec![
        format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe"),
        format!(r"{root}\System32\cmd.exe"),
    ];
    if let Ok(comspec) = std::env::var("COMSPEC") {
        candidates.push(comspec);
    }
    // PowerShell 7 installs outside System32 and is not guaranteed anywhere, so it is looked up the
    // way the user would find it: on PATH.
    if let Some(pwsh) = crate::terminal::environment::which("pwsh.exe") {
        candidates.push(pwsh);
    }
    candidates
}

/// Parse `/etc/shells`: one absolute path per line, `#` starts a comment.
///
/// Kept separate from the read so it can be tested without a machine that happens to have the right
/// shells installed.
#[cfg(not(windows))]
fn parse_etc_shells(text: &str) -> Vec<String> {
    text.lines()
        .map(|line| line.split('#').next().unwrap_or("").trim())
        .filter(|line| line.starts_with('/'))
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_label_is_the_file_name() {
        assert_eq!(label_for("/opt/homebrew/bin/fish"), "fish");
        assert_eq!(label_for("/bin/zsh"), "zsh");
    }

    #[test]
    fn a_label_falls_back_to_the_whole_path() {
        assert_eq!(label_for("weird"), "weird");
    }

    #[cfg(not(windows))]
    #[test]
    fn etc_shells_drops_comments_blank_lines_and_relative_paths() {
        let parsed = parse_etc_shells(
            "# List of acceptable shells\n\
             /bin/bash\n\
             \n\
             /bin/zsh  # the default on macOS\n\
             not-a-path\n\
             #/bin/commented-out\n\
             /usr/local/bin/fish\n",
        );
        assert_eq!(parsed, ["/bin/bash", "/bin/zsh", "/usr/local/bin/fish"]);
    }

    #[test]
    fn dedupe_keeps_the_first_occurrence_and_drops_what_is_not_there() {
        // The interpreter every Unix guarantees, listed twice, next to something that cannot exist.
        let real = super::super::pty::default_shell();
        let kept = dedupe(
            [
                real.clone(),
                real.clone(),
                "/definitely/not/a/shell".to_string(),
                "   ".to_string(),
            ]
            .into_iter(),
        );
        assert_eq!(kept, [real]);
    }

    #[test]
    fn the_users_own_shell_is_always_offered_and_marked() {
        let offers = available();
        assert!(!offers.is_empty(), "a machine always offers some shell");
        let default = super::super::pty::default_shell();
        let first = offers.first().expect("non-empty");
        assert_eq!(first.path, default);
        assert!(first.is_default);
        assert_eq!(offers.iter().filter(|o| o.is_default).count(), 1);
    }

    #[test]
    fn an_empty_preference_means_the_default_shell() {
        assert_eq!(resolve(""), super::super::pty::default_shell());
        assert_eq!(resolve("   "), super::super::pty::default_shell());
        assert!(is_offered(""));
    }

    #[test]
    fn a_preference_the_machine_offers_is_honoured() {
        let offered = available();
        let last = offered.last().expect("non-empty");
        assert_eq!(resolve(&last.path), last.path);
        assert!(is_offered(&last.path));
    }

    #[test]
    fn a_preference_the_machine_does_not_offer_is_refused_and_ignored() {
        // The whole point: a webview that stored `/usr/bin/curl` must not get it spawned.
        assert!(!is_offered("/usr/bin/curl"));
        assert!(!is_offered("/definitely/not/a/shell"));
        assert_eq!(
            resolve("/definitely/not/a/shell"),
            super::super::pty::default_shell()
        );
    }
}
