//! The terminal's IPC surface (ADR-PROJ-001). Thin, like every command module: validate, call the
//! registry, map the error (rule:rust-conventions).
//!
//! **No command here takes a command line.** `terminal_open` says *that* a terminal should start and
//! *where*; the program is resolved in the backend. A webview that could name the program would be a
//! webview that can run anything the user's account can — which is not the same thing as a terminal
//! the user typed into (ADR-PROJ-001 §5, rule:security).

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::terminal::{pty::Size, SessionId, TerminalRegistry};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

/// Start a terminal session and stream its output into `on_output`.
///
/// Output arrives as raw `ArrayBuffer` batches — bytes, not text, so the emulator does its own UTF-8
/// decoding and a multi-byte character split across two reads still renders. Batching happens in the
/// backend (ADR-PROJ-001 §3).
///
/// `plain` starts a plain shell whatever the tmux setting says. It is what a tab uses after the user
/// detaches from tmux: leaving tmux means going back to a terminal, not losing the window.
///
/// `profile` names a stored [`crate::dto::TerminalProfile`] — a *reference*, never a command line
/// (ADR-PROJ-001 §5). What it overrides (shell, directory, colour scheme) is resolved in the backend;
/// what it does not override comes from Settings.
///
/// Fails if the PTY cannot be opened, the shell cannot be started, or `cwd` is not an existing
/// directory.
#[tauri::command]
// The IPC shape: Tauri injects three of these and the webview names four. Folding them into a struct
// would change the wire format for the sake of a lint about ergonomics that do not exist here — this
// signature is never called by hand.
#[allow(clippy::too_many_arguments)]
pub fn terminal_open(
    app: tauri::AppHandle,
    registry: State<'_, TerminalRegistry>,
    state: State<'_, AppState>,
    on_output: Channel<InvokeResponseBody>,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    profile: Option<String>,
    plain: Option<bool>,
    tmux_session: Option<String>,
) -> Result<crate::dto::TerminalOpened> {
    let plain = plain.unwrap_or(false);
    tracing::info!(
        rows,
        cols,
        ?cwd,
        ?profile,
        plain,
        ?tmux_session,
        "terminal_open"
    );
    // The shell and whether tmux wraps it are persisted PREFERENCES, not something the webview may
    // choose per call. `tmux_session` is a restore of a name this backend handed out, not a choice —
    // it is refused unless it belongs to the configured series.
    // Even the shell setting is only ever a pick from a list the backend produced, and the registry
    // checks it again before it spawns anything (ADR-PROJ-001 §5, `terminal::shells`).
    let settings = state.settings.get();
    // A profile is a REFERENCE — the backend resolves it into a program. A profile that has since
    // been deleted reads as absent, and the terminal opens from the Settings defaults rather than
    // refusing: a stale tab is not a reason to leave the user without a shell.
    let profile = profile
        .as_deref()
        .and_then(|id| crate::profile::get(&state.data_dir, id));
    let opened = registry.open(
        app,
        on_output,
        crate::terminal::Open {
            cwd: cwd.map(Into::into),
            size: Size { rows, cols },
            settings: &settings,
            profile: profile.as_ref(),
            plain,
            // A restored tab asking for the session it was in before the app stopped. Checked against
            // the configured series in `tmux::launch` — the webview restores a name, it cannot pick
            // one (ADR-PROJ-001 §5).
            tmux_session,
        },
    )?;
    tracing::debug!(session = opened.id, tmux = ?opened.tmux_session, "terminal_open ok");
    Ok(opened)
}

/// Send input to a session — keystrokes, a paste, a control sequence.
///
/// Logged by length only. The bytes are what the user is typing, which includes the password they
/// are about to paste (rule:logging, ADR-CORE-011).
#[tauri::command]
pub fn terminal_write(
    registry: State<'_, TerminalRegistry>,
    id: SessionId,
    data: String,
) -> Result<()> {
    tracing::trace!(session = id, bytes = data.len(), "terminal_write");
    registry.write(id, data.as_bytes())
}

/// Tell a session that its window changed, so the child gets its `SIGWINCH` and redraws.
#[tauri::command]
pub fn terminal_resize(
    registry: State<'_, TerminalRegistry>,
    id: SessionId,
    rows: u16,
    cols: u16,
) -> Result<()> {
    registry.resize(id, Size { rows, cols })
}

