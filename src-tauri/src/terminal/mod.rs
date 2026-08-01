//! Terminal sessions: the registry the backend owns, and the two threads that move a session's
//! output to the webview (ADR-PROJ-001).
//!
//! **The backend owns the sessions.** The frontend holds an id and its own view state — tab order,
//! which tab is in front — and nothing else. A session outlives every render.

pub mod attached;
pub mod environment;
pub mod pty;
pub mod shell_integration;
pub mod shells;
pub mod tmux;

use crate::dto::TerminalExit;
use crate::error::{AppError, Result};
use pty::{Pty, Size};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

/// Identifies one session. A counter, not a UUID: it never leaves the process, and a dependency for
/// something an integer already does would not survive rule:dependencies. `u32` rather than `u64`
/// because ts-rs maps the latter to `bigint`, which no caller here wants to handle.
pub type SessionId = u32;

/// The event the frontend listens on to learn a session ended by itself (the user typed `exit`, the
/// shell died). Closing a tab is the other direction and needs no event.
pub const EXIT_EVENT: &str = "terminal://exit";

/// Flush when this much output has piled up …
const FLUSH_BYTES: usize = 64 * 1024;
/// … or when this long has passed since the last flush, whichever comes first. Roughly half a frame
/// at 60 Hz: below what an eye resolves, far above the per-read rate that makes the IPC the
/// bottleneck.
const FLUSH_INTERVAL: Duration = Duration::from_millis(8);
/// One read from the PTY. Measured at ~1 KB per read on macOS, so this is generous on purpose —
/// a larger buffer costs nothing and takes syscalls out of a flood.
const READ_BUFFER: usize = 64 * 1024;

/// What the reader thread hands to the pump thread.
enum Pumped {
    Data(Vec<u8>),
    /// The child is gone; the exit code if it could be read.
    Ended(Option<u32>),
}

/// Batches PTY output into IPC-sized messages.
///
/// **Not an optimisation — a requirement** (ADR-PROJ-001 §3). The PTY delivers roughly a kilobyte per
/// read; forwarding each one would put 68 000 messages on the IPC for a single `cat` of a 67 MB file.
/// Measured, not estimated: 69 905 070 bytes arrived in 68 267 reads.
struct Coalescer {
    pending: Vec<u8>,
    last_flush: Instant,
}

impl Coalescer {
    fn new(now: Instant) -> Self {
        Self {
            pending: Vec::with_capacity(FLUSH_BYTES),
            last_flush: now,
        }
    }

    /// Take a chunk. Returns a batch to send when one is due.
    fn push(&mut self, chunk: &[u8], now: Instant) -> Option<Vec<u8>> {
        self.pending.extend_from_slice(chunk);
        if self.pending.len() >= FLUSH_BYTES {
            return self.take(now);
        }
        None
    }

    /// Everything held so far, if there is any. Called on the idle tick and at the end of a session,
    /// which is what stops a short burst — a prompt — from sitting in the buffer until the next
    /// keystroke happens to arrive.
    fn take(&mut self, now: Instant) -> Option<Vec<u8>> {
        if self.pending.is_empty() {
            return None;
        }
        self.last_flush = now;
        Some(std::mem::take(&mut self.pending))
    }
}

/// One live session as the registry sees it.
struct Session {
    pty: Pty,
    /// The tmux session this joined, if any. Inside tmux the working directory and the running
    /// command are both read back from tmux rather than from the shell — see
    /// [`TerminalRegistry::status`].
    tmux_session: Option<String>,
    /// The program this session started, kept so "is something running" can be answered: tmux names
    /// the shell itself when a prompt is waiting, and the only way to know that is to know its name.
    shell: String,
    /// The child's process id, when the platform reported one.
    ///
    /// Kept so the activity tool can walk what this tab is running. Outside tmux that child IS the
    /// tab's shell and everything hangs off it; inside tmux it is only the client, which is why the
    /// tool asks tmux for the pane pids instead (`procs`).
    #[allow(
        dead_code,
        reason = "read through `activity`; kept as the session's own identity"
    )]
    pid: Option<u32>,
    /// The terminal device this session's shell runs on, when it could be determined.
    ///
    /// Looked up ONCE, when the session opens, because it never changes and `ps` is a process. It is
    /// what lets the status poll notice a tmux session the **user** started by typing `tmux` — that
    /// one has no name we were told, and a client on this tty is by definition this tab's
    /// (`terminal::attached`).
    tty: Option<String>,
}

