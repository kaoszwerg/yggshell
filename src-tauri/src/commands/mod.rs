//! Tauri command surface (typed via ts-rs DTOs). Thin layer: validate, do the work, map errors
//! (ADR-APP-001, rule:rust-conventions). Every command logs its action and its result (rule:logging).

pub mod git;
pub mod terminal;

use crate::dto::{
    BuildInfo, CrashReport, SettingsDto, ShellInfo, TerminalProfile, TerminalTheme, TmuxMode,
};
use crate::error::{AppError, Result};
use crate::state::AppState;
use tauri::{Manager, State};

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

/// The licence notices of everything bundled with the app.
///
/// **This is a licence obligation, not a courtesy.** Every ported colour scheme is MIT, and MIT
/// requires the copyright notice to travel with the copy. The schemes shipped inside the app while
/// `CREDITS.md` stayed in the repository — so the notice did not travel, and the requirement was not
/// met by an installed build.
///
/// Embedded with `include_str!` rather than resolved as a resource at runtime: a notice that can go
/// missing because a path was wrong is a notice that will go missing.
#[tauri::command]
pub fn bundled_credits() -> String {
    include_str!("../../resources/themes/CREDITS.md").to_string()
}

/// How busy the machine is, for the status bar.
///
/// `None` where the platform has no load average — Windows does not have one, and a zero there would
/// read as a perfectly idle machine (rule:cross-platform).
#[tauri::command]
pub fn system_load() -> Option<crate::sysload::SystemLoad> {
    crate::sysload::read()
}

/// What changed, release by release.
///
/// **Embedded, like the licence notices.** A changelog that lives only in the repository answers the
/// question for people who read the repository — which is not who is looking at an app wondering
/// what the update they just installed actually did.
#[tauri::command]
pub fn changelog() -> String {
    include_str!("../../../CHANGELOG.md").to_string()
}

/// Whether the command-line launcher is already installed, and where.
///
/// Asked when the settings page opens, so the button can say what it will do rather than looking
/// identical whether or not the job is already done.
#[tauri::command]
pub fn cli_status(app: tauri::AppHandle) -> Result<Option<crate::cli_install::CliInstall>> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| AppError::Other(format!("no home directory: {e}")))?;
    // The LOGIN shell's PATH, never this process's. A GUI app is started by launchd with a minimal
    // one, so `~/.local/bin` — which the user has had in `.zprofile` for years — is invisible here,
    // and the panel said "not on your PATH" about a directory that was first in it
    // (`terminal::environment`, which exists for exactly this class of confusion).
    let path_var = crate::terminal::environment::path().unwrap_or_default();
    let status =
        crate::cli_install::status(&crate::cli_install::default_candidates(&home), &path_var);
    tracing::debug!(installed = status.is_some(), "cli_status");
    Ok(status)
}

/// Put `ygg` and `yggshell` on the user's PATH.
///
/// **Only ever on request.** Writing to a directory on someone's PATH is not something an app does
/// because it launched; it is a button, the way editors do it (`cli_install`).
///
/// The script is a bundled resource, copied rather than symlinked so it survives the app being
/// replaced — and read through Tauri's resource resolver, never a path assembled by hand, because a
/// bundle lays out differently on every platform (rule:rust-conventions).
#[tauri::command]
pub fn install_cli(app: tauri::AppHandle) -> Result<crate::cli_install::CliInstall> {
    tracing::info!("install_cli");
    // `resources/cli/ygg`, not `cli/ygg`: Tauri copies a declared resource keeping its path relative
    // to the crate root, so the tree inside the bundle starts with `resources/` too. Same join the
    // bundled themes use (`theme::bundled`) — verified against a built .app rather than assumed.
    let script_path = app
        .path()
        .resolve("resources/cli/ygg", tauri::path::BaseDirectory::Resource)
        .map_err(|e| {
            AppError::Other(format!("the launcher script is missing from the app: {e}"))
        })?;
    let script = std::fs::read_to_string(&script_path)
        .map_err(|e| AppError::io(script_path.to_string_lossy(), e))?;

    let home = app
        .path()
        .home_dir()
        .map_err(|e| AppError::Other(format!("no home directory: {e}")))?;
    // The login shell's PATH — see `cli_status` above. This comment used to claim the process
    // inherited it, which is exactly wrong on macOS: launchd hands a GUI app a minimal PATH, and the
    // entries a developer actually has only exist after a login shell has run.
    let path_var = crate::terminal::environment::path().unwrap_or_default();

    let result = crate::cli_install::install(
        &script,
        &crate::cli_install::default_candidates(&home),
        &path_var,
    )?;
    tracing::info!(directory = %result.directory, on_path = result.on_path, "install_cli ok");
    Ok(result)
}