/// What a session is doing, for the cases the frontend cannot see for itself.
///
/// Everything here is empty for an ordinary shell, and deliberately so: outside tmux the shell's own
/// OSC 7 and OSC 133 sequences reach the emulator directly — instantly, and with an exit status a
/// poll could never provide. Inside tmux both are swallowed (measured, not assumed), so the working
/// directory and whether a command is running are asked of tmux instead.
#[tauri::command]
pub fn terminal_status(
    registry: State<'_, TerminalRegistry>,
    state: State<'_, AppState>,
    id: SessionId,
) -> Result<crate::dto::TerminalStatus> {
    registry.status(id, &crate::agent::hooks::events_path(&state.data_dir))
}

/// End a session because the user closed its tab.
///
/// This takes down the foreground process group, not just the shell: a build or an AI harness
/// running inside it goes with the tab instead of being orphaned (see `pty::Pty::close`).
#[tauri::command]
pub fn terminal_close(registry: State<'_, TerminalRegistry>, id: SessionId) -> Result<()> {
    tracing::info!(session = id, "terminal_close");
    registry.close(id)
}

/// What a tab is running, and what it is listening on.
///
/// Read-only: nothing here starts or stops a process, and the frontend names a *session*, never a
/// command (ADR-PROJ-001 §5). Called on demand rather than on a timer — it spawns `ps` and `lsof`,
/// which have no business on a four-second interval.
#[tauri::command]
pub fn terminal_activity(
    state: tauri::State<'_, TerminalRegistry>,
    id: u32,
) -> Result<crate::dto::TerminalActivity> {
    tracing::debug!(session = id, "terminal_activity");
    state.activity(id)
}

/// What the AI harness in this tab is doing.
///
/// **The Claude home is read from the tab's own process environment**, never assumed: the maintainer
/// runs several accounts side by side, one per project, and a tool that hard-coded `~/.claude` would
/// show the wrong one in most of them — plausibly, which is worse than showing nothing (`agent`).
///
/// `None` when no agent has run in this directory, which is the ordinary case for most tabs.
#[tauri::command]
pub fn agent_session(
    app: tauri::AppHandle,
    id: u32,
    cwd: String,
) -> Result<Option<crate::dto::AgentSession>> {
    tracing::debug!(session = id, %cwd, "agent_session");
    let cwd_path = std::path::Path::new(&cwd);
    // In order of how much the answer can be trusted: what the project DECLARES, then whichever home
    // has actually been used here, then the default. Never a hard-coded `~/.claude` — see `agent`.
    let home = crate::agent::declared_home(cwd_path)
        .or_else(|| {
            home_dir(&app)
                .and_then(|dir| crate::agent::homes_for(&dir, cwd_path).into_iter().next())
        })
        .or_else(|| home_dir(&app).map(|dir| dir.join(".claude")));
    let Some(home) = home else {
        tracing::debug!("no claude home could be determined");
        return Ok(None);
    };
    let session = crate::agent::session(&home, cwd_path);
    tracing::debug!(
        found = session.is_some(),
        home = %home.display(),
        "agent_session ok"
    );
    Ok(session)
}

/// The chain of work the agent in this tab has been through.
///
/// **Always the whole chain, never a delta.** The offset that makes this cheap lives in the backend
/// cache and does not cross the boundary — a delta command would be destructive on call, and the
/// frontend loses one four different ways (StrictMode, `retry: 3`, remount, two tabs on one repo).
/// See `agent::chain::cache`.
///
/// `None` when no agent has run in this directory. Nothing read here is logged: this reads the
/// user's prompts, commands and file contents, and ADR-PROJ-005 §1 permits counters and
/// classifications in the log, never content.
#[tauri::command]
pub fn agent_chain(
    app: tauri::AppHandle,
    cwd: String,
) -> Result<Option<crate::agent::chain::model::Chain>> {
    use tauri::Manager;
    let cwd_path = std::path::Path::new(&cwd);
    let home = crate::agent::declared_home(cwd_path)
        .or_else(|| {
            home_dir(&app)
                .and_then(|dir| crate::agent::homes_for(&dir, cwd_path).into_iter().next())
        })
        .or_else(|| home_dir(&app).map(|dir| dir.join(".claude")));
    let Some(home) = home else {
        return Ok(None);
    };
    let state = app.state::<crate::state::AppState>();
    let mut chain = crate::agent::chain::read(&home, cwd_path, &state.chain);

    // **Which of the two silences this is.** The transcript cannot say: an agent blocked on a
    // permission prompt and one that has simply finished both write nothing at all. The hook events
    // can, and they are already installed for the attention bell — one source, two renderings
    // (ADR-CORE-005), rather than a second mechanism that would eventually disagree in front of the
    // user.
    if let Some(chain) = chain.as_mut() {
        if chain.standing == crate::agent::chain::model::Standing::Idle {
            if let Some(asking) = waiting_here(&app, &cwd) {
                chain.standing = crate::agent::chain::model::Standing::Waiting;
                chain.waiting_for = asking;
            }
        }
    }
    tracing::debug!(
        found = chain.is_some(),
        links = chain.as_ref().map_or(0, |c| c.links.len()),
        understood = chain.as_ref().map_or(0, |c| c.steps_understood),
        seen = chain.as_ref().map_or(0, |c| c.steps_seen),
        "agent_chain ok"
    );
    Ok(chain)
}

