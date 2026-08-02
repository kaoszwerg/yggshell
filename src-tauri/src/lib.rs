//! Backend library entry point.
//!
//! Wires up logging, application state, the system tray and the Tauri command surface. Domain
//! modules are added alongside these as the app grows — this file stays the single place where the
//! app is assembled.

pub mod agent;
pub mod cli_install;
pub mod commands;
pub mod crash;
pub mod docker;
pub mod dto;
pub mod error;
pub mod files;
mod git;
pub mod launch;
pub mod logging;
pub mod notes;
pub mod procs;
pub mod profile;
pub mod services;
pub mod settings;
pub mod state;
pub mod sysload;
pub mod terminal;
pub mod theme;
pub mod tray;

use crate::state::AppState;
use tauri::{Emitter, Manager};
use tokio::sync::broadcast::error::RecvError;

/// Build and run the Tauri application.
///
/// This is the process's entry point, and it is the last thing that can report a failure to the user
/// (ADR-CORE-037): the panic hook goes in FIRST — before the builder, before logging — because a panic
/// while resolving the app data dir happens before either exists. Nothing here is allowed to die
/// silently, and `main.rs` builds with `windows_subsystem = "windows"`, so there is no console to fall
/// back on.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crash::install_panic_hook();

    let app = tauri::Builder::default()
        // Paths handed in from outside — `ygg <dir>` and Finder's "Open With" — queue here until the
        // window is listening. A cold start emits before the webview exists (`launch::Pending`).
        .manage(launch::Pending::default())
        // Persist + restore window size and position across runs.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Tauri turns an `Err` from this closure into `panic!("Failed to setup app: {e}")`
            // (tauri 2.11.2, app.rs) — it never reaches `run()`'s `Result`. The panic hook would catch
            // it, but the process would then report EXIT_PANIC for what is really a startup failure.
            // So we handle it here, and the exit code says what actually happened.
            if let Err(e) = setup(app) {
                crash::fatal(
                    "startup",
                    "The application could not start.",
                    &format!("setup failed: {e:#}"),
                    crash::EXIT_STARTUP,
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::notes::notes_status,
            commands::notes::notes_configure,
            commands::notes::notes_reset,
            commands::notes::notes_connect,
            commands::notes::notes_disconnect,
            commands::notes::notes_sync,
            commands::notes::notes_projects,
            commands::notes::notes_tree,
            commands::notes::notes_index,
            commands::notes::notes_topics,
            commands::notes::notes_read,
            commands::notes::notes_write,
            commands::notes::notes_capture,
            commands::notes::notes_toggle,
            commands::notes::notes_delete,
            commands::notes::notes_delete_project,
            commands::notes::notes_rename_project,
            commands::notes::notes_create_project,
            commands::notes::notes_search,
            commands::notes::notes_image_add,
            commands::notes::notes_image_read,
            commands::notes::notes_image_fetch,
            commands::notes::notes_orphans,
            commands::notes::notes_clean,
            commands::app_version,
            commands::build_info,
            commands::get_recent_logs,
            commands::get_settings,
            commands::update_settings,
            commands::list_shells,
            commands::pending_launches,
            commands::install_cli,
            commands::cli_status,
            commands::bundled_credits,
            commands::changelog,
            commands::system_load,
            commands::list_directory,
            commands::environment_status,
            commands::set_project_environment,
            commands::create_claude_home,
            commands::install_direnv,
            commands::agent_attention,
            commands::install_agent_hook,
            commands::clear_agent_attention,
            commands::list_containers,
            commands::container_stats,
            commands::container_logs,
            commands::reveal_in_file_manager,
            commands::read_text_file,
            commands::open_path,
            commands::list_terminal_themes,
            commands::import_terminal_theme,
            commands::save_terminal_theme,
            commands::delete_terminal_theme,
            commands::list_terminal_profiles,
            commands::save_terminal_profile,
            commands::delete_terminal_profile,
            commands::open_external,
            commands::report_crash,
            commands::pending_crash,
            commands::exit_after_crash,
            commands::terminal::terminal_open,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::terminal::terminal_status,
            commands::terminal::terminal_activity,
            commands::terminal::agent_session,
            commands::terminal::agent_usage,
            commands::terminal::clipboard_text,
            commands::terminal::tmux_sessions,
            commands::terminal::tmux_kill_session,
            commands::terminal::tmux_rename_session,
            commands::git::git_snapshot,
            commands::git::git_fetch,
            commands::git::git_file_diff,
            commands::git::git_commit,
            commands::git::git_commit_file_diff,
        ])
        .build(tauri::generate_context!());

    // Reached only when the BUILDER failed (a bad context, a window that could not be constructed) —
    // `App::run` exits the process itself on the happy path. This used to be a bare `.expect()`: a
    // panic printed to a stderr that, under `windows_subsystem = "windows"`, nobody is reading.
    let app = match app {
        Ok(app) => app,
        Err(e) => {
            crash::fatal(
                "startup",
                "The application could not start.",
                &format!("tauri failed to build: {e:#}"),
                crash::EXIT_STARTUP,
            );
        }
    };

    // `run` with a handler rather than `run()`: macOS delivers "open these folders in this app" as a
    // run event, which is how both `ygg <dir>` and Finder's Open With reach us. It fires on a cold
    // start too, before the webview exists — `launch::Pending` is what makes that case work.
    app.run(|handle, event| match event {
        tauri::RunEvent::Opened { urls } => {
            let paths: Vec<String> = urls.iter().map(ToString::to_string).collect();
            launch::handle_urls(handle, &paths);
        }
        // Why the shutdown is logged at all: the app went away once and nobody could say who ended
        // it. `save_geometry` only runs on the window's × and the tray's Quit, so the most common
        // exit of all — ⌘Q, "Quit" in the dock menu, a logout — left NOTHING behind. That is a
        // silent end to a process, which is exactly what rule:logging forbids: the lifecycle is
        // logged, and "who closed it" must be a question the log answers.
        tauri::RunEvent::ExitRequested { .. } => {
            tracing::info!("exit requested — the app was asked to quit");
        }
        tauri::RunEvent::Exit => {
            // Quitting the app does NOT close each tab — the process just ends, and a tmux client
            // that loses its terminal that way takes the session with it (measured, see
            // terminal::tmux::detach_client). Every attached client is handed back here, so ⌘Q with
            // four tabs open leaves four resumable sessions rather than none.
            terminal::tmux::detach_all();
            // Also the last chance to keep the window's size and position: the state plugin writes
            // its own file here, but only for a clean exit, and this is that moment.
            tray::save_geometry_on_exit(handle);
            tracing::info!("shutting down");
            logging::flush();
        }
        _ => {}
    });
}

