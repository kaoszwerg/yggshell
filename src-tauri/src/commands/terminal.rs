//! The terminal's IPC surface (ADR-PROJ-001). Thin, like every command module: validate, call the
//! registry, map the error (rule:rust-conventions).
//!
//! **No command here takes a command line.** `terminal_open` says *that* a terminal should start and
//! *where*; the program is resolved in the backend. A webview that could name the program would be a
//! webview that can run anything the user's account can — which is not the same thing as a terminal
//! the user typed into (ADR-PROJ-001 §5, rule:security).

use crate::error::Result;
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
) -> Result<crate::dto::TerminalOpened> {
    let plain = plain.unwrap_or(false);
    tracing::info!(rows, cols, ?cwd, ?profile, plain, "terminal_open");
    // tmux and the shell are persisted PREFERENCES, not something the webview may choose per call.
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
    id: SessionId,
) -> Result<crate::dto::TerminalStatus> {
    registry.status(id)
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

/// The user's home directory, through Tauri's path API rather than by assembling `$HOME`
/// (rule:rust-conventions).
fn home_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path().home_dir().ok()
}
