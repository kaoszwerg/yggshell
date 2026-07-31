//! Tauri command surface (typed via ts-rs DTOs). Thin layer: validate, do the work, map errors
//! (ADR-APP-001, rule:rust-conventions). Every command logs its action and its result (rule:logging).

pub mod git;
pub mod terminal;

use crate::dto::{
    BuildInfo, CrashReport, SettingsDto, ShellInfo, TerminalProfile, TerminalTheme, TmuxMode,
};
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
#[allow(clippy::too_many_arguments)] // The IPC shape: one named parameter per settable field.
pub fn update_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ui_scale: Option<f64>,
    terminal_font_size: Option<f64>,
    terminal_shell: Option<String>,
    terminal_theme: Option<String>,
    diff_theme: Option<String>,
    commit_theme: Option<String>,
    terminal_font: Option<String>,
    git_auto_fetch: Option<bool>,
    language: Option<String>,
    copy_on_select: Option<bool>,
    tmux_mode: Option<TmuxMode>,
    tmux_session: Option<String>,
    minimize_to_tray: Option<bool>,
) -> Result<SettingsDto> {
    tracing::info!(
        ?ui_scale,
        ?terminal_font_size,
        ?terminal_shell,
        ?terminal_theme,
        ?diff_theme,
        ?commit_theme,
        ?terminal_font,
        ?git_auto_fetch,
        ?language,
        ?copy_on_select,
        ?tmux_mode,
        ?tmux_session,
        ?minimize_to_tray,
        "update_settings"
    );
    let was_tray = state.settings.get().minimize_to_tray;
    let next = state.settings.update(crate::settings::SettingsPatch {
        ui_scale,
        terminal_font_size,
        terminal_shell,
        terminal_theme,
        diff_theme,
        commit_theme,
        terminal_font,
        git_auto_fetch,
        language,
        copy_on_select,
        tmux_mode,
        tmux_session,
        minimize_to_tray,
    })?;
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

/// The shells this machine offers, for Settings to choose from.
///
/// The list is the backend's, always — it is what makes "which shell to start" a *selection* rather
/// than a path the webview composes and the backend then executes (ADR-PROJ-001 §5, rule:security).
#[tauri::command]
pub fn list_shells() -> Vec<ShellInfo> {
    let offers = crate::terminal::shells::available();
    tracing::debug!(count = offers.len(), "list_shells");
    offers
        .into_iter()
        .map(|o| ShellInfo {
            path: o.path,
            name: o.name,
            is_default: o.is_default,
        })
        .collect()
}

/// Every colour scheme the user has imported or saved.
///
/// The built-in HUD palette is **not** in this list: it lives in the frontend, where colour lives
/// (rule:theming). The frontend puts it in front of these.
#[tauri::command]
pub fn list_terminal_themes(state: State<'_, AppState>) -> Vec<TerminalTheme> {
    // Bundled first, then the user's. A saved theme with the same id shadows the bundled one, which
    // is what makes "copy a shipped scheme and adjust it" work without a second mechanism.
    let mut themes = crate::theme::bundled(&state.resource_dir);
    for saved in crate::theme::list(&state.data_dir) {
        match themes.iter().position(|t| t.id == saved.id) {
            Some(at) => themes[at] = saved,
            None => themes.push(saved),
        }
    }
    themes.sort_by_key(|theme| theme.name.to_lowercase());
    tracing::debug!(count = themes.len(), "list_terminal_themes");
    themes
}

/// Import an `.itermcolors` file the user dropped on the window, and store it.
///
/// The path is a path from outside — the webview hands it over, even though a drop produced it — so
/// the extension and the size are checked before anything is read, and the document is parsed by a
/// reader that resolves no entities and follows no DTD (`theme::itermcolors`).
#[tauri::command]
pub fn import_terminal_theme(state: State<'_, AppState>, path: String) -> Result<TerminalTheme> {
    tracing::info!(%path, "import_terminal_theme");
    let theme = crate::theme::import(std::path::Path::new(&path))?;
    let stored = crate::theme::save(&state.data_dir, &theme)?;
    tracing::info!(id = %stored.id, "import_terminal_theme ok");
    Ok(stored)
}

/// Store a theme the user edited. The id is derived from the name here, never taken from the caller.
#[tauri::command]
pub fn save_terminal_theme(
    state: State<'_, AppState>,
    theme: TerminalTheme,
) -> Result<TerminalTheme> {
    tracing::info!(name = %theme.name, "save_terminal_theme");
    crate::theme::save(&state.data_dir, &theme)
}

/// Delete a stored theme. Deleting one that is not there is not a failure.
#[tauri::command]
pub fn delete_terminal_theme(state: State<'_, AppState>, id: String) -> Result<()> {
    tracing::info!(%id, "delete_terminal_theme");
    crate::theme::remove(&state.data_dir, &id)
}

/// Every terminal profile the user has saved.
#[tauri::command]
pub fn list_terminal_profiles(state: State<'_, AppState>) -> Vec<TerminalProfile> {
    let profiles = crate::profile::list(&state.data_dir);
    tracing::debug!(count = profiles.len(), "list_terminal_profiles");
    profiles
}

/// Store a profile. Its id is derived from its name here, and the shell it names is checked against
/// the list this machine offers — a profile must not be a way around that check (ADR-PROJ-001 §5).
#[tauri::command]
pub fn save_terminal_profile(
    state: State<'_, AppState>,
    profile: TerminalProfile,
) -> Result<TerminalProfile> {
    tracing::info!(name = %profile.name, "save_terminal_profile");
    crate::profile::save(&state.data_dir, &profile)
}

/// Delete a profile. Deleting one that is not there is not a failure.
#[tauri::command]
pub fn delete_terminal_profile(state: State<'_, AppState>, id: String) -> Result<()> {
    tracing::info!(%id, "delete_terminal_profile");
    crate::profile::remove(&state.data_dir, &id)
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
