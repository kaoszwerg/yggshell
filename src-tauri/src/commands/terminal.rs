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

/// Where a session's shell currently is, when the backend can answer it (inside tmux).
///
/// `null` for an ordinary shell — there the frontend already has the answer from OSC 7, instantly and
/// without polling anything.
#[tauri::command]
pub fn terminal_cwd(
    registry: State<'_, TerminalRegistry>,
    id: SessionId,
) -> Result<Option<String>> {
    registry.cwd(id)
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
