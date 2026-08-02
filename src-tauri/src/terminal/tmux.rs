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
use crate::error::{AppError, Result};
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

        // `new-session -A` is attach-or-create in one call, and the name decides which of the two
        // happens. Two different intentions arrive here and they are told apart by `remembered`:
        //
        // - **Recover** — a restored tab, or a session the user picked out of the list. It names the
        //   session it wants and gets it, whether that means attaching or recreating it.
        // - **New** — a tab that names nothing. It gets a name free BOTH in this app and in tmux, so
        //   `-A` has nothing to attach to and a genuinely new session is created.
        //
        // The second half of that used to be untrue, and it was the whole confusion: the numbering
        // consulted only this app's open tabs, so closing three tabs and pressing ⌘T tomorrow picked
        // `base` again and `-A` dropped the user straight into yesterday's session. New meant
        // recover, silently, and there was no way to ask for either on purpose. Attaching is now the
        // picker's job — an action the user takes, not a side effect of opening a tab.
        TmuxMode::AttachOrCreate => {
            let base = if session.is_empty() {
                DEFAULT_SESSION
            } else {
                session
            };
            // A named session wins — that is the recover case, and it deliberately ignores the
            // "is it already running" question the new-tab path now asks: a restored tab MUST land in
            // its own session precisely because that session is still there.
            let name = remembered
                .map(str::trim)
                .filter(|name| may_name(base, name, |n| has_session(&tmux, n)))
                .filter(|name| !taken.iter().any(|t| t == name))
                .map(str::to_string)
                .unwrap_or_else(|| first_free(base, taken, &session_names()));
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

/// Which tmux mode a tab actually opens with — the Settings default, unless something overrides it.
///
/// Two overrides, in order, and they answer different questions:
///
/// - `plain` — "put me back in a terminal", set when a tab drops out of tmux. It wins over
///   everything: a detach that a profile could undo would not be a detach.
/// - the profile's own `tmux` — "this KIND of tab does not use tmux" (or does). This is what lets one
///   workspace hold both, which no global setting can express.
pub fn effective_mode(
    plain: bool,
    profile: Option<&crate::dto::TerminalProfile>,
    settings_mode: TmuxMode,
) -> TmuxMode {
    if plain {
        return TmuxMode::Off;
    }
    profile.and_then(|p| p.tmux).unwrap_or(settings_mode)
}

/// Used when the user asked for attach-or-create without naming a session.
const DEFAULT_SESSION: &str = "yggshell";

/// How many suffixed sessions we will look through before giving up on finding a free name.
///
/// A bound rather than a loop: `taken` comes from the number of open tabs, so it cannot realistically
/// be long — but an unbounded search over a list someone else controls is a habit worth not having.
const MAX_SESSIONS: usize = 64;

/// Whether the caller may name `name` — the boundary check on a session the frontend asks for.
///
/// Two ways to qualify, and they are the two legitimate reasons to name a session at all:
///
/// - **it is in `base`'s series** (`base`, `base-N`) — a name this backend minted for this tab, handed
///   back when the tab is restored. It need not exist: recreating it under the same name is the right
///   answer for a tab whose session did not survive.
/// - **the tmux server actually has it** — a session the user picked out of the list this backend
///   itself produced (`session_names`).
///
/// **This is deliberately wider than the series alone, because attaching to an arbitrary session is
/// now a feature rather than an accident** (ADR-PROJ-001 §5). It is not unbounded: the name is still
/// validated, so it cannot address a window or a pane inside something else, and a name that neither
/// exists nor belongs to the series is refused and the caller is numbered instead.
///
/// The tighter alternative — the backend minting an opaque handle per listed session and accepting
/// only handles — was considered and not built. It defends against a webview naming a session the
/// user never saw, and that webview can already type into every session the app has open
/// (`terminal_write`); the machinery would not raise the real floor.
///
/// `exists` is passed in rather than asked here so this can be tested at all: the alternative is a
/// test that creates real tmux sessions on the machine running it, which would collide with the
/// maintainer's own (rule:testing — a test that can disturb the developer's state is a defect).
fn may_name(base: &str, name: &str, exists: impl Fn(&str) -> bool) -> bool {
    if !is_valid_session_name(name) {
        return false;
    }
    in_series(base, name) || exists(name)
}

/// Whether `name` is one this app could have handed out for `base` — `base` itself, or `base-N`.
fn in_series(base: &str, name: &str) -> bool {
    if name == base {
        return true;
    }
    name.strip_prefix(base)
        .and_then(|rest| rest.strip_prefix('-'))
        .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

/// The first name in the `base`, `base-2`, `base-3`, … series that is free for a **new** session.
///
/// Free means free in **both** places, and the second one is the fix: `taken` is what this app's
/// other tabs hold, `existing` is what the tmux server holds. Consulting only the first meant a name
/// could be free here and occupied there — and since the caller runs `new-session -A`, "occupied
/// there" silently became "attach to it". A user who closed their tabs yesterday and opened a new one
/// today landed in yesterday's session without asking.
///
/// Falls back to the base when every candidate is taken; at that point sixty-four terminals are open
/// and a shared view is a smaller problem than refusing to open one.
fn first_free(base: &str, taken: &[String], existing: &BTreeSet<String>) -> String {
    let free = |name: &str| !taken.iter().any(|t| t == name) && !existing.contains(name);
    if free(base) {
        return base.to_string();
    }
    for n in 2..=MAX_SESSIONS {
        let candidate = format!("{base}-{n}");
        if free(&candidate) {
            return candidate;
        }
    }
    tracing::warn!(base, "every tmux session name in the series is taken");
    base.to_string()
}

/// Every session the tmux server currently has.
///
/// Empty when there is no tmux, no server or no session — all of which mean "nothing is running",
/// which is not an error and is by far the most common answer.
pub fn session_names() -> BTreeSet<String> {
    let Some(tmux) = find_tmux() else {
        return BTreeSet::new();
    };
    let Ok(output) = Command::new(tmux)
        .args(["list-sessions", "-F", "#{session_name}"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return BTreeSet::new();
    };
    if !output.status.success() {
        return BTreeSet::new();
    }
    parse_session_names(&String::from_utf8_lossy(&output.stdout))
}

/// Every running session with what is in it — the list behind the picker and the tmux tool.
///
/// One call, one format string: tmux resolves a session's active window and pane for
/// `pane_current_command`, so "what is it running" costs nothing extra.
pub fn sessions() -> Vec<crate::dto::TmuxSession> {
    let Some(tmux) = find_tmux() else {
        return Vec::new();
    };
    let Ok(output) = Command::new(tmux)
        .args([
            "list-sessions",
            "-F",
            "#{session_name}\t#{session_windows}\t#{session_attached}\t#{pane_current_command}",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_sessions(&String::from_utf8_lossy(&output.stdout))
}

/// Pick the sessions out of the tab-separated listing.
///
/// A line that does not parse is **skipped, not defaulted**: a session reported with zero windows and
/// no command would look like an empty one worth ending, which is the opposite of what an unreadable
/// line means.
fn parse_sessions(stdout: &str) -> Vec<crate::dto::TmuxSession> {
    stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let name = parts.next()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some(crate::dto::TmuxSession {
                name,
                windows: parts.next()?.trim().parse().ok()?,
                attached: parts.next()?.trim() != "0",
                command: parts.next().unwrap_or("").trim().to_string(),
            })
        })
        .collect()
}

/// End a session and everything running in it.
///
/// **Destructive, and the only place in this app that is.** Closing a tab detaches; this kills. It
/// exists because the two together were incomplete: since a new tab no longer reuses an old session,
/// sessions accumulate with nothing to clear them (`first_free`).
pub fn kill(name: &str) -> Result<()> {
    let tmux = require(name)?;
    run(&tmux, &["kill-session", "-t", name], "ending")
}

/// Rename a session.
///
/// The caller is responsible for carrying any tab that named the old one across — a rename that left
/// a tab pointing at a name nobody has would make that tab create an empty session under it on the
/// next start, which is the very defect the restore exists to prevent (ADR-PROJ-001 §5).
pub fn rename(from: &str, to: &str) -> Result<()> {
    let tmux = require(from)?;
    if !is_valid_session_name(to) {
        return Err(AppError::Other(format!(
            "not a usable tmux session name: {to}"
        )));
    }
    if has_session(&tmux, to) {
        return Err(AppError::Other(format!(
            "a session named {to} already exists"
        )));
    }
    run(&tmux, &["rename-session", "-t", from, to], "renaming")
}

/// The tmux binary, refusing a name that does not address one session.
fn require(name: &str) -> Result<String> {
    if !is_valid_session_name(name) {
        return Err(AppError::Other(format!(
            "not a usable tmux session name: {name}"
        )));
    }
    find_tmux()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::Other("tmux is not on PATH".into()))
}

/// Run a tmux subcommand, turning a non-zero exit into an error that carries what tmux said.
fn run(tmux: &str, args: &[&str], what: &str) -> Result<()> {
    let output = Command::new(tmux)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| AppError::Other(format!("{what} a tmux session failed: {e}")))?;
    if output.status.success() {
        tracing::info!(?args, "tmux");
        return Ok(());
    }
    Err(AppError::Other(format!(
        "{what} the tmux session failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

/// Pick the names out of `tmux list-sessions -F '#{session_name}'`.
fn parse_session_names(stdout: &str) -> BTreeSet<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
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

    /// `tmux list-sessions` said nothing — the ordinary case, and the one that must not be special.
    fn nothing_running() -> BTreeSet<String> {
        BTreeSet::new()
    }

    fn running(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn the_first_tab_gets_the_configured_session_and_the_next_gets_its_own() {
        // Two tabs on one tmux session share ONE view of it — same window, same scrollback — so a
        // second tab appeared to do nothing at all. A tab is a terminal; it gets a session of its own.
        assert_eq!(first_free("work", &[], &nothing_running()), "work");
        assert_eq!(
            first_free("work", &["work".to_string()], &nothing_running()),
            "work-2"
        );
        assert_eq!(
            first_free(
                "work",
                &["work".to_string(), "work-2".to_string()],
                &nothing_running()
            ),
            "work-3"
        );
    }

    #[test]
    fn a_gap_in_the_series_is_reused_rather_than_skipped() {
        // Closing the second of three tabs must not leave a hole that never fills.
        assert_eq!(
            first_free(
                "work",
                &["work".to_string(), "work-3".to_string()],
                &nothing_running()
            ),
            "work-2"
        );
    }

    #[test]
    fn a_new_tab_skips_a_session_that_is_still_running_without_a_tab() {
        // THE new-versus-recover fix. Closing every tab does not stop the tmux sessions — so a name
        // free in this app can be occupied in tmux, and the caller runs `new-session -A`, which turns
        // "occupied" into "attach". Yesterday's work, reopened by pressing ⌘T. A new tab must be new;
        // reaching an old session is the picker's job now.
        assert_eq!(first_free("work", &[], &running(&["work"])), "work-2");
        assert_eq!(
            first_free("work", &[], &running(&["work", "work-2"])),
            "work-3"
        );
        // Free in tmux but held by a tab, or the other way round — either alone is enough to skip it.
        assert_eq!(
            first_free("work", &["work-2".to_string()], &running(&["work"])),
            "work-3"
        );
    }

    #[test]
    fn a_session_listing_carries_what_is_in_it() {
        // Names alone are useless after a crash: `yggshell`, `yggshell-2`, `yggshell-3` say nothing
        // about which one holds the build. What it is running and how long it has been there are what
        // make "end it or attach to it" a decision rather than a guess.
        let out = "yggshell\t2\t1\tzsh\nbuild\t1\t0\tcargo\n";
        let sessions = parse_sessions(out);

        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].name, "yggshell");
        assert_eq!(sessions[0].windows, 2);
        assert!(sessions[0].attached);
        assert_eq!(sessions[0].command, "zsh");
        assert!(!sessions[1].attached);
        assert_eq!(sessions[1].command, "cargo");
    }

    #[test]
    fn an_unreadable_line_is_skipped_rather_than_defaulted() {
        // A session reported with zero windows and no command reads as an empty one worth ending —
        // the opposite of what "this line did not parse" means. Dropping it is the honest failure.
        let sessions = parse_sessions("good\t1\t0\tzsh\nbroken\tnope\t0\tzsh\n\n");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].name, "good");

        // A command tmux left empty is not a parse failure — it is a session with nothing named.
        let bare = parse_sessions("x\t1\t0\t");
        assert_eq!(bare.len(), 1);
        assert_eq!(bare[0].command, "");
    }

    #[test]
    fn a_name_that_addresses_something_else_is_never_killed_or_renamed() {
        // `kill-session -t work:1` would destroy a WINDOW inside another session. The check runs
        // before tmux is even located, so a malformed name can never reach the command line.
        assert!(kill("work:1").is_err());
        assert!(kill("").is_err());
        assert!(rename("work.0", "safe").is_err());
    }

    #[test]
    fn a_session_list_is_read_as_names_and_an_empty_answer_is_not_an_error() {
        assert_eq!(
            parse_session_names("work\nwork-2\n"),
            running(&["work", "work-2"])
        );
        // No server running: tmux exits non-zero and says nothing. Nobody is in tmux, which is the
        // common case and not a failure.
        assert_eq!(parse_session_names(""), nothing_running());
        assert_eq!(parse_session_names("  \n\n"), nothing_running());
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

        // The SHAPE, not the exact name — and that is the change, not a weakened assertion. A new tab
        // now takes the first name free in this app AND on the tmux server, so which of the series it
        // lands on depends on what happens to be running. Pinning `yggshell` made this test pass or
        // fail depending on the developer's own sessions, which is a defect in a test, not a finding
        // (rule:testing). What must hold is invariant: a name from the series is always passed, so
        // `-A` has something to match and every terminal does not start its own.
        assert_eq!(launch.args.len(), 4);
        assert_eq!(&launch.args[..3], &["new-session", "-A", "-s"]);
        assert!(
            in_series(DEFAULT_SESSION, &launch.args[3]),
            "expected a name from the {DEFAULT_SESSION} series, got {:?}",
            launch.args[3]
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

    fn profile(tmux: Option<TmuxMode>) -> crate::dto::TerminalProfile {
        crate::dto::TerminalProfile {
            id: "p".into(),
            name: "P".into(),
            shell: None,
            cwd: None,
            theme: None,
            tmux,
        }
    }

    #[test]
    fn a_profile_decides_whether_its_tabs_use_tmux() {
        // What makes a MIXED workspace possible. A global setting can only say "all tabs" or "no
        // tabs"; the per-tab answer has to come from somewhere, and the profile is where every other
        // per-tab override already lives.
        let with = profile(Some(TmuxMode::AttachOrCreate));
        let without = profile(Some(TmuxMode::Off));
        assert_eq!(
            effective_mode(false, Some(&with), TmuxMode::Off),
            TmuxMode::AttachOrCreate
        );
        assert_eq!(
            effective_mode(false, Some(&without), TmuxMode::AttachOrCreate),
            TmuxMode::Off
        );
    }

    #[test]
    fn a_profile_that_says_nothing_takes_the_setting() {
        // Every field of a profile is an override and Settings holds the defaults — so a profile
        // written before this field existed keeps behaving exactly as it did (ADR-CORE-005).
        let quiet = profile(None);
        assert_eq!(
            effective_mode(false, Some(&quiet), TmuxMode::AttachOrCreate),
            TmuxMode::AttachOrCreate
        );
        assert_eq!(
            effective_mode(false, None, TmuxMode::Attach),
            TmuxMode::Attach
        );
    }

    #[test]
    fn a_detach_beats_the_profile_and_the_setting_alike() {
        // "Put me back in a terminal" is the user acting now; a profile that could undo it would mean
        // the tab silently rejoined the session they just left.
        let with = profile(Some(TmuxMode::AttachOrCreate));
        assert_eq!(
            effective_mode(true, Some(&with), TmuxMode::AttachOrCreate),
            TmuxMode::Off
        );
    }

    #[test]
    fn a_name_is_allowed_when_it_is_ours_or_when_it_really_exists() {
        // The boundary on what the frontend may name. Two legitimate reasons, and nothing else:
        //
        //  - it belongs to this base's series — a name this backend minted, handed back by a restored
        //    tab. It need NOT exist: recreating it is the right answer for a session that did not
        //    survive.
        //  - tmux actually has it — the user picked it out of the list this backend produced.
        //
        // Wider than the series alone on purpose (ADR-PROJ-001 §5): attaching to an arbitrary session
        // is a feature now, not an accident. Still bounded — a name that is neither is refused, and an
        // invalid one is refused whatever tmux says.
        let none = |_: &str| false;
        assert!(may_name("work", "work", none));
        assert!(may_name("work", "work-7", none));
        assert!(may_name("work", "someone-else", |n| n == "someone-else"));

        assert!(!may_name("work", "someone-else", none));
        assert!(!may_name("work", "workshop", none));
        assert!(!may_name("work", "work-", none));
        assert!(!may_name("work", "work-2x", none));
        assert!(!may_name("work", "", none));
    }

    #[test]
    fn a_name_that_addresses_something_else_is_refused_even_if_tmux_answers_for_it() {
        // `session:window.pane` — these do not name what the user typed, they name something inside
        // another session. The validity check runs BEFORE the existence question for exactly that
        // reason: a tmux that happily answers must not be able to talk this into accepting one.
        let anything = |_: &str| true;
        assert!(!may_name("work", "work:1", anything));
        assert!(!may_name("work", "work.0", anything));
        assert!(!may_name("work", "bad\nname", anything));
        assert!(!may_name("work", &"x".repeat(65), anything));
    }

    #[test]
    fn a_stranger_falls_back_to_being_numbered_rather_than_refused_outright() {
        // A tab that names something it may not have is not an error — it is numbered, like any new
        // tab. Refusing to open a terminal over a stale name would be the worse answer.
        let Some(_) = find_tmux() else { return };
        let launch = launch(
            TmuxMode::AttachOrCreate,
            "work",
            "/bin/zsh",
            &[],
            Some("work:1"),
        );
        assert!(launch.tmux_session.is_some());
        assert_ne!(launch.tmux_session, Some("work:1".to_string()));
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
        // NARROWED, not weakened: `tmux::kill` exists now, because a user must be able to end a
        // session they can see in the tool — sessions accumulate and nothing else clears them. That
        // is a DIFFERENT act from the ones this guard is about. What must never happen is a session
        // dying because a tab closed, the app quit, or something crashed; what may happen is the user
        // asking, in front of a confirmation, for this one to end.
        //
        // So exactly one file may contain the words, and it is this one — where `kill` sits next to
        // `detach_client` and the comment explaining the difference. Every other file in the backend
        // is still refused, which is where the accidental cleanup would have been written.
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
                    // The one deliberate exception, by filename rather than by content: a call
                    // anywhere else is the accident this guard exists for.
                    let deliberate = path.file_name().is_some_and(|n| n == "tmux.rs");
                    if hit && !deliberate {
                        offenders.push(path.display().to_string());
                    }
                }
            }
        }
        walk(&src, &banned, &mut offenders);

        assert!(
            offenders.is_empty(),
            "a tmux session must be DETACHED from, never destroyed — closing a tab, the app, or \
             crashing must all leave it resumable. Ending one is the USER's act, taken in front of a \
             confirmation, and it lives in terminal/tmux.rs beside `detach_client`. These would \
             destroy a session from somewhere else: {offenders:?}"
        );
    }

    #[test]
    fn ending_a_session_stays_a_deliberate_act_the_user_takes() {
        // The other half of the guard above, and the reason it could be narrowed at all: `kill` is
        // reachable ONLY through a command the user triggers. If a future change calls it from the
        // close path, the exit path or a crash handler, the words appear in that file and the scan
        // above fails — this test pins the intent so the exception cannot quietly widen.
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let callers: Vec<String> = walk_files(&src)
            .into_iter()
            .filter(|(_, text)| {
                text.lines()
                    .filter(|line| !line.trim_start().starts_with("//"))
                    // Split like the scan above, or this very line matches itself.
                    .any(|line| line.contains(concat!("tmux::", "kill(")))
            })
            .map(|(path, _)| path)
            .collect();

        assert_eq!(
            callers,
            vec!["commands/terminal.rs".to_string()],
            "`tmux::kill` may be called only from the command the user triggers — not from closing \
             a tab, quitting, or a crash path"
        );
    }

    /// Every `.rs` file under `src`, as (path relative to src, contents).
    fn walk_files(dir: &std::path::Path) -> Vec<(String, String)> {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(dir) else {
            return out;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(walk_files(&path));
            } else if path.extension().is_some_and(|e| e == "rs") {
                let rel = path
                    .strip_prefix(&root)
                    .unwrap_or(&path)
                    .display()
                    .to_string();
                out.push((rel, std::fs::read_to_string(&path).unwrap_or_default()));
            }
        }
        out.sort();
        out
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