/// Every live terminal in this process. Managed by Tauri, so a command reaches it as `State`.
#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Mutex<HashMap<SessionId, Session>>,
    next_id: AtomicU32,
}

/// What a new session should be.
///
/// A struct rather than five more parameters: what a terminal starts as has grown from "a shell" to a
/// shell, a directory, a profile, a colour scheme and whether tmux is bypassed — and a call site
/// reading `open(app, ch, None, size, &s, None, false)` says nothing about which `false` that is.
pub struct Open<'a> {
    /// Where to start, when the caller asked for somewhere specific. A profile's directory wins.
    pub cwd: Option<PathBuf>,
    pub size: Size,
    pub settings: &'a crate::dto::SettingsDto,
    pub profile: Option<&'a crate::dto::TerminalProfile>,
    /// Start a plain shell whatever the tmux setting says. Used when a tab drops out of tmux: a
    /// detach means "put me back in a terminal", not "close the window".
    pub plain: bool,
    /// The tmux session a **restored** tab was in when the app last stopped.
    ///
    /// The one thing that makes tmux's survival reachable rather than merely true: the sessions live
    /// through a crash on their own, but a tab that returns only *numbered* can land in a different
    /// one and leave the session holding the build orphaned. Constrained to the configured series
    /// before it is used — the caller restores a name, it does not choose one ([`tmux::launch`]).
    pub tmux_session: Option<String>,
}

impl TerminalRegistry {
    /// Start a session and stream its output into `output`.
    ///
    /// `cwd` is the only thing the caller may influence freely, and it is validated before it is
    /// used. Everything about *what runs* — the shell, whether tmux wraps it — comes from the
    /// persisted settings, never from the call: the webview may say that a terminal should start and
    /// where, never what it should be (ADR-PROJ-001 §5).
    ///
    /// `tmux_session` is the one narrow exception, and it is a **restore, not a choice**: it may only
    /// name a session in the series the settings define, so the caller can hand back a name this
    /// backend minted for it and nothing else. Without it a tab restored after a crash is numbered by
    /// position rather than identity, and lands in the wrong session as soon as the tab count changed
    /// (`tmux::in_series`).
    pub fn open(
        &self,
        app: AppHandle,
        output: Channel<InvokeResponseBody>,
        request: Open<'_>,
    ) -> Result<crate::dto::TerminalOpened> {
        let Open {
            cwd,
            size,
            settings,
            profile,
            plain,
            tmux_session,
        } = request;
        // Both kinds of starting directory are PREFERENCES, and a stale one is never a reason to
        // refuse a terminal.
        //
        // The profile's is obviously that. The one on the call is too, now that the caller who sends
        // it is a restored tab: a project moved or deleted between two runs must not leave the user
        // staring at an error instead of a shell. Both are validated, and a failure is logged and
        // dropped rather than propagated — same as a profile that no longer exists.
        let preferred = profile
            .and_then(|p| p.cwd.clone())
            .map(PathBuf::from)
            .or(cwd);
        let cwd = match preferred {
            None => None,
            Some(path) => match validate_cwd(Some(path.clone())) {
                Ok(valid) => valid,
                Err(error) => {
                    tracing::warn!(
                        path = %path.display(),
                        %error,
                        "the requested starting directory is not usable — starting where the shell would"
                    );
                    None
                }
            },
        };
        // What actually runs: the shell, or tmux wrapping it. Decided here rather than in `pty`, so
        // that module stays about pseudo-terminals and nothing else.
        //
        // The preference is re-checked here and not merely when it was stored: a shell can be
        // uninstalled between the two, and settings.json is an ordinary file (rule:security — the
        // boundary validates, it does not trust that someone upstream did).
        // The profile's shell if it names one, the Settings default otherwise — and `resolve` checks
        // whichever it gets against what this machine actually offers.
        let shell = shells::resolve(
            profile
                .and_then(|p| p.shell.as_deref())
                .unwrap_or(&settings.terminal_shell),
        );
        // Which tmux sessions this app's other tabs already hold. Two tabs on one session share one
        // view of it, so a new tab must not land on a session that is already being shown.
        let taken: Vec<String> = {
            let sessions = self.sessions.lock().map_err(poisoned)?;
            sessions
                .values()
                .filter_map(|session| session.tmux_session.clone())
                .collect()
        };
        let launch = tmux::launch(
            tmux::effective_mode(plain, profile, settings.tmux_mode),
            &settings.tmux_session,
            &shell,
            &taken,
            tmux_session.as_deref(),
        );
        let kind = launch.kind;
        let spawned = pty::spawn(pty::Spawn {
            program: &launch.program,
            args: &launch.args,
            kind,
            cwd: cwd.as_deref(),
            size,
        })?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);

