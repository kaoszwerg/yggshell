//! Finding a tmux session the **user** started, rather than one we did.
//!
//! **The gap this closes.** A session the app starts is known by name from the moment it opens —
//! `terminal_open` returns it. A session the user starts by typing `tmux` in the shell is invisible:
//! nothing tells the app it happened, and `tmux::ask` needs a session name it does not have. So the
//! status bar's tmux item showed nothing for somebody who was demonstrably sitting in tmux, and the
//! honest-looking explanation ("the session has no name") was wrong.
//!
//! **How it is found: by terminal device.** `tmux list-clients` reports the tty each client is
//! attached to. Our shell runs on exactly one tty, so a client on that tty is *this tab's* session —
//! no guessing, no matching by name, and correct when several tabs are attached to different
//! sessions at once.
//!
//! The alternative — walking the process tree from the shell's pid — needs a process listing per
//! poll and answers the same question less directly.

use std::path::Path;
use std::process::{Command, Stdio};

/// Which tmux session is attached to `tty`, if any.
///
/// `tty` is a device path as `ps` reports it (`/dev/ttys014`); tmux reports the same form, so the
/// comparison is exact rather than a suffix match — `ttys1` must not match `ttys14`.
pub fn session_on_tty(tty: &str) -> Option<String> {
    let tmux = crate::terminal::environment::which("tmux")?;
    let output = Command::new(tmux)
        .args(["list-clients", "-F", "#{client_tty} #{session_name}"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    // A tmux with no server running exits non-zero and says so on stderr. Not an error: it means
    // nobody is in tmux, which is the common case.
    if !output.status.success() {
        return None;
    }
    parse_clients(&String::from_utf8_lossy(&output.stdout), tty)
}

/// Pick the session on `tty` out of `tmux list-clients` output.
///
/// Split out from the command so the parsing can be tested without a tmux server — the shape of this
/// output is the contract, and it is what a future tmux could change.
pub fn parse_clients(listing: &str, tty: &str) -> Option<String> {
    listing.lines().find_map(|line| {
        let (client_tty, session) = line.trim_end().split_once(' ')?;
        // Exact match: a session name may itself contain spaces, so only the FIRST space separates
        // the two fields — and `split_once` is what guarantees that.
        (client_tty == tty && !session.is_empty()).then(|| session.to_string())
    })
}

/// The terminal device a process is running on, as `/dev/ttysNNN`.
///
/// Asked of `ps` rather than of an OS API: the portable way needs a different call per platform
/// (`proc_pidinfo` on macOS, `/proc/<pid>/stat` on Linux), and this runs **once per session** when it
/// opens — not on the status timer — so a process is the cheaper thing to spend.
pub fn tty_of(pid: u32) -> Option<String> {
    let output = Command::new("/bin/ps")
        .args(["-o", "tty=", "-p", &pid.to_string()])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // `??` is what `ps` prints for a process with no controlling terminal — a daemon, or a child
    // that has already gone. Not a device, and must not become `/dev/??`.
    if name.is_empty() || name == "??" {
        return None;
    }
    let path = if name.starts_with('/') {
        name
    } else {
        format!("/dev/{name}")
    };
    // Only a device that exists. A malformed answer must not become a string that then fails to
    // match anything, silently, forever.
    Path::new(&path).exists().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTING: &str = "/dev/ttys002 work\n/dev/ttys014 34\n/dev/ttys021 yggshell-3\n";

    #[test]
    fn it_finds_the_session_on_our_own_tty() {
        assert_eq!(
            parse_clients(LISTING, "/dev/ttys014"),
            Some("34".to_string())
        );
        assert_eq!(
            parse_clients(LISTING, "/dev/ttys021"),
            Some("yggshell-3".to_string())
        );
    }

    #[test]
    fn a_tty_with_no_client_has_no_session() {
        assert_eq!(parse_clients(LISTING, "/dev/ttys099"), None);
    }

    #[test]
    fn a_shorter_tty_name_does_not_match_a_longer_one() {
        // `ttys1` must not match `ttys14`. A suffix or prefix comparison would put one tab's session
        // on another tab's status bar, which is worse than showing nothing.
        assert_eq!(parse_clients("/dev/ttys14 work\n", "/dev/ttys1"), None);
        assert_eq!(parse_clients("/dev/ttys1 work\n", "/dev/ttys14"), None);
    }

    #[test]
    fn a_session_name_containing_a_space_survives() {
        // tmux allows it, and splitting on every space would truncate the name at the first one.
        assert_eq!(
            parse_clients("/dev/ttys002 my project\n", "/dev/ttys002"),
            Some("my project".to_string())
        );
    }

    #[test]
    fn nothing_at_all_is_not_an_error() {
        // No server running is the common case, not a failure.
        assert_eq!(parse_clients("", "/dev/ttys014"), None);
    }

    #[test]
    fn a_line_without_a_session_is_ignored() {
        assert_eq!(
            parse_clients("/dev/ttys014\n/dev/ttys014 \n", "/dev/ttys014"),
            None
        );
    }

    #[test]
    fn this_process_has_a_tty_or_honestly_says_it_has_none() {
        // Under a test runner there may be no controlling terminal at all — which is exactly the
        // case that must yield None rather than `/dev/??`.
        if let Some(path) = tty_of(std::process::id()) {
            assert!(path.starts_with("/dev/"), "got {path}");
        }
    }

    #[test]
    fn a_pid_that_does_not_exist_has_no_tty() {
        // A tab can close between the open and the query.
        assert_eq!(tty_of(u32::MAX), None);
    }
}