/// Everything the app needs before the first frame. Fallible on purpose: the caller turns any failure
/// into a reported, recorded, deliberate exit (ADR-CORE-037) instead of a silent one.
fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    // Point the crash path at the real app data dir; until now reports went to the temp dir.
    crash::set_data_dir(&data_dir);
    logging::init(&data_dir);
    tracing::info!(
        app = %app.package_info().name,
        version = env!("CARGO_PKG_VERSION"),
        data_dir = %data_dir.display(),
        "starting"
    );

    // The Finder context-menu entry ("New YggShell Terminal Here"). Declaring it in Info.plist is
    // only half — without a registered provider the item appears and does nothing (services.rs).
    #[cfg(target_os = "macos")]
    services::register(&app.handle().clone());

    // Bridge live log records to the frontend log view.
    let log_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let mut rx = logging::subscribe();
        loop {
            match rx.recv().await {
                Ok(rec) => {
                    // Deliberately not re-logged on Err: the record is already in the ring buffer +
                    // JSON file, and logging an emit failure would feed back into this same stream.
                    let _ = log_handle.emit("log://record", rec);
                }
                // The UI could not keep up and the channel dropped records. This is recoverable — the
                // receiver stays valid — so we say so and keep bridging. The old `while let Ok(..)`
                // loop ENDED here: the log view then silently froze for the rest of the session, which
                // is exactly the silent death this app is not allowed to have (ADR-CORE-037).
                Err(RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "log bridge fell behind; records dropped");
                }
                // The sender is gone: logging is shutting down, so this task is done. That happens
                // only on the way out, and it is stated rather than assumed.
                Err(RecvError::Closed) => {
                    tracing::debug!("log bridge closed");
                    break;
                }
            }
        }
    });

    // The resource directory holds what we ship (the bundled colour schemes). A build that cannot
    // resolve it still runs — the user simply starts with no schemes rather than with no app.
    let resource_dir = app.path().resource_dir().unwrap_or_else(|error| {
        tracing::warn!(%error, "no resource directory — bundled colour schemes will be missing");
        data_dir.clone()
    });
    app.manage(AppState::new(&data_dir, &resource_dir));
    app.manage(crate::terminal::TerminalRegistry::default());
    crate::terminal::shell_integration::set_data_dir(&data_dir);
    // Close handler is always registered; it consults the live `minimize_to_tray` setting. The tray
    // icon itself is installed only when the setting is on (default off).
    tray::install_close_handler(app.handle());
    let tray_enabled = app.state::<AppState>().settings.get().minimize_to_tray;
    tray::set_enabled(app.handle(), tray_enabled);
    apply_saved_zoom(app);
    // The agent hook is a COPY in ~/.local/bin, so an update never reaches it on its own — and
    // nobody presses "install" again for a problem they have not been told about. Repaired here, the
    // way the Finder registration is (`services::refresh_launch_services`).
    commands::refresh_hook_script(app.handle());
    // …and its registration: a new hook event otherwise reaches only whoever presses install again.
    commands::refresh_agent_hooks(app.handle());
    tracing::info!("startup complete");
    Ok(())
}

/// Put the user's UI scale on the webview **here**, before it has painted anything.
///
/// **The frontend cannot do this without a visible jump, however fast it is.** `ui_scale` is the
/// *native* WebView zoom (ADR-APP-021), not CSS — so applying it means calling `setZoom`, and from
/// React that call can only happen in an effect, i.e. after a frame has already been laid out and
/// shown at 100 %. The window then visibly resizes its contents on every single launch. Seeding the
/// settings query from cache fixes the DOM half of that (`hooks/useSettings`) and cannot fix this
/// half at all: the zoom is not a React value.
///
/// Rust already has the settings — it loaded them a few lines above to decide the tray — so it can
/// set the zoom while the webview is still starting up. The frontend keeps its own `setZoom` for
/// *changes* made in Settings; this is only about the first frame.
///
/// A failure is logged and shrugged off (rule:logging): starting at 100 % is a cosmetic problem, and
/// refusing to start over it would be a far worse one.
fn apply_saved_zoom(app: &tauri::App) {
    use tauri::Manager;
    let scale = app.state::<AppState>().settings.get().ui_scale;
    if (scale - 1.0).abs() < f64::EPSILON {
        return;
    }
    match app.get_webview_window("main") {
        Some(window) => match window.set_zoom(scale) {
            Ok(()) => tracing::debug!(scale, "applied the saved UI scale before the first frame"),
            Err(error) => tracing::warn!(%error, scale, "could not apply the saved UI scale"),
        },
        None => tracing::warn!("no main window to apply the saved UI scale to"),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn app_version_matches_cargo_metadata() {
        assert_eq!(super::commands::app_version(), env!("CARGO_PKG_VERSION"));
    }
}