        tracing::info!(
            session = id,
            program = %spawned.program,
            ?kind,
            rows = size.rows,
            cols = size.cols,
            cwd = %cwd.as_deref().map_or("<inherited>".into(), |p| p.display().to_string()),
            "terminal session opened"
        );

        let (tx, rx) = mpsc::channel::<Pumped>();
        let mut reader = spawned.output;
        let wait = spawned.wait;

        // Reader thread. Dies on EOF from the PTY — the only normal end — or on a read error, which
        // it logs first. Either way it reports the child's exit code downstream before it returns,
        // so the pump below always learns that the session is over (rule:crash-handling).
        std::thread::spawn(move || {
            use std::io::Read;
            let mut buf = vec![0u8; READ_BUFFER];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.send(Pumped::Data(buf[..n].to_vec())).is_err() {
                            // The pump is gone, which happens when the session was closed. Nothing
                            // is left to read for.
                            tracing::debug!(session = id, "terminal reader stopped: pump is gone");
                            return;
                        }
                    }
                    Err(e) => {
                        // On close the fd is torn out from under this read. That is expected, not a
                        // failure, so it is logged at debug rather than as an error.
                        tracing::debug!(session = id, error = %e, "terminal read ended");
                        break;
                    }
                }
            }
            let code = wait.wait();
            let _ = tx.send(Pumped::Ended(code));
        });

        // Pump thread. Owns the batching, and is the LAST thread of a session to end, which is why it
        // is the one that announces the exit: the final bytes are flushed before the UI is told the
        // session is over. Dies when the reader reports the end, or when the channel disconnects.
        let pump_app = app.clone();
        std::thread::spawn(move || {
            let mut coalescer = Coalescer::new(Instant::now());
            let mut sent: u64 = 0;
            let send = |batch: Vec<u8>, sent: &mut u64| -> bool {
                let len = batch.len() as u64;
                match output.send(InvokeResponseBody::Raw(batch)) {
                    Ok(()) => {
                        *sent += len;
                        true
                    }
                    Err(e) => {
                        // The webview is gone (reload, window closed). Not an error worth shouting
                        // about, but never silent either.
                        tracing::debug!(session = id, error = %e, "terminal output channel closed");
                        false
                    }
                }
            };

            let code = loop {
                match rx.recv_timeout(FLUSH_INTERVAL) {
                    Ok(Pumped::Data(chunk)) => {
                        if let Some(batch) = coalescer.push(&chunk, Instant::now()) {
                            if !send(batch, &mut sent) {
                                break None;
                            }
                        }
                    }
                    Ok(Pumped::Ended(code)) => break code,
                    Err(RecvTimeoutError::Timeout) => {
                        if let Some(batch) = coalescer.take(Instant::now()) {
                            if !send(batch, &mut sent) {
                                break None;
                            }
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break None,
                }
            };

            if let Some(batch) = coalescer.take(Instant::now()) {
                send(batch, &mut sent);
            }

            // Byte counts, never bytes: terminal content is user content and routinely holds
            // credentials (rule:logging, ADR-CORE-011).
            tracing::info!(
                session = id,
                ?code,
                bytes_out = sent,
                "terminal session ended"
            );
            if let Err(e) = pump_app.emit(
                EXIT_EVENT,
                TerminalExit {
                    id,
                    code,
                    tmux_client: kind == pty::SessionKind::TmuxClient,
                },
            ) {
                tracing::warn!(session = id, error = %e, "could not announce the terminal exit");
            }
            if let Some(state) = registry_of(&pump_app) {
                state.forget(id);
            }
        });

        // Looked up once, here, rather than on the status timer: the device never changes, and this
        // is a process spawn. `None` when the platform will not say — the feature it enables is then
        // simply absent, which is the honest outcome (rule:cross-platform).
        let tty = spawned.pid.and_then(attached::tty_of);

        // Remembered so the app can detach it however it ends — including a crash, which never runs
        // `close()` (tmux::detach_all). A session lost to an accidental quit is unrecoverable work.
        if launch.tmux_session.is_some() {
            if let Some(device) = tty.as_deref() {
                tmux::remember(device);
            }
        }

        let tmux_session = launch.tmux_session.clone();
        self.sessions.lock().map_err(poisoned)?.insert(
            id,
            Session {
                pty: spawned.pty,
                tmux_session: launch.tmux_session,
                shell: shell.clone(),
                pid: spawned.pid,
                tty,
            },
        );
        // The tmux session travels back with the id: a tab that knows which session it landed on can
        // return to the same work after a restart, which is the only kind of session this app can
        // truly restore.
        Ok(crate::dto::TerminalOpened { id, tmux_session })
    }

    /// Send input to a session.
    pub fn write(&self, id: SessionId, bytes: &[u8]) -> Result<()> {
        let mut sessions = self.sessions.lock().map_err(poisoned)?;
        let session = sessions.get_mut(&id).ok_or_else(|| unknown(id))?;
        session.pty.write(bytes)
    }

    /// Tell a session its window changed.
    pub fn resize(&self, id: SessionId, size: Size) -> Result<()> {
        let sessions = self.sessions.lock().map_err(poisoned)?;
        let session = sessions.get(&id).ok_or_else(|| unknown(id))?;
        session.pty.resize(size)?;
        tracing::debug!(
            session = id,
            rows = size.rows,
            cols = size.cols,
            "terminal resized"
        );
        Ok(())
    }

    /// End a session on purpose (the user closed the tab).
    pub fn close(&self, id: SessionId) -> Result<()> {
        let session = self
            .sessions
            .lock()
            .map_err(poisoned)?
            .remove(&id)
            .ok_or_else(|| unknown(id))?;
        // BEFORE the PTY goes: a tmux client that merely loses its terminal takes the session with
        // it — measured against a real server, and the reason this call exists at all
        // (tmux::detach_client). Closing a tab must never destroy work.
        if session.tmux_session.is_some() {
            if let Some(device) = session.tty.as_deref() {
                tmux::detach_client(device);
                tmux::forget(device);
            }
        }
        session.pty.close();
        tracing::info!(session = id, "terminal session closed");
        Ok(())
    }

    /// What this tab is running, and what it is listening on.
    ///
    /// **The roots differ inside tmux**, which is the whole difficulty: a tab attached to tmux has
    /// one child — the client — while the work runs under the tmux server, which is nobody's child.
    /// So tmux is asked for its pane pids and those become the roots. Outside tmux the tab's own
    /// child is the root and everything hangs off it.
    pub fn activity(&self, id: SessionId) -> Result<crate::dto::TerminalActivity> {
        let (session_name, pid) = {
            let sessions = self.sessions.lock().map_err(poisoned)?;
            match sessions.get(&id) {
                // A poll can outlive the tab it was polling for. Not an error, just nothing to show.
                None => {
                    return Ok(crate::dto::TerminalActivity {
                        processes: Vec::new(),
                        ports: Vec::new(),
                        via_tmux: false,
                    })
                }
                Some(session) => (session.tmux_session.clone(), session.pid),
            }
        };

        let (roots, via_tmux) = match session_name.as_deref() {
            Some(name) => match tmux::pane_pids(name) {
                pids if !pids.is_empty() => (pids, true),
                // Attached to tmux but it would not say: fall back to our own child rather than
                // showing nothing. One line reading "tmux" is still true.
                _ => (pid.into_iter().collect(), false),
            },
            None => (pid.into_iter().collect(), false),
        };

        let processes = crate::procs::tree(&roots);
        let pids: Vec<u32> = processes.iter().map(|p| p.pid).collect();
        let ports = crate::procs::listening(&pids);
        tracing::debug!(
            session = id,
            processes = processes.len(),
            ports = ports.len(),
            via_tmux,
            "read a tab's activity"
        );
        Ok(crate::dto::TerminalActivity {
            processes,
            ports,
            via_tmux,
        })
    }

    /// Where this session's shell currently is, when the backend can answer it.
    ///
    /// Only meaningful inside tmux. A shell we started reports its own directory over OSC 7, which is
    /// instant and needs no polling; a shell that was already running in a tmux session we merely
    /// joined has no hook in it and never will, so tmux — which tracks `pane_current_path` itself — is
    /// asked instead. `None` for an ordinary shell session means exactly "the frontend already knows
    /// better than I do".
    pub fn status(&self, id: SessionId) -> Result<crate::dto::TerminalStatus> {
        // The name is copied out and the lock released before tmux is asked: that call spawns a
        // process, and holding the registry lock across it would stall every keystroke in every other
        // terminal for as long as it takes.
        let (name, shell, tty) = {
            let sessions = self.sessions.lock().map_err(poisoned)?;
            match sessions.get(&id) {
                // Not an error: a poll can outlive the tab it was polling for.
                None => {
                    return Ok(crate::dto::TerminalStatus {
                        cwd: None,
                        command: None,
                        session: None,
                        busy: false,
                    })
                }
                Some(session) => (
                    session.tmux_session.clone(),
                    session.shell.clone(),
                    session.tty.clone(),
                ),
            }
        };

        // The session we started, or — when we started none — one the USER started by typing `tmux`
        // in this very shell. The second case was invisible until now: nothing tells the app it
        // happened, so the status bar showed nothing for somebody sitting in tmux.
        let name = match name {
            Some(name) => Some(name),
            None => tty.as_deref().and_then(attached::session_on_tty),
        };

        let Some(name) = name else {
            // Outside tmux there is nothing to poll for: OSC 7 and OSC 133 both reach the emulator
            // directly, instantly, and with more detail than a poll could give.
            return Ok(crate::dto::TerminalStatus {
                cwd: None,
                command: None,
                session: None,
                busy: false,
            });
        };

        let command = tmux::pane_command(&name);
        // "Busy" is "running something other than the shell". tmux reports the shell's own name when
        // a prompt is waiting, and the comparison is on the FILE NAME because tmux gives `zsh` where
        // the session was started from `/bin/zsh`.
        let shell_name = std::path::Path::new(&shell)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or(shell);
        let busy = command
            .as_deref()
            .is_some_and(|c| c != shell_name && !c.is_empty());

        Ok(crate::dto::TerminalStatus {
            cwd: tmux::pane_cwd(&name),
            command,
            session: Some(name),
            busy,
        })
    }

    /// Drop a session that ended by itself. Never an error: the tab may already have been closed.
    fn forget(&self, id: SessionId) {
        match self.sessions.lock() {
            Ok(mut sessions) => {
                sessions.remove(&id);
            }
            Err(e) => tracing::error!(session = id, error = %e, "terminal registry lock poisoned"),
        }
    }

    /// How many sessions are live. Used by the tests and by the shutdown path.
    pub fn len(&self) -> usize {
        self.sessions.lock().map(|s| s.len()).unwrap_or(0)
    }

    /// Whether no session is live.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

fn registry_of(app: &AppHandle) -> Option<tauri::State<'_, TerminalRegistry>> {
    use tauri::Manager;
    app.try_state::<TerminalRegistry>()
}