/// Directories handed to the app before the interface could listen.
///
/// **Why a pull and not only a push.** `ygg ~/project` on a cold start delivers its path while the
/// webview is still loading, so the event reaches nobody. The frontend calls this once it is
/// listening and gets what it missed. Draining is deliberate: each request opens one tab, and a
/// reload must not reopen terminals the user already has.
#[tauri::command]
pub fn pending_launches(state: State<'_, crate::launch::Pending>) -> Vec<String> {
    let paths = state.drain();
    if !paths.is_empty() {
        tracing::info!(count = paths.len(), "handing over queued launch requests");
    }
    paths
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

/// List one directory for the file browser.
///
/// `root` is the tab's own working directory and `path` the folder being opened; the second is
/// checked against the first before anything is read, so the browser cannot be talked into
/// enumerating the filesystem (`files::list`, rule:security).
///
/// One level per call, deliberately: a recursive walk would read `node_modules` on the first frame.
#[tauri::command]
pub fn list_directory(root: String, path: String) -> Result<crate::dto::DirListing> {
    tracing::debug!(%root, %path, "list_directory");
    let listing = crate::files::list(std::path::Path::new(&root), std::path::Path::new(&path))?;
    tracing::debug!(
        %path,
        count = listing.entries.len(),
        truncated = listing.truncated,
        "list_directory ok"
    );
    Ok(crate::dto::DirListing {
        entries: listing.entries,
        truncated: listing.truncated,
    })
}

/// Show a file or folder in the system file manager, selected.
///
/// **Not `open_external` with a `file://` URL.** That one refuses anything but http(s) on purpose,
/// and rightly: opening an arbitrary local path with the default handler would *run* an
/// application chosen by whatever the file is. This reveals the item in the file manager instead —
/// the folder opens with the item selected, and nothing about the file decides what happens.
///
/// The path is checked against the tab's own root exactly as a listing is, so the browser cannot be
/// talked into revealing something outside the tree it shows (rule:security).
#[tauri::command]
pub fn reveal_in_file_manager(root: String, path: String) -> Result<()> {
    tracing::info!(%root, %path, "reveal_in_file_manager");
    let target = crate::files::verify(std::path::Path::new(&root), std::path::Path::new(&path))?;
    crate::files::reveal(&target)?;
    tracing::info!(%path, "reveal_in_file_manager ok");
    Ok(())
}

/// Every container the daemon knows about, running or not.
///
/// Read-only. Starting or stopping one is a command, and whether this app may issue it is a decision
/// for an ADR rather than for a widget (`docker`, ADR-PROJ-001 §5). An empty list is the honest
/// answer when there is no Docker, no daemon, or no permission — none of those is an error here.
#[tauri::command]
pub fn list_containers() -> Vec<crate::dto::ContainerInfo> {
    let containers = crate::docker::containers();
    tracing::debug!(count = containers.len(), "list_containers");
    containers
}

/// What the running containers are consuming right now.
///
/// **Separate from `list_containers`, and the split is the whole design.** This call takes ~2 s
/// (measured on six containers): `docker stats` samples twice to compute a CPU delta, and that cost
/// is per call, not per container. The listing costs milliseconds and is what the panel needs to draw
/// anything at all — so the two are fetched independently, and this one only while the tool is
/// actually on screen (`components/tools/DockerTool`). A monitor nobody is looking at is just heat.
#[tauri::command]
pub fn container_stats() -> Vec<crate::dto::ContainerStats> {
    let stats = crate::docker::stats();
    tracing::debug!(count = stats.len(), "container_stats");
    stats
}

/// The last `lines` of a container's log.
///
/// The id is validated as one before it reaches a process (rule:security), and the read is bounded:
/// a week-old container's whole log has no business crossing the IPC boundary to fill a panel.
#[tauri::command]
pub fn container_logs(id: String, lines: u32) -> String {
    tracing::debug!(%id, lines, "container_logs");
    // Clamped here rather than trusted: the number arrives from the webview, and "all of it" is
    // exactly the request this must not honour.
    crate::docker::logs(&id, lines.clamp(1, 2_000))
}

/// How a project is pointed at a Claude account, and what this machine can do about it.
///
/// Read-only. Everything it reports is a fact on disk: which homes exist, what the `.envrc` says,
/// whether direnv is installed, and whether direnv itself considers the file approved.
#[tauri::command]
pub fn environment_status(
    app: tauri::AppHandle,
    cwd: String,
) -> Result<crate::dto::EnvironmentStatus> {
    use tauri::Manager;
    tracing::debug!(%cwd, "environment_status");
    let project = std::path::Path::new(&cwd);
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| AppError::Other(format!("could not resolve the home directory: {e}")))?;

    let declared = crate::agent::declared_home(project);
    let used = crate::agent::homes_for(&home_dir, project);
    let mut homes = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&home_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(".claude") || !entry.path().is_dir() {
                continue;
            }
            homes.push(crate::dto::ClaudeHome {
                used_here: used.contains(&entry.path()),
                path: entry.path().to_string_lossy().to_string(),
                name,
            });
        }
    }
    homes.sort_by(|a, b| a.name.cmp(&b.name));

    let status = crate::dto::EnvironmentStatus {
        homes,
        declared: declared.as_ref().map(|p| p.to_string_lossy().to_string()),
        has_envrc: declared.is_some(),
        direnv_installed: crate::agent::direnv::is_installed(),
        direnv_allowed: crate::agent::direnv::is_allowed(project),
    };
    tracing::debug!(
        homes = status.homes.len(),
        declared = ?status.declared,
        direnv = status.direnv_installed,
        "environment_status ok"
    );
    Ok(status)
}

