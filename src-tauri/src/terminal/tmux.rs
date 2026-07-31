//! Starting a session inside tmux instead of a bare shell.
//!
//! Three questions, and they are genuinely separate: should a terminal join tmux at all, may it
//! *create* a session when none is there, and is there one particular session it belongs to. Folding
//! them into a single toggle would have made "attach if something is running, otherwise just give me
//! a shell" impossible to express — which is the setting most people actually want.
//!
//! **It never costs the terminal.** No tmux on PATH, an unusable session name, nothing to attach to:
//! each of those is logged and falls back to the plain shell. A terminal that refuses to open because
//! a multiplexer was unavailable would be a far worse trade than one that opens without it.

use crate::dto::TmuxMode;
use crate::terminal::pty::SessionKind;
use std::path::PathBuf;
use std::process::Command;

/// What to actually spawn on the PTY.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
    /// How this session must be ENDED. Carried here rather than inferred from the program name by
    /// the caller: getting it wrong means killing a tmux session instead of detaching from it, and a
    /// string comparison is not something that failure should hang on.
    pub kind: SessionKind,
    /// The tmux session this joined, when it joined one. Kept so the working directory can be read
    /// back from tmux later.
    pub tmux_session: Option<String>,
}

impl Launch {
    fn shell(program: &str) -> Self {
        Self {
            program: program.to_string(),
            args: Vec::new(),
            kind: SessionKind::Shell,
            tmux_session: None,
        }
    }

    fn tmux(program: String, args: Vec<String>, session: String) -> Self {
        Self {
            program,
            args,
            kind: SessionKind::TmuxClient,
            tmux_session: Some(session),
        }
    }
}

/// Decide what a new terminal runs.
///
/// `shell` is the program that would have been started without tmux, and it is what every failure
/// path returns.
pub fn launch(mode: TmuxMode, session: &str, shell: &str) -> Launch {
    if mode == TmuxMode::Off {
        return Launch::shell(shell);
    }

    let session = session.trim();
    if !session.is_empty() && !is_valid_session_name(session) {
        tracing::warn!(
            session,
            "tmux session name is not usable — starting a plain shell"
        );
        return Launch::shell(shell);
    }

    let Some(tmux) = find_tmux() else {
        tracing::warn!("tmux is not on PATH — starting a plain shell");
        return Launch::shell(shell);
    };
    let tmux = tmux.to_string_lossy().into_owned();

    match mode {
        TmuxMode::Off => Launch::shell(shell),

        // Join something that is already running, or get out of the way. Checked with `has-session`
        // first: letting `attach-session` fail would leave the user looking at a terminal that has
        // already exited, which is a worse answer than the shell they would otherwise have had.
        TmuxMode::Attach => {
            if !has_session(&tmux, session) {
                tracing::info!(
                    session = if session.is_empty() { "<any>" } else { session },
                    "no tmux session to attach — starting a plain shell"
                );
                return Launch::shell(shell);
            }
            // Attaching joins shells that were started before this app existed, so no hook can be
            // installed in them. Their working directory is read from tmux instead — see [`pane_cwd`].
            let mut args = vec!["attach-session".to_string()];
            if !session.is_empty() {
                args.push("-t".to_string());
                args.push(session.to_string());
            }
            tracing::info!(session, "attaching to tmux");
            Launch::tmux(tmux, args, session.to_string())
        }

        // `new-session -A` is attach-or-create in one call, which is why the session gets a name even
        // when the user did not give one: without `-s` there is nothing for `-A` to match, and every
        // terminal would start its own detached session instead of joining the last.
        TmuxMode::AttachOrCreate => {
            let name = if session.is_empty() {
                DEFAULT_SESSION
            } else {
                session
            };
            tracing::info!(session = name, "attaching to or creating a tmux session");
            Launch::tmux(
                tmux,
                vec![
                    "new-session".to_string(),
                    "-A".to_string(),
                    "-s".to_string(),
                    name.to_string(),
                ],
                name.to_string(),
            )
        }
    }
}

/// Used when the user asked for attach-or-create without naming a session. Named rather than
/// anonymous so every terminal joins the same one.
const DEFAULT_SESSION: &str = "yggshell";

/// tmux treats `:` and `.` as target separators (`session:window.pane`), so a name containing them
/// addresses something other than itself. Control characters would be worse still.
fn is_valid_session_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.contains(':')
        && !name.contains('.')
        && !name.chars().any(char::is_control)
}

/// Whether there is anything to attach to. An empty `session` asks about the server as a whole.
fn has_session(tmux: &str, session: &str) -> bool {
    let mut cmd = Command::new(tmux);
    if session.is_empty() {
        // `has-session` with no target answers for the server, which is exactly "is anything running".
        cmd.arg("has-session");
    } else {
        cmd.args(["has-session", "-t", session]);
    }
    match cmd.output() {
        Ok(out) => out.status.success(),
        Err(e) => {
            tracing::warn!(error = %e, "could not ask tmux whether a session exists");
            false
        }
    }
}