fn unknown(id: SessionId) -> AppError {
    AppError::Other(format!("no terminal session {id}"))
}

fn poisoned<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Other(format!("terminal registry lock poisoned: {e}"))
}

/// Validate a working directory that came from the webview.
///
/// Canonicalised and required to be an existing directory (rule:security — every boundary validates
/// its own input). A path that does not resolve is rejected rather than quietly ignored: silently
/// starting somewhere else is how a user ends up running a command in the wrong repository.
fn validate_cwd(cwd: Option<PathBuf>) -> Result<Option<PathBuf>> {
    let Some(path) = cwd else { return Ok(None) };
    let resolved = path
        .canonicalize()
        .map_err(|e| AppError::io(path.display().to_string(), e))?;
    if !resolved.is_dir() {
        return Err(AppError::Other(format!(
            "not a directory: {}",
            resolved.display()
        )));
    }
    Ok(Some(resolved))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_burst_is_held_until_the_idle_tick() {
        // A prompt is a few dozen bytes. It must not sit in the buffer waiting for 64 KiB that will
        // never come — the idle tick is what releases it.
        let now = Instant::now();
        let mut c = Coalescer::new(now);
        assert!(c.push(b"$ ", now).is_none(), "too small to flush on size");
        assert_eq!(c.take(now).as_deref(), Some(&b"$ "[..]));
    }

    #[test]
    fn a_flood_flushes_on_size_and_keeps_order() {
        let now = Instant::now();
        let mut c = Coalescer::new(now);
        let chunk = vec![b'x'; FLUSH_BYTES / 2];

        assert!(c.push(&chunk, now).is_none(), "half a batch waits");
        let batch = c.push(&chunk, now).expect("the second half completes it");
        assert_eq!(batch.len(), FLUSH_BYTES);
        assert!(batch.iter().all(|b| *b == b'x'));
        assert!(c.take(now).is_none(), "nothing is left behind");
    }

    #[test]
    fn an_idle_tick_on_an_empty_buffer_sends_nothing() {
        // Otherwise every idle terminal would emit an empty IPC message 125 times a second.
        let now = Instant::now();
        let mut c = Coalescer::new(now);
        assert!(c.take(now).is_none());
    }

    #[test]
    fn batches_concatenate_in_order() {
        let now = Instant::now();
        let mut c = Coalescer::new(now);
        c.push(b"one", now);
        c.push(b"two", now);
        assert_eq!(c.take(now).as_deref(), Some(&b"onetwo"[..]));
    }

    #[test]
    fn a_missing_working_directory_is_rejected_not_ignored() {
        let err = validate_cwd(Some(PathBuf::from("/definitely/not/here")))
            .expect_err("must be rejected");
        assert!(err.to_string().contains("io error"));
    }

    #[test]
    fn a_file_is_not_a_working_directory() {
        let file = tempfile::NamedTempFile::new().expect("tempfile");
        let err = validate_cwd(Some(file.path().to_path_buf())).expect_err("must be rejected");
        assert!(err.to_string().contains("not a directory"));
    }

    #[test]
    fn an_existing_directory_is_canonicalised() {
        let dir = tempfile::tempdir().expect("tempdir");
        let resolved = validate_cwd(Some(dir.path().to_path_buf())).expect("accepted");
        assert_eq!(
            resolved,
            Some(dir.path().canonicalize().expect("canonicalize"))
        );
    }

    #[test]
    fn no_working_directory_means_inherit() {
        assert_eq!(validate_cwd(None).expect("accepted"), None);
    }

    #[test]
    fn an_unknown_session_is_an_error_on_every_operation() {
        let registry = TerminalRegistry::default();
        assert!(registry.is_empty());
        assert!(registry.write(42, b"x").is_err());
        assert!(registry.resize(42, Size { rows: 1, cols: 1 }).is_err());
        assert!(registry.close(42).is_err());
        // Forgetting a session that was never there is deliberately not an error: the tab may have
        // been closed a moment before the child exited.
        registry.forget(42);
    }
}