/// Point this project at a Claude account, and approve the file so direnv will load it.
///
/// **Two deliberate acts, in one call because they are one intention.** The `.envrc` is written (an
/// existing one is backed up and preserved line for line), and then approved — which is spending
/// direnv's own safety, and defensible only because the app wrote the file itself, in this same
/// action, at the user's request, and reports the path back so they can read what was approved
/// (`agent::direnv`).
///
/// Approval is best-effort: without direnv the declaration is still correct and takes effect as soon
/// as direnv arrives. That is a partial success, and it is reported as one rather than as a failure.
#[tauri::command]
pub fn set_project_environment(cwd: String, home: String) -> Result<String> {
    tracing::info!(%cwd, %home, "set_project_environment");
    let project = std::path::Path::new(&cwd);
    let home_path = std::path::Path::new(&home);
    if !home_path.is_dir() {
        return Err(AppError::Other(format!("{home} is not a directory")));
    }
    let written =
        crate::agent::declare_home(project, home_path).map_err(|e| AppError::io(cwd.clone(), e))?;
    if crate::agent::direnv::is_installed() {
        crate::agent::direnv::allow(project)?;
    } else {
        tracing::warn!(
            "direnv is not installed — the declaration is written but will not load yet"
        );
    }
    Ok(written.to_string_lossy().to_string())
}

/// Create a new, empty Claude home.
///
/// Empty is the whole of it: Claude Code signs in on first use and writes its own credentials there.
/// **This app never touches a credential** (rule:security) — it makes a directory and lets the
/// harness do the rest.
#[tauri::command]
pub fn create_claude_home(app: tauri::AppHandle, name: String) -> Result<String> {
    use tauri::Manager;
    tracing::info!(%name, "create_claude_home");
    // The name becomes a directory under the user's home. Anything but a plain name could put it
    // somewhere else entirely (rule:security: validate at the boundary).
    let clean = name.trim();
    if clean.is_empty()
        || !clean
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Other(
            "a name may only contain letters, digits, dashes and underscores".to_string(),
        ));
    }
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| AppError::Other(format!("could not resolve the home directory: {e}")))?;
    let path = home_dir.join(format!(".claude-{clean}"));
    std::fs::create_dir_all(&path).map_err(|e| AppError::io(path.display().to_string(), e))?;
    tracing::info!(path = %path.display(), "created a claude home");
    Ok(path.to_string_lossy().to_string())
}

/// Install direnv through the machine's own package manager.
///
/// The whole command is a constant in `agent::direnv` — nothing about it comes from the webview
/// (ADR-PROJ-001 §5). Returns the manager that did it.
#[tauri::command]
pub fn install_direnv() -> Result<String> {
    tracing::info!("install_direnv");
    crate::agent::direnv::install()
}

