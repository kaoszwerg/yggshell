//! The pseudo-terminal itself — and the **only** file in this crate permitted to name
//! `portable_pty` (ADR-PROJ-001 §2).
//!
//! Everything above this module speaks the types declared here. That is not decoration: it is what
//! keeps the crate choice reversible. If `portable-pty` has to go, it costs this one file (roughly
//! 150 lines of `rustix` on Unix), not a rewrite. The three tripwires that would force that
//! re-evaluation are named in the ADR.

use crate::error::{AppError, Result};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty};
use std::io::{Read, Write};
use std::path::Path;

/// Terminal geometry, in character cells. Pixel dimensions are not carried: nothing in this app
/// reports them, and a wrong value is worse than an absent one for programs that check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Size {
    pub rows: u16,
    pub cols: u16,
}

impl Size {
    /// Clamps to something a kernel will accept. A zero dimension is what a webview reports while it
    /// is still laying out, and passing it through makes the child believe it has no screen.
    fn sane(self) -> Self {
        Self {
            rows: self.rows.max(1),
            cols: self.cols.max(1),
        }
    }
}

/// The readable half of a PTY. Handed to the reader thread and read until EOF.
pub type Output = Box<dyn Read + Send>;

/// A live PTY and the handles needed to drive it from the session registry.
pub struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// Waits for the child to exit. Owned by the reader thread, which is the one that learns about EOF
/// first and is therefore the right place to report the exit status from.
pub struct Wait(Box<dyn portable_pty::Child + Send + Sync>);

/// Everything [`spawn`] hands back: the PTY, its output stream, the exit waiter, and the program
/// that was actually started — which is logged, because "a shell" is not an answer when a session
/// fails to come up.
pub struct Spawned {
    pub pty: Pty,
    pub output: Output,
    pub wait: Wait,
    pub program: String,
}

impl Wait {
    /// Blocks until the child exits. `None` if the status could not be read at all.
    pub fn wait(mut self) -> Option<u32> {
        match self.0.wait() {
            Ok(status) => Some(status.exit_code()),
            Err(e) => {
                tracing::warn!(error = %e, "could not read the terminal child's exit status");
                None
            }
        }
    }
}

impl Pty {
    /// Send input (keystrokes, paste) to the child.
    pub fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.writer
            .write_all(bytes)
            .and_then(|()| self.writer.flush())
            .map_err(|e| AppError::io("terminal input", e))
    }

    /// Tell the kernel the window changed, which makes it signal the child (`SIGWINCH` on Unix).
    pub fn resize(&self, size: Size) -> Result<()> {
        let size = size.sane();
        self.master
            .resize(portable_pty::PtySize {
                rows: size.rows,
                cols: size.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Other(format!("terminal resize: {e}")))
    }

    /// The size the **kernel** currently believes this PTY has. Read back rather than remembered,
    /// so a resize that never reached the ioctl cannot look like one that did.
    pub fn size(&self) -> Result<Size> {
        self.master
            .get_size()
            .map(|s| Size {
                rows: s.rows,
                cols: s.cols,
            })
            .map_err(|e| AppError::Other(format!("terminal get_size: {e}")))
    }

    /// End the session.
    ///
    /// Two things happen, and both matter. The child is killed directly, and the master is dropped —
    /// which is what reaches the rest of the tree: closing the controlling terminal makes the kernel
    /// send `SIGHUP` to the foreground process **group**, so a build, a test runner or an AI harness
    /// started inside the shell goes down with it instead of being orphaned. Killing the shell alone
    /// would leave them running with no terminal to report to.
    pub fn close(mut self) {
        if let Err(e) = self.killer.kill() {
            // Already gone is the common case, and it is not a failure worth surfacing.
            tracing::debug!(error = %e, "terminal child was already gone when closed");
        }
        drop(self.writer);
        drop(self.master);
    }
}

