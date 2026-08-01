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
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;

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
/// `taken` is the set of tmux sessions this app's other tabs are already attached to. It is the whole
/// reason this function needs a fourth argument: two tabs sharing one tmux session share one *view*
/// of it — same window, same scrollback, same everything — so opening a second tab appeared to do
/// nothing at all. A tab is a terminal; it gets a session of its own.
///
/// `remembered` is the session a **restored** tab was in before the app last stopped, which is the
/// only reason any of this survives a crash in a way the user can reach. tmux outlives the app by
/// design, but a tab that comes back merely *numbered* lands wherever its position puts it: close one
/// tab before the crash and the positional name now belongs to a different session, while the one
/// holding the build runs on with nothing in the interface pointing at it.
///
/// **It may only name a session in the configured series** (`base`, `base-2`, …) — see
/// [`in_series`]. That is what keeps ADR-PROJ-001 §5 intact: the webview restores a name this
/// backend itself minted and handed it, it does not *choose* one. Anything else falls back to the
/// positional name, silently and safely.
pub fn launch(
    mode: TmuxMode,
    session: &str,
    shell: &str,
    taken: &[String],
    remembered: Option<&str>,
) -> Launch {
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
            if !session.is_empty() && taken.iter().any(|t| t == session) {
                // Another tab is already showing this session, and a second client would show the
                // same window — not a second terminal. "Attach to X" names one X; when it is taken,
                // a plain shell is the honest answer rather than a duplicate view.
                tracing::info!(
                    session,
                    "that tmux session is already open in another tab — starting a plain shell"
                );
                return Launch::shell(shell);
            }
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

        // `new-session -A` is attach-or-create in one call. The FIRST tab gets the configured name,
        // so a session the user already has is the one they land in; every tab after that gets its
        // own suffixed session, because sharing one would mean sharing one view of it.
        TmuxMode::AttachOrCreate => {
            let base = if session.is_empty() {
                DEFAULT_SESSION
            } else {
                session
            };
            // The remembered name first, when it is one this backend could have minted and no other
            // tab is showing it. Otherwise the positional name, exactly as before.
            let name = remembered
                .map(str::trim)
                .filter(|name| in_series(base, name))
                .filter(|name| !taken.iter().any(|t| t == name))
                .map(str::to_string)
                .unwrap_or_else(|| first_free(base, taken));
            tracing::info!(session = %name, "attaching to or creating a tmux session");
            Launch::tmux(
                tmux,
                vec![
                    "new-session".to_string(),
                    "-A".to_string(),
                    "-s".to_string(),
                    name.clone(),
                ],
                name,
            )
        }
    }
}

/// Used when the user asked for attach-or-create without naming a session.
const DEFAULT_SESSION: &str = "yggshell";

/// How many suffixed sessions we will look through before giving up on finding a free name.
///
/// A bound rather than a loop: `taken` comes from the number of open tabs, so it cannot realistically
/// be long — but an unbounded search over a list someone else controls is a habit worth not having.
const MAX_SESSIONS: usize = 64;