/// Whether the agent in this directory is blocked on the user, and on what.
///
/// `Some(message)` when it is asking, `Some(None)` when it is asking without saying what, `None`
/// when it is not asking at all. Reuses `hooks::waiting_now`, which already knows the two things
/// that matter: the newest event per directory *is* the state, and an `idle_prompt` is a timer
/// noticing a quiet prompt rather than a question (rule:attention-signals).
fn waiting_here(app: &tauri::AppHandle, cwd: &str) -> Option<Option<String>> {
    use tauri::Manager;
    let data = app.path().app_data_dir().ok()?;
    let events = crate::agent::hooks::read_events(&crate::agent::hooks::events_path(&data), 200);
    let asking = crate::agent::hooks::waiting_now(events)
        .into_iter()
        .filter(|event| event.cwd == cwd)
        .find(|event| !crate::agent::hooks::is_idle(event))?;
    // An event the agent has since worked past was answered — the transcript is the finer clock
    // (`hooks::has_moved_on`), and without this a prompt answered mid-turn would sit here for the
    // rest of it.
    if crate::agent::hooks::has_moved_on(&asking, crate::agent::hooks::modified_secs) {
        return None;
    }
    Some(asking.message)
}

/// The user's home directory, through Tauri's path API rather than by assembling `$HOME`
/// (rule:rust-conventions).
fn home_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path().home_dir().ok()
}

/// How much of the subscription this tab's account has used.
///
/// **Free to ask** — measured: `total_cost_usd: 0`, `num_turns: 0`. The slash command is handled
/// inside Claude Code and never reaches a model, which is what makes it usable at all; the same
/// figures cannot be derived from the transcript, which records tokens and never limits.
///
/// Runs with the account the project declares, or the numbers would be somebody else's.
/// **`async` + `spawn_blocking`, and this one is not stylistic** (rule:rust-conventions). Tauri runs a
/// synchronous command **on the main thread**; only an `async fn` reaches the async runtime. This one
/// shells out to the `claude` CLI, measured at **1443–1629 ms** — so as a sync command it held the
/// thread that also serves window events and IPC for a second and a half.
///
/// It was visible, and it was blamed on the wrong layer: opening the Agent tool took **1562–1591 ms**
/// to show its first frame, while React rendered it in about one millisecond. The panel already
/// handles `isPending`; it simply never got the chance to paint it.
#[tauri::command]
pub async fn agent_usage(cwd: String) -> Result<Option<crate::dto::UsageSummary>> {
    tracing::debug!(%cwd, "agent_usage");
    tauri::async_runtime::spawn_blocking(move || {
        let project = std::path::Path::new(&cwd);
        let home = crate::agent::declared_home(project);
        crate::agent::usage::read(home.as_deref(), project)
    })
    .await
    .map_err(|e| AppError::Other(format!("reading the usage summary failed: {e}")))
}

/// Every tmux session currently running on this machine.
///
/// **What makes "attach" an action the user takes rather than a side effect of opening a tab.** A new
/// terminal is now genuinely new — the naming skips anything tmux already holds — so reaching a
/// session that outlived its tab has to be something you can *ask* for. This is the list you ask from.
///
/// The result is also what the boundary check accepts: a name from here may be attached to even
/// though it is outside the tab's own series (`tmux::may_name`, ADR-PROJ-001 §5).
///
/// An empty list is the ordinary answer, not a failure: no tmux installed, no server running, or
/// nothing started yet all mean the same thing to a caller.
///
/// **`async` + `spawn_blocking`** — it starts `tmux list-sessions`, and a synchronous command runs on
/// the main thread (rule:rust-conventions, `scripts/project/check-blocking-commands.mjs`).
#[tauri::command]
pub async fn tmux_sessions() -> Result<Vec<crate::dto::TmuxSession>> {
    let sessions = tauri::async_runtime::spawn_blocking(crate::terminal::tmux::sessions)
        .await
        .map_err(|e| AppError::Other(format!("listing tmux sessions failed: {e}")))?;
    tracing::debug!(count = sessions.len(), "tmux_sessions");
    Ok(sessions)
}