/// Where the hook script lives once installed, beside the launcher.
fn hook_script(home: &std::path::Path) -> std::path::PathBuf {
    home.join(".local/bin/ygg-hook")
}

/// Whether the agent hooks are in place, and what they have reported since last looked at.
///
/// Read-only and cheap: a file read and a settings parse. The events themselves are appended by a
/// script running inside the user's own sessions, so they are there whether or not this app was
/// open when they happened.
#[tauri::command]
pub fn agent_attention(
    app: tauri::AppHandle,
    cwd: Option<String>,
) -> Result<crate::dto::AgentAttention> {
    use tauri::Manager;
    tracing::debug!(cwd = cwd.as_deref().unwrap_or("-"), "agent_attention");
    let home = app
        .path()
        .home_dir()
        .map_err(|e| AppError::Other(format!("no home directory: {e}")))?;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("no app data directory: {e}")))?;
    let script = hook_script(&home);

    // **`cwd` is optional, and that is a correctness requirement rather than a convenience.** It
    // decides only WHICH account's settings are checked for the hook — the events themselves are
    // machine-wide and are about tabs the user is not looking at. Requiring it made the whole signal
    // depend on the front tab having reported a directory yet: no directory, no query, no attention
    // for any of the other tabs either. The question this answers is not "what is in front of me".
    let claude_home = cwd
        .as_deref()
        .and_then(|cwd| crate::agent::declared_home(std::path::Path::new(cwd)))
        .unwrap_or_else(|| home.join(".claude"));
    let events = crate::agent::hooks::events_path(&data);
    // The current state, not the log: only an agent that is actually asking, and only its newest
    // word — so answering makes the mark go away on its own (`hooks::waiting_now`).
    let waiting: Vec<crate::dto::AgentWaiting> =
        crate::agent::hooks::waiting_now(crate::agent::hooks::read_events(&events, 50))
            .into_iter()
            .map(|event| crate::dto::AgentWaiting {
                cwd: event.cwd,
                event: event.event,
                message: event.message,
            })
            .collect();

    let installed = crate::agent::hooks::is_installed(&claude_home, &script);
    // The file it read is named, and that is the point of logging this one at all: the hook script
    // writes to a path it works out for ITSELF, so "the panel says nothing is waiting" and "the
    // events are in a file over there" look identical from the outside (rule:logging).
    tracing::debug!(
        installed,
        waiting = waiting.len(),
        events = %events.display(),
        claude_home = %claude_home.display(),
        "agent_attention ok"
    );

    Ok(crate::dto::AgentAttention { installed, waiting })
}

/// Install the hook into this project's Claude home.
///
/// Two steps, and the second is the one worth naming: the script is copied next to the launcher, and
/// an entry pointing at it is added to `settings.json` — the user's file, so it is parsed, extended
/// and written back whole, with a backup first.
///
/// **Claude Code reads `hooks` when a SESSION STARTS**, so this takes effect in the next session and
/// never in the one running. The interface says so; without that the button looks broken.
#[tauri::command]
pub fn install_agent_hook(app: tauri::AppHandle, cwd: String) -> Result<String> {
    use tauri::Manager;
    tracing::info!(%cwd, "install_agent_hook");
    let home = app
        .path()
        .home_dir()
        .map_err(|e| AppError::Other(format!("no home directory: {e}")))?;

    let source = app
        .path()
        .resolve(
            "resources/cli/ygg-hook",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| AppError::Other(format!("the hook script is missing from the app: {e}")))?;
    let script = hook_script(&home);
    if let Some(parent) = script.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::io(parent.display().to_string(), e))?;
    }
    std::fs::copy(&source, &script).map_err(|e| AppError::io(script.display().to_string(), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| AppError::io(script.display().to_string(), e))?;
    }

    let claude_home = crate::agent::declared_home(std::path::Path::new(&cwd))
        .unwrap_or_else(|| home.join(".claude"));
    let settings = crate::agent::hooks::install(&claude_home, &script)?;
    Ok(settings.to_string_lossy().to_string())
}

/// Forget every attention event recorded so far.
#[tauri::command]
pub fn clear_agent_attention(app: tauri::AppHandle) -> Result<()> {
    use tauri::Manager;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("no app data directory: {e}")))?;
    crate::agent::hooks::clear(&crate::agent::hooks::events_path(&data))
}
