//! The terminal's IPC surface (ADR-PROJ-001). Thin, like every command module: validate, call the
//! registry, map the error (rule:rust-conventions).
//!
//! **No command here takes a command line.** `terminal_open` says *that* a terminal should start and
//! *where*; the program is resolved in the backend. A webview that could name the program would be a
//! webview that can run anything the user's account can — which is not the same thing as a terminal
//! the user typed into (ADR-PROJ-001 §5, rule:security).

use crate::error::Result;
use crate::terminal::{pty::Size, SessionId, TerminalRegistry};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

/// Start a terminal session and stream its output into `on_output`.
///
/// Output arrives as raw `ArrayBuffer` batches — bytes, not text, so the emulator does its own UTF-8
/// decoding and a multi-byte character split across two reads still renders. Batching happens in the
/// backend (ADR-PROJ-001 §3).
///
/// Fails if the PTY cannot be opened, the shell cannot be started, or `cwd` is not an existing
/// directory.
#[tauri::command]
pub fn terminal_open(
    app: tauri::AppHandle,
    registry: State<'_, TerminalRegistry>,
    on_output: Channel<InvokeResponseBody>,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
) -> Result<SessionId> {
    tracing::info!(rows, cols, ?cwd, "terminal_open");
    let id = registry.open(app, on_output, cwd.map(Into::into), Size { rows, cols })?;
    tracing::debug!(session = id, "terminal_open ok");
    Ok(id)
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

/// End a session because the user closed its tab.
///
/// This takes down the foreground process group, not just the shell: a build or an AI harness
/// running inside it goes with the tab instead of being orphaned (see `pty::Pty::close`).
#[tauri::command]
pub fn terminal_close(registry: State<'_, TerminalRegistry>, id: SessionId) -> Result<()> {
    tracing::info!(session = id, "terminal_close");
    registry.close(id)
}
