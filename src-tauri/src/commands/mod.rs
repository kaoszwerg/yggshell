//! Tauri command surface (typed via ts-rs DTOs). Thin layer: validate, do the work, map errors
//! (ADR-APP-001, rule:rust-conventions). Every command logs its action and its result (rule:logging).

pub mod git;
pub mod terminal;

use crate::dto::{BuildInfo, CrashReport, SettingsDto, TmuxMode};
use crate::error::{AppError, Result};
use crate::state::AppState;
use tauri::State;

/// Record a fatal error from the UI runtime (ADR-CORE-037, ADR-APP-032).
///
/// The webview is a **second entry point**: the Rust panic hook is blind to it, so a crash in the UI
/// would otherwise leave the user with a blank window and us with nothing to debug. This is the path
/// that turns it into the same durable, on-device record a Rust panic produces.
///
/// Returns the crash report's path so the fatal screen can tell the user where it is. Fails only if
/// the report could not be written — and says so, rather than pretending it was recorded.
#[tauri::command]
pub fn report_crash(report: CrashReport) -> Result<String> {
    tracing::error!(
        source = %report.source,
        message = %report.message,
        "frontend crash"
    );
    let details = format!(
        "source:  {}\nmessage: {}\n\nstack:\n{}",
        report.source,
        report.message,
        report.stack.as_deref().unwrap_or("<none>")
    );
    let path = crate::crash::write_report("ui", &details).ok_or_else(|| {
        AppError::Other("the crash report could not be written to disk".to_string())
    })?;
    tracing::info!(path = %path.display(), "frontend crash recorded");
    Ok(path.to_string_lossy().into_owned())
}

/// The crash report left behind by a previous failure, if there is one. Consumed on read.
///
/// This is the backstop for the message box: when the app dies so early that no dialog can be shown —
/// or the platform has none to show — the user still learns about it the next time they open the app.
#[tauri::command]
pub fn pending_crash() -> Option<String> {
    let pending = crate::crash::take_pending();
    match &pending {
        Some(path) => tracing::warn!(path = %path.display(), "a previous run left a crash report"),
        None => tracing::debug!("no pending crash from a previous run"),
    }
    pending.map(|p| p.to_string_lossy().into_owned())
}

/// End the process after a fatal UI error, with the exit code that says so (`EXIT_UI_CRASH`).
///
/// Invoked from the fatal screen's "Quit" button. The log file is flushed first: `app.exit` does not
/// run our destructors either, and the records describing the crash are the ones that matter most.
#[tauri::command]
pub fn exit_after_crash(app: tauri::AppHandle) {
    tracing::error!("exiting after a fatal UI error");
    crate::logging::flush();
    app.exit(crate::crash::EXIT_UI_CRASH);
}

/// App version from Cargo metadata (IPC smoke test).
#[tauri::command]
pub fn app_version() -> String {
    tracing::debug!("app_version");
    env!("CARGO_PKG_VERSION").to_string()
}

/// Build identity (version + channel + commit) — see [`BuildInfo`].
#[tauri::command]
pub fn build_info() -> BuildInfo {
    let info = BuildInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        channel: if cfg!(debug_assertions) {
            "dev"
        } else {
            "release"
        }
        .to_string(),
        debug: cfg!(debug_assertions),
        git_sha: env!("GIT_SHA").to_string(),
        git_dirty: env!("GIT_DIRTY") == "true",
        commit_date: env!("BUILD_COMMIT_DATE").to_string(),
    };
    tracing::debug!(version = %info.version, channel = %info.channel, "build_info");
    info
}

/// Recent log records (ring buffer) for the log view's initial load.
#[tauri::command]
pub fn get_recent_logs() -> Vec<crate::logging::LogRecord> {
    let records = crate::logging::recent();
    tracing::debug!(count = records.len(), "get_recent_logs");
    records
}

/// Read the persisted user settings.
#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> SettingsDto {
    let settings = state.settings.get();
    tracing::debug!(
        ui_scale = settings.ui_scale,
        minimize_to_tray = settings.minimize_to_tray,
        "get_settings"
    );
    settings
}

/// Update the persisted user settings. Omitted fields keep their current value. Toggling
/// `minimize_to_tray` installs/removes the tray icon immediately (no restart).
#[tauri::command]
pub fn update_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ui_scale: Option<f64>,
    terminal_font_size: Option<f64>,
    tmux_mode: Option<TmuxMode>,
    tmux_session: Option<String>,
    minimize_to_tray: Option<bool>,
) -> Result<SettingsDto> {
    tracing::info!(
        ?ui_scale,
        ?terminal_font_size,
        ?tmux_mode,
        ?tmux_session,
        ?minimize_to_tray,
        "update_settings"
    );
    let was_tray = state.settings.get().minimize_to_tray;
    let next = state.settings.update(
        ui_scale,
        terminal_font_size,
        tmux_mode,
        tmux_session,
        minimize_to_tray,
    )?;
    if next.minimize_to_tray != was_tray {
        crate::tray::set_enabled(&app, next.minimize_to_tray);
    }
    tracing::debug!(
        ui_scale = next.ui_scale,
        minimize_to_tray = next.minimize_to_tray,
        "update_settings ok"
    );
    Ok(next)
}

/// Open an external URL in the user's default browser. Routed through the backend so any failure
/// surfaces in our own log and on an explicit IPC error path.
///
/// Windows: drive `ShellExecuteW("open", url)` directly. The cross-platform `open` crate falls back
/// to `cmd /c start <url>`, which silently exits from a windows-subsystem binary (no console
/// attached) before the default browser handler can pick up the URL.
///
/// Other targets: the `open` crate, which uses the OS-appropriate handler (`xdg-open`, `open`).
#[tauri::command]
pub fn open_external(url: String) -> Result<()> {
    tracing::info!(%url, "open_external");
    // Whitelist: only http(s) URLs are permitted from the IPC boundary (ADR-CORE-011 path-safety).
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::Other(format!(
            "refusing to open non-http url: {url}"
        )));
    }
    open_default_handler(&url)?;
    tracing::info!(%url, "open_external dispatched");
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_default_handler(url: &str) -> Result<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb: Vec<u16> = OsStr::new("open").encode_wide().chain([0]).collect();
    let target: Vec<u16> = OsStr::new(url).encode_wide().chain([0]).collect();

    // SAFETY: ShellExecuteW is an FFI call into Shell32. `verb` and `target` are owned, NUL-terminated
    // UTF-16 buffers (built above) that outlive the call; the remaining string args are explicit null
    // pointers, which ShellExecuteW documents as valid ("no parameters"). No handle is passed (`None`).
    let h = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if (h.0 as isize) > 32 {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "ShellExecuteW failed for {url} (code {})",
            h.0 as isize
        )))
    }
}

#[cfg(not(target_os = "windows"))]
fn open_default_handler(url: &str) -> Result<()> {
    ::open::that_detached(url).map_err(|e| AppError::Other(format!("open {url}: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_info_reports_version_and_channel() {
        let info = build_info();
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(
            info.channel,
            if cfg!(debug_assertions) {
                "dev"
            } else {
                "release"
            }
        );
        assert_eq!(info.debug, cfg!(debug_assertions));
    }

    #[test]
    fn open_external_rejects_non_http_urls() {
        let err = open_external("file:///etc/passwd".to_string()).expect_err("must be rejected");
        assert!(err.to_string().contains("refusing to open non-http url"));
    }
}