/// Start a shell on a fresh PTY.
///
/// **The program is chosen here, never by the caller and never by the webview** (ADR-PROJ-001 §5).
/// A terminal runs arbitrary code as the user — that is its purpose — but the webview must not be
/// able to decide *what* is started, so no command line crosses the IPC boundary.
pub fn spawn(cwd: Option<&Path>, size: Size) -> Result<Spawned> {
    let size = size.sane();
    let pair = native_pty_system()
        .openpty(portable_pty::PtySize {
            rows: size.rows,
            cols: size.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Other(format!("openpty: {e}")))?;

    let program = default_shell();
    let mut cmd = CommandBuilder::new(&program);
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    // What the child is talking to. Without TERM a great many programs fall back to a dumb terminal
    // and stop emitting the sequences the emulator exists to render.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", env!("CARGO_PKG_NAME"));
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::Other(format!("spawn {program}: {e}")))?;
    // The slave is the child's end. Held open here it would keep the PTY alive after the child dies,
    // and the reader would never see EOF — the session would look alive forever.
    drop(pair.slave);

    let output = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Other(format!("terminal reader: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::Other(format!("terminal writer: {e}")))?;
    let killer = child.clone_killer();

    Ok(Spawned {
        pty: Pty {
            master: pair.master,
            writer,
            killer,
        },
        output,
        wait: Wait(child),
        program,
    })
}

/// The user's shell, resolved in the backend.
///
/// Read from the environment rather than taken from `CommandBuilder::new_default_prog()` so the
/// resolved program can be *logged*: "a session failed to start" is not actionable, "`/bin/fish`
/// failed to start" is.
fn default_shell() -> String {
    #[cfg(windows)]
    let (var, fallback) = ("COMSPEC", "cmd.exe");
    #[cfg(not(windows))]
    let (var, fallback) = ("SHELL", "/bin/sh");

    std::env::var(var)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_zero_dimension_never_reaches_the_kernel() {
        // A webview reports 0x0 while it is still laying out. Passed through, the child believes it
        // has no screen and formats its output for one.
        let sane = Size { rows: 0, cols: 0 }.sane();
        assert_eq!(sane, Size { rows: 1, cols: 1 });
    }

    #[test]
    fn a_real_size_is_left_alone() {
        let size = Size {
            rows: 40,
            cols: 120,
        };
        assert_eq!(size.sane(), size);
    }

    #[test]
    fn the_shell_comes_from_the_environment_with_a_fallback() {
        // Not asserting *which* shell — that is the developer's environment. Asserting that one is
        // always resolved, because an empty program is a spawn failure with no useful message.
        let shell = default_shell();
        assert!(!shell.trim().is_empty(), "a program must always be chosen");
    }

    #[test]
    fn a_session_starts_echoes_and_exits() {
        let spawned = spawn(None, Size { rows: 24, cols: 80 }).expect("spawn");
        let Spawned {
            mut pty,
            mut output,
            wait,
            program,
        } = spawned;
        assert!(!program.is_empty());

        // `exit` is understood by every shell this resolves to, on every platform.
        pty.write(b"exit\r\n").expect("write");

        let mut seen = Vec::new();
        let mut buf = [0u8; 4096];
        // Read to EOF: the child exits, the slave closes, the reader ends. If this hangs, the drop
        // of `pair.slave` in `spawn` was lost — which is the bug this test really guards.
        while let Ok(n) = output.read(&mut buf) {
            if n == 0 {
                break;
            }
            seen.extend_from_slice(&buf[..n]);
        }
        assert!(!seen.is_empty(), "a shell on a tty always echoes something");

        wait.wait();
        pty.close();
    }

    #[test]
    fn resize_reaches_the_kernel() {
        // Deliberately does NOT wait for the child: nothing drains the output here, so a shell that
        // kept printing would fill the PTY buffer and block forever — which is exactly how the first
        // version of this test hung. In production the reader thread always drains.
        let Spawned { pty, .. } = spawn(None, Size { rows: 24, cols: 80 }).expect("spawn");

        pty.resize(Size {
            rows: 50,
            cols: 200,
        })
        .expect("resize");

        // Read back from the kernel, not from our own struct: the assertion is that the ioctl
        // happened, not that we remembered what we were asked for.
        assert_eq!(
            pty.size().expect("get_size"),
            Size {
                rows: 50,
                cols: 200
            }
        );
        pty.close();
    }
}