/// End a tmux session and everything running in it.
///
/// **The one destructive operation in this app**, and the reason it exists: closing a tab detaches
/// rather than kills — deliberately, so a build survives the window looking at it — and since a new
/// tab no longer reuses an old session, they accumulate with nothing to clear them. The confirmation
/// is the caller's job and is not optional (`ConfirmDialog`).
///
/// **`async` + `spawn_blocking`**: it starts `tmux kill-session` (rule:rust-conventions).
#[tauri::command]
pub async fn tmux_kill_session(name: String) -> Result<()> {
    tracing::info!(%name, "tmux_kill_session");
    tauri::async_runtime::spawn_blocking(move || crate::terminal::tmux::kill(&name))
        .await
        .map_err(|e| AppError::Other(format!("ending the tmux session failed: {e}")))?
}

/// Rename a tmux session.
///
/// The frontend must carry any tab that named the old session across in the same gesture: a tab left
/// pointing at a name nobody has would create an empty session under it on the next start, which is
/// exactly the defect the restore exists to prevent (ADR-PROJ-001 §5).
///
/// **`async` + `spawn_blocking`**: it starts `tmux rename-session` (rule:rust-conventions).
#[tauri::command]
pub async fn tmux_rename_session(from: String, to: String) -> Result<()> {
    tracing::info!(%from, %to, "tmux_rename_session");
    tauri::async_runtime::spawn_blocking(move || crate::terminal::tmux::rename(&from, &to))
        .await
        .map_err(|e| AppError::Other(format!("renaming the tmux session failed: {e}")))?
}

/// The clipboard's text, read in the **backend**.
///
/// **Why not `navigator.clipboard.readText()`**, which is what the webview would reach for: it is
/// permission-gated in WKWebView. Choosing Paste from the terminal's own context menu produced a
/// native confirmation the user never saw — nothing was pasted, the menu stayed open, and rendering
/// stalled until they clicked elsewhere. Reported exactly that way. A terminal that has to ask
/// permission to paste into itself is not a terminal.
///
/// macOS' ⌘V never hit this: that goes through WebKit's own paste event, which carries the text with
/// it. Only the paths that ASK for the clipboard were affected — the context menu and `Ctrl+Shift+V`.
///
/// An empty clipboard is `""`, not an error: there is nothing wrong with pasting nothing.
#[tauri::command]
pub fn clipboard_text(app: tauri::AppHandle) -> Result<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    // Sync on purpose (`scripts/project/check-blocking-commands.mjs`): this reads a pasteboard, it
    // starts no child process, and it is on the path of a keystroke the user just made.
    let text = app.clipboard().read_text().unwrap_or_default();
    tracing::debug!(chars = text.chars().count(), "clipboard_text");
    Ok(text)
}

/// Put text on the clipboard, written in the **backend**.
///
/// **The counterpart to [`clipboard_text`], and it exists for the same reason — found the hard way,
/// one call site later.** `navigator.clipboard.writeText()` is gated on a *user gesture* in WebKit,
/// and the terminal is the one surface that cannot supply one: xterm's SelectionService calls
/// `preventDefault()` on `mousedown` (the same behaviour that already killed the middle-click
/// `auxclick` handler, `TerminalSurface.tsx`), so by the time copy-on-select runs on `mouseup` the
/// activation WebKit demands is gone. The write was refused, and refused *silently* — the promise
/// never settled, so not even the failure toast appeared. Copying from a note worked the whole time,
/// because a `<button>` click is a gesture; copying from the terminal never did.
///
/// A pasteboard write asks nobody's permission, so doing it here is not a workaround for the gate —
/// it is the side of the boundary that owns the clipboard on this stack. The read has been here
/// since 0.39.6; this is the half that was left behind.
///
/// Fails if the platform clipboard refuses the write, which the caller surfaces on screen — a copy
/// that quietly did nothing is indistinguishable from one that worked (rule:logging).
#[tauri::command]
pub fn clipboard_write(app: tauri::AppHandle, text: String) -> Result<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    // Sync for the same reason as the read above: it writes a pasteboard, starts no child process,
    // and sits on the path of a gesture the user just made.
    let chars = text.chars().count();
    // No `tracing::error!` here on purpose: `Serialize for AppError` is the one chokepoint that logs
    // every error crossing IPC, and logging it twice makes the log read like two failures
    // (rule:logging).
    app.clipboard()
        .write_text(text)
        .map_err(|error| AppError::Other(format!("could not write the clipboard: {error}")))?;
    tracing::debug!(chars, "clipboard_write");
    Ok(())
}