/// Where the active pane of `session` currently is, asked of tmux itself.
///
/// The shell hook cannot answer this for a session that already existed: those shells were started
/// before this app ran, so nothing was injected into them. tmux, on the other hand, tracks
/// `pane_current_path` for every pane — it is what it consumes OSC 7 *for*. Asking it works for a
/// session we created and one we merely joined, which is why this is the primary source inside tmux
/// and the hook is the fast path outside it.
pub fn pane_cwd(session: &str) -> Option<String> {
    let tmux = find_tmux()?;
    let out = Command::new(tmux)
        .args([
            "display-message",
            "-p",
            "-t",
            session,
            "#{pane_current_path}",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Look `tmux` up on PATH ourselves rather than relying on the spawn to fail.
///
/// The spawn happens on a PTY, so its failure would be a message inside a terminal that then exits —
/// which the user reads as "the terminal is broken". Knowing beforehand lets the plain shell start.
fn find_tmux() -> Option<PathBuf> {
    super::environment::which("tmux")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_starts_the_plain_shell() {
        let launch = launch(TmuxMode::Off, "work", "/bin/zsh");
        assert_eq!(launch, Launch::shell("/bin/zsh"));
    }

    #[test]
    fn a_name_that_addresses_something_else_is_refused() {
        // tmux reads `session:window.pane`, so these do not name what the user typed — they name a
        // window or a pane inside some other session.
        assert!(!is_valid_session_name("work:1"));
        assert!(!is_valid_session_name("work.0"));
        assert!(!is_valid_session_name(""));
        assert!(!is_valid_session_name("bad\nname"));
        assert!(!is_valid_session_name(&"x".repeat(65)));
    }

    #[test]
    fn an_ordinary_name_is_accepted() {
        assert!(is_valid_session_name("work"));
        assert!(is_valid_session_name("yggshell"));
        assert!(is_valid_session_name("feature-42_b"));
    }

    #[test]
    fn an_unusable_name_costs_tmux_not_the_terminal() {
        // The session name comes from settings, so it can be anything the user typed. Refusing to
        // open a terminal over it would be the wrong trade.
        let launch = launch(TmuxMode::AttachOrCreate, "work:1", "/bin/zsh");
        assert_eq!(launch, Launch::shell("/bin/zsh"));
    }

    #[test]
    fn attach_or_create_without_a_name_uses_one_anyway() {
        // Skipped where tmux is absent: the point of this test is the arguments, and without the
        // binary the function correctly returns the shell instead.
        let Some(_) = find_tmux() else { return };
        let launch = launch(TmuxMode::AttachOrCreate, "  ", "/bin/zsh");
        assert_eq!(
            launch.args,
            vec!["new-session", "-A", "-s", DEFAULT_SESSION],
            "without -s there is nothing for -A to match, so every terminal would start its own"
        );
    }

    #[test]
    fn attach_or_create_uses_the_name_it_was_given() {
        let Some(_) = find_tmux() else { return };
        let launch = launch(TmuxMode::AttachOrCreate, "work", "/bin/zsh");
        assert_eq!(launch.args, vec!["new-session", "-A", "-s", "work"]);
    }

    #[test]
    fn a_tmux_launch_remembers_which_session_it_joined() {
        // Inside tmux the working directory is read back from tmux, so the session name has to
        // survive the launch — a hook cannot answer for a shell that was already running.
        let Some(_) = find_tmux() else { return };
        assert_eq!(
            launch(TmuxMode::AttachOrCreate, "work", "/bin/zsh").tmux_session,
            Some("work".to_string())
        );
        assert_eq!(launch(TmuxMode::Off, "work", "/bin/zsh").tmux_session, None);
    }

    #[test]
    fn a_tmux_session_is_marked_to_be_detached_never_killed() {
        // This is the flag that decides whether closing a tab detaches or destroys. A multiplexer
        // whose work dies with the window looking at it is worse than no multiplexer at all.
        let Some(_) = find_tmux() else { return };
        assert_eq!(
            launch(TmuxMode::AttachOrCreate, "work", "/bin/zsh").kind,
            SessionKind::TmuxClient
        );
    }

    #[test]
    fn every_fallback_is_marked_as_a_shell() {
        // A fallback really is a plain shell, so it must be ended like one — with its process group.
        assert_eq!(
            launch(TmuxMode::Off, "", "/bin/zsh").kind,
            SessionKind::Shell
        );
        assert_eq!(
            launch(TmuxMode::AttachOrCreate, "bad:name", "/bin/zsh").kind,
            SessionKind::Shell
        );
    }
}
