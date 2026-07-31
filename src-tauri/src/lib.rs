//! Backend library entry point.
//!
//! Wires up logging, application state, the system tray and the Tauri command surface. Domain
//! modules are added alongside these as the app grows — this file stays the single place where the
//! app is assembled.

pub mod commands;
pub mod crash;
pub mod dto;
pub mod error;
pub mod logging;
pub mod settings;
pub mod state;
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

    let result = tauri::Builder::default()
        // Persist + restore window size and position across runs.
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
            commands::app_version,
            commands::build_info,
            commands::get_recent_logs,
            commands::get_settings,
            commands::update_settings,
            commands::open_external,
            commands::report_crash,
            commands::pending_crash,
            commands::exit_after_crash,
        ])
        .run(tauri::generate_context!());

    // Reached only when the BUILDER failed (a bad context, a window that could not be constructed) —
    // `App::run` exits the process itself on the happy path. This used to be a bare `.expect()`: a
    // panic printed to a stderr that, under `windows_subsystem = "windows"`, nobody is reading.
    if let Err(e) = result {
        crash::fatal(
            "startup",
            "The application could not start.",
            &format!("tauri failed to build: {e:#}"),
            crash::EXIT_STARTUP,
        );
    }
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

    app.manage(AppState::new(&data_dir));
    // Close handler is always registered; it consults the live `minimize_to_tray` setting. The tray
    // icon itself is installed only when the setting is on (default off).
    tray::install_close_handler(app.handle());
    let tray_enabled = app.state::<AppState>().settings.get().minimize_to_tray;
    tray::set_enabled(app.handle(), tray_enabled);
    tracing::info!("startup complete");
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn app_version_matches_cargo_metadata() {
        assert_eq!(super::commands::app_version(), env!("CARGO_PKG_VERSION"));
    }
}