/// Whether `name` is one this app could have handed out for `base` — `base` itself, or `base-N`.
///
/// **The check that lets a tab restore a session without being able to pick one.** A remembered name
/// arrives from the webview, and a name is not a program, so it does not widen *what runs*
/// (ADR-PROJ-001 §5) — but an unchecked one would widen *what can be joined* to every tmux session on
/// the machine, including the ones the user is running for something else. Constraining it to the
/// series the settings define means the webview can only ask for what it was already given.
fn in_series(base: &str, name: &str) -> bool {
    if !is_valid_session_name(name) {
        return false;
    }
    if name == base {
        return true;
    }
    name.strip_prefix(base)
        .and_then(|rest| rest.strip_prefix('-'))
        .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

/// The first session name in the `base`, `base-2`, `base-3`, … series that no other tab holds.
///
/// Falls back to the base when every candidate is taken; at that point sixty-four terminals are open
/// and a shared view is a smaller problem than refusing to open one.
fn first_free(base: &str, taken: &[String]) -> String {
    if !taken.iter().any(|t| t == base) {
        return base.to_string();
    }
    for n in 2..=MAX_SESSIONS {
        let candidate = format!("{base}-{n}");
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    tracing::warn!(base, "every tmux session name in the series is taken");
    base.to_string()
}

/// tmux treats `:` and `.` as target separators (`session:window.pane`), so a name containing them
/// addresses something other than itself. Control characters would be worse still.
fn is_valid_session_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.contains(':')
        && !name.contains('.')
        && !name.chars().any(char::is_control)
}

/// The process ids of every pane in `session`.
///
/// **Why this is needed at all.** Everything a user runs inside tmux is a child of the tmux
/// *server*, not of the client sitting on our PTY — so walking our own process tree finds exactly
/// one thing, the client, and misses the build, the dev server and the agent entirely. tmux is the
/// only one that knows, so tmux is asked.
///
/// Empty when there is no tmux, no server, or no such session — all of which mean "nothing to
/// report" rather than an error.
pub fn pane_pids(session: &str) -> Vec<u32> {
    let Some(tmux) = crate::terminal::environment::which("tmux") else {
        return Vec::new();
    };
    let Ok(output) = Command::new(tmux)
        .args(["list-panes", "-t", session, "-F", "#{pane_pid}"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_pane_pids(&String::from_utf8_lossy(&output.stdout))
}

/// Parse one pid per line, ignoring anything that is not one.
pub fn parse_pane_pids(listing: &str) -> Vec<u32> {
    listing
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect()
}

/// Every tmux client this app currently has attached, by terminal device.
///
/// **Why a global.** A tab closing has its session in hand; the two cases that matter most do not:
/// the app being quit, and the app crashing. Neither runs `close()` per tab — the process simply
/// ends, the PTYs go with it, and (measured) that takes the tmux sessions down. The last-resort
/// handler that has to prevent this runs with no access to Tauri state, so the list of devices to
/// detach has to be reachable from anywhere.
///
/// Devices, not session names: detaching by session would reach into another tab or another
/// terminal entirely (see `detach_client`).
static ATTACHED: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

/// Note that a tmux client is attached on `tty`, so it can be detached however the app ends.
pub fn remember(tty: &str) {
    if let Ok(mut set) = ATTACHED.lock() {
        set.insert(tty.to_string());
    }
}

/// Forget a device whose client has already been detached.
pub fn forget(tty: &str) {
    if let Ok(mut set) = ATTACHED.lock() {
        set.remove(tty);
    }
}

/// Detach every client this app has attached. Called when the app exits and when it crashes.
///
/// **The poisoned lock is taken anyway.** A poisoned mutex means a thread panicked while holding
/// it — which is precisely the crash this function exists for. Refusing to run then would disarm
/// the safety exactly when it is needed (rule:crash-handling).
pub fn detach_all() {
    let set = match ATTACHED.lock() {
        Ok(set) => set,
        Err(poisoned) => poisoned.into_inner(),
    };
    if set.is_empty() {
        return;
    }
    tracing::info!(count = set.len(), "detaching every tmux client before exit");
    for tty in set.iter() {
        detach_client(tty);
    }
}

/// Detach the client sitting on `tty`, and nothing else.
///
/// **Why this exists at all: closing the PTY is NOT enough.** Dropping the master sends `SIGHUP` to
/// the client, and the reasonable expectation is that a client hung up on detaches, leaving the
/// session running. Measured against a real server, it does not: the session was gone from
/// `list-sessions` a moment later, while every other session on the same server survived. Whatever
/// the mechanism, the consequence is the maintainer's worst case — a tab closed by accident takes
/// the work with it — so the app now says what it means instead of relying on a signal.
///
/// **`-t <tty>`, never `-s <session>`.** The session form detaches EVERY client of that session,
/// which would reach into another tab of this app, or a terminal the user has open elsewhere. This
/// detaches exactly the one client that is going away.
///
/// Best-effort by design: no tmux, a client that has already gone, a server that has stopped — all
/// of them mean there is nothing left to detach, which is the desired end state anyway. Logged, so
/// a failure is never silent (rule:logging).
pub fn detach_client(tty: &str) {
    let Some(tmux) = crate::terminal::environment::which("tmux") else {
        return;
    };
    match Command::new(tmux)
        .args(["detach-client", "-t", tty])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        Ok(status) if status.success() => {
            tracing::info!(tty, "detached the tmux client — the session keeps running")
        }
        Ok(status) => tracing::debug!(
            tty,
            code = status.code(),
            "no tmux client left to detach on this device"
        ),
        Err(error) => tracing::warn!(tty, error = %error, "could not detach the tmux client"),
    }
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
    ask(session, "#{pane_current_path}")
}

/// What the active pane of `session` is running, asked of tmux itself.
///
/// The counterpart to [`pane_cwd`], and it exists for the same measured reason: **tmux swallows
/// OSC 133** exactly as it swallows OSC 7. A probe emitted `133;C` and `133;D` from inside a tmux
/// session and counted zero of each at the outer terminal, while this query answered correctly. So
/// outside tmux the shell hook drives the activity indicator, and inside it, this does.
///
/// It answers the shell's own name when nothing is running, which is how a caller tells the two
/// apart — there is no exit status to be had this way, only "busy" and "not".
pub fn pane_command(session: &str) -> Option<String> {
    ask(session, "#{pane_current_command}")
}

/// One `display-message -p` query against a session, trimmed, with an empty answer read as none.
fn ask(session: &str, format: &str) -> Option<String> {
    let tmux = find_tmux()?;
    let out = Command::new(tmux)
        .args(["display-message", "-p", "-t", session, format])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
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
    fn the_first_tab_gets_the_configured_session_and_the_next_gets_its_own() {
        // Two tabs on one tmux session share ONE view of it — same window, same scrollback — so a
        // second tab appeared to do nothing at all. A tab is a terminal; it gets a session of its own.
        assert_eq!(first_free("work", &[]), "work");
        assert_eq!(first_free("work", &["work".to_string()]), "work-2");
        assert_eq!(
            first_free("work", &["work".to_string(), "work-2".to_string()]),
            "work-3"
        );
    }

    #[test]
    fn a_gap_in_the_series_is_reused_rather_than_skipped() {
        // Closing the second of three tabs must not leave a hole that never fills.
        assert_eq!(
            first_free("work", &["work".to_string(), "work-3".to_string()]),
            "work-2"
        );
    }

    #[test]
    fn a_session_another_tab_already_shows_is_never_attached_to_twice() {
        // "Attach to X" names one X. A second client on it is a duplicate view, not a second
        // terminal, so a plain shell is the honest answer.
        let launch = launch(
            TmuxMode::Attach,
            "work",
            "/bin/zsh",
            &["work".to_string()],
            None,
        );
        assert_eq!(launch.kind, SessionKind::Shell);
        assert_eq!(launch.program, "/bin/zsh");
        assert!(launch.tmux_session.is_none());
    }

    #[test]
    fn off_starts_the_plain_shell() {
        let launch = launch(TmuxMode::Off, "work", "/bin/zsh", &[], None);
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
        let launch = launch(TmuxMode::AttachOrCreate, "work:1", "/bin/zsh", &[], None);
        assert_eq!(launch, Launch::shell("/bin/zsh"));
    }

    #[test]
    fn attach_or_create_without_a_name_uses_one_anyway() {
        // Skipped where tmux is absent: the point of this test is the arguments, and without the
        // binary the function correctly returns the shell instead.
        let Some(_) = find_tmux() else { return };
        let launch = launch(TmuxMode::AttachOrCreate, "  ", "/bin/zsh", &[], None);
        assert_eq!(
            launch.args,
            vec!["new-session", "-A", "-s", DEFAULT_SESSION],
            "without -s there is nothing for -A to match, so every terminal would start its own"
        );
    }

    #[test]
    fn attach_or_create_uses_the_name_it_was_given() {
        let Some(_) = find_tmux() else { return };
        let launch = launch(TmuxMode::AttachOrCreate, "work", "/bin/zsh", &[], None);
        assert_eq!(launch.args, vec!["new-session", "-A", "-s", "work"]);
    }

    #[test]
    fn a_tmux_launch_remembers_which_session_it_joined() {
        // Inside tmux the working directory is read back from tmux, so the session name has to
        // survive the launch — a hook cannot answer for a shell that was already running.
        let Some(_) = find_tmux() else { return };
        assert_eq!(
            launch(TmuxMode::AttachOrCreate, "work", "/bin/zsh", &[], None).tmux_session,
            Some("work".to_string())
        );
        assert_eq!(
            launch(TmuxMode::Off, "work", "/bin/zsh", &[], None).tmux_session,
            None
        );
    }

    #[test]
    fn a_restored_tab_returns_to_the_session_it_remembers() {
        // The whole point of tmux here: the app crashed, the work kept running, and the tab that was
        // in `work-3` must land back in `work-3` — not in whatever position it happens to open in.
        // Counting is not identity: if a tab was closed before the crash, the positional name belongs
        // to a different session, and the one holding the build is orphaned with nothing pointing at
        // it.
        let Some(_) = find_tmux() else { return };
        let launch = launch(
            TmuxMode::AttachOrCreate,
            "work",
            "/bin/zsh",
            &[],
            Some("work-3"),
        );
        assert_eq!(launch.tmux_session, Some("work-3".to_string()));
        assert_eq!(launch.args, vec!["new-session", "-A", "-s", "work-3"]);
    }

    #[test]
    fn a_remembered_session_another_tab_already_shows_is_not_joined_twice() {
        // Restoring must not defeat the rule it is built on top of: two tabs on one session share one
        // view. The remembered name loses to the tab that already has it, and this tab is numbered.
        let Some(_) = find_tmux() else { return };
        let launch = launch(
            TmuxMode::AttachOrCreate,
            "work",
            "/bin/zsh",
            &["work-3".to_string()],
            Some("work-3"),
        );
        assert_eq!(launch.tmux_session, Some("work".to_string()));
    }

    #[test]
    fn a_remembered_name_outside_the_configured_series_is_refused() {
        // THE security property. The webview may restore a name the backend itself minted — it may
        // not choose one. Without the series check, a compromised or buggy frontend could attach to
        // any tmux session on the machine, including one the user is running for something else
        // entirely (ADR-PROJ-001 §5).
        let Some(_) = find_tmux() else { return };
        for stranger in [
            "someone-else",
            "work:1",
            "work.0",
            "workshop",
            "work-",
            "work-2x",
            "",
        ] {
            let launch = launch(
                TmuxMode::AttachOrCreate,
                "work",
                "/bin/zsh",
                &[],
                Some(stranger),
            );
            assert_eq!(
                launch.tmux_session,
                Some("work".to_string()),
                "{stranger:?} must not be attachable"
            );
        }
    }

    #[test]
    fn remembering_nothing_still_numbers_by_position() {
        // The fallback, unchanged: a tab that has never been in tmux — a brand new one — is numbered
        // exactly as before.
        let Some(_) = find_tmux() else { return };
        assert_eq!(
            launch(
                TmuxMode::AttachOrCreate,
                "work",
                "/bin/zsh",
                &["work".to_string()],
                None
            )
            .tmux_session,
            Some("work-2".to_string())
        );
    }

    #[test]
    fn the_default_series_is_restorable_too() {
        // With no configured name the series is `yggshell`, `yggshell-2`, … — a remembered name from
        // it is as legitimate as one from a named series.
        let Some(_) = find_tmux() else { return };
        assert_eq!(
            launch(
                TmuxMode::AttachOrCreate,
                "",
                "/bin/zsh",
                &[],
                Some("yggshell-4")
            )
            .tmux_session,
            Some("yggshell-4".to_string())
        );
    }

    #[test]
    fn remembering_a_session_never_overrides_a_fallback() {
        // Every escape hatch stays open: tmux off, a plain shell after a detach, and an unusable
        // configured name all still produce a shell, whatever the tab remembers. A restore that
        // could resurrect tmux against the setting would be a worse bug than the one it fixes.
        assert_eq!(
            launch(TmuxMode::Off, "work", "/bin/zsh", &[], Some("work-3")),
            Launch::shell("/bin/zsh")
        );
        assert_eq!(
            launch(
                TmuxMode::AttachOrCreate,
                "bad:name",
                "/bin/zsh",
                &[],
                Some("work-3")
            )
            .kind,
            SessionKind::Shell
        );
    }

    #[test]
    fn attach_mode_ignores_what_a_tab_remembers() {
        // Deliberate: `Attach` has no series. Every tab targets the ONE configured session, and the
        // second one gets a plain shell because that session is taken — so there is nothing for a tab
        // to have been numbered into, and nothing to restore. Pinned so the asymmetry is a decision
        // rather than something a later reader "fixes" into an inconsistency.
        let Some(_) = find_tmux() else { return };
        let launch = launch(
            TmuxMode::Attach,
            "work",
            "/bin/zsh",
            &["work".to_string()],
            Some("work-3"),
        );
        assert_eq!(launch.kind, SessionKind::Shell);
    }

    #[test]
    fn a_tmux_session_is_marked_to_be_detached_never_killed() {
        // This is the flag that decides whether closing a tab detaches or destroys. A multiplexer
        // whose work dies with the window looking at it is worse than no multiplexer at all.
        let Some(_) = find_tmux() else { return };
        assert_eq!(
            launch(TmuxMode::AttachOrCreate, "work", "/bin/zsh", &[], None).kind,
            SessionKind::TmuxClient
        );
    }

    /// Run a tmux subcommand against the server, returning whether it succeeded.
    ///
    /// Arguments are assembled rather than written out because one of them is the very word the
    /// guard below scans the source for, and a gate that flags its own test teaches the next person
    /// to delete the gate.
    fn tmux_ok(args: &[&str]) -> bool {
        let Some(tmux) = find_tmux() else {
            return false;
        };
        Command::new(tmux)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    }

    #[test]
    fn closing_a_tab_detaches_from_a_real_tmux_session_and_leaves_it_running() {
        // The claim this proves is the one the maintainer cares about most: closing a tab, the
        // window, or the whole app must never destroy a session, so work stays resumable even after
        // an accidental close or a crash. Reading `close()` shows no kill; it does NOT show what the
        // kernel does to the tmux CLIENT when the master goes — and that is the half that could
        // still take a session down. So this drives a real server.
        //
        // Safe next to the maintainer's own sessions: a name nobody else uses, `has-session` on that
        // name only, and the cleanup targets that name. `kill-server` is never called by anything
        // here — it would take every session on the machine.
        let Some(_) = find_tmux() else { return };
        let name = format!("ygg-detach-{}", std::process::id());
        if !tmux_ok(&["new-session", "-d", "-s", &name]) {
            return; // No server and none can be started (a CI box without a tty). Nothing to prove.
        }

        let launch = launch(TmuxMode::Attach, &name, "/bin/sh", &[], None);
        assert_eq!(
            launch.kind,
            SessionKind::TmuxClient,
            "must attach, not fall back"
        );
        let spawned = crate::terminal::pty::spawn(crate::terminal::pty::Spawn {
            program: &launch.program,
            args: &launch.args,
            kind: launch.kind,
            cwd: None,
            size: crate::terminal::pty::Size { rows: 24, cols: 80 },
        })
        .expect("a tmux client starts");

        // Let the client actually attach before pulling the terminal out from under it.
        std::thread::sleep(std::time::Duration::from_millis(400));
        assert!(
            tmux_ok(&["has-session", "-t", &name]),
            "the session must still be there before the tab is closed, or this proves nothing"
        );

        // Exactly what closing a tab does, in the same order.
        if let Some(tty) = spawned.pid.and_then(crate::terminal::attached::tty_of) {
            detach_client(&tty);
        }
        spawned.pty.close();
        std::thread::sleep(std::time::Duration::from_millis(400));

        let alive = tmux_ok(&["has-session", "-t", &name]);
        tmux_ok(&[concat!("kill", "-session"), "-t", &name]);
        assert!(
            alive,
            "closing the tab destroyed the tmux session — it must only detach"
        );
    }

    #[test]
    fn a_remembered_client_is_forgotten_again_when_its_tab_closes() {
        // The registry is what the exit and crash paths iterate. A device left in it after its tab
        // closed means detaching a terminal that belongs to something else later on.
        let tty = format!("/dev/ttys-test-{}", std::process::id());
        remember(&tty);
        assert!(ATTACHED.lock().unwrap().contains(&tty));
        forget(&tty);
        assert!(!ATTACHED.lock().unwrap().contains(&tty));
    }

    #[test]
    fn detaching_everything_with_nothing_attached_does_nothing_at_all() {
        // Called on every exit, including the overwhelmingly common one where no tab was in tmux.
        // It must not shell out, and it must not fail.
        detach_all();
    }

    #[test]
    fn all_three_ways_out_hand_the_session_back() {
        // Closing a tab, quitting the app, and crashing. Only the first runs `close()`; the other
        // two end the process, and a tmux client that loses its terminal takes the session with it.
        // So each exit has to detach explicitly, and this pins that none of the three loses its
        // call to a refactor — the failure is silent and costs the user their work.
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let expected = [
            ("terminal/mod.rs", "detach_client"), // a tab closing
            ("lib.rs", "detach_all"),             // the app quitting
            ("crash.rs", "detach_all"),           // the app crashing
        ];
        for (file, call) in expected {
            let text = std::fs::read_to_string(root.join(file)).unwrap_or_default();
            let called = text
                .lines()
                .filter(|line| !line.trim_start().starts_with("//"))
                .any(|line| line.contains(call));
            assert!(
                called,
                "{file} must call tmux::{call} — see this test's comment"
            );
        }
    }

    #[test]
    fn nothing_in_the_backend_can_destroy_a_tmux_session() {
        // `close()` is correct today; this is about tomorrow. Killing a session is one plausible
        // line away — `kill-session` reads like ordinary cleanup — and the damage is silent and
        // total: the user's work is gone with no error anywhere. So the whole backend is scanned.
        //
        // Comments are skipped for the same reason as in `environment.rs`: the sentence explaining
        // why not to do this contains the words.
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let banned = [
            concat!("kill", "-session"),
            concat!("kill", "-server"),
            concat!("kill", "-window"),
        ];
        let mut offenders = Vec::new();

        fn walk(dir: &std::path::Path, banned: &[&str], offenders: &mut Vec<String>) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, banned, offenders);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    let text = std::fs::read_to_string(&path).unwrap_or_default();
                    let hit = text
                        .lines()
                        .filter(|line| !line.trim_start().starts_with("//"))
                        .any(|line| banned.iter().any(|b| line.contains(b)));
                    if hit {
                        offenders.push(path.display().to_string());
                    }
                }
            }
        }
        walk(&src, &banned, &mut offenders);

        assert!(
            offenders.is_empty(),
            "a tmux session must be DETACHED from, never destroyed — closing a tab, the app, or \
             crashing must all leave it resumable. These would destroy one: {offenders:?}"
        );
    }

    #[test]
    fn every_fallback_is_marked_as_a_shell() {
        // A fallback really is a plain shell, so it must be ended like one — with its process group.
        assert_eq!(
            launch(TmuxMode::Off, "", "/bin/zsh", &[], None).kind,
            SessionKind::Shell
        );
        assert_eq!(
            launch(TmuxMode::AttachOrCreate, "bad:name", "/bin/zsh", &[], None).kind,
            SessionKind::Shell
        );
    }
}
