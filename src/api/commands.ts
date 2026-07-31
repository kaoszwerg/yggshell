// Typed wrappers around the Tauri command surface. Types come from the ts-rs bindings (SSOT,
// ADR-CORE-005). Run `npm run gen:types` after touching Rust DTOs.
import { invoke } from "@tauri-apps/api/core";
import type { BuildInfo } from "../bindings/BuildInfo";
import type { CrashReport } from "../bindings/CrashReport";
import type { LogRecord } from "../bindings/LogRecord";
import type { SettingsDto } from "../bindings/SettingsDto";

/**
 * Typed facade over the backend `#[tauri::command]` surface. Every IPC call in the app flows through
 * here (rule:frontend-architecture), so payload shapes live in one place and match the generated
 * bindings.
 */
export const api = {
  /** App SemVer version (IPC smoke test). */
  appVersion: () => invoke<string>("app_version"),
  /** Build identity: version, channel and the commit the binary was built from. */
  buildInfo: () => invoke<BuildInfo>("build_info"),
  /** Snapshot of the recent log ring buffer for the Logs view's initial load. */
  getRecentLogs: () => invoke<LogRecord[]>("get_recent_logs"),
  /** Read the persisted user settings. */
  getSettings: () => invoke<SettingsDto>("get_settings"),
  /**
   * Partial update — omitted fields keep their current value. Toggling `minimizeToTray` installs or
   * removes the system-tray icon immediately (no restart).
   */
  updateSettings: (opts: { uiScale?: number; minimizeToTray?: boolean }) =>
    invoke<SettingsDto>("update_settings", {
      uiScale: opts.uiScale ?? null,
      minimizeToTray: opts.minimizeToTray ?? null,
    }),
  /** Open an http(s) URL in the default browser (routed through the backend so it is logged). */
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  /**
   * Record a fatal error from the UI runtime in the durable, on-device crash report (ADR-APP-032) and
   * return the report's path. The UI is its own entry point — the Rust panic hook cannot see it — so a
   * crash that does not come through here leaves no evidence at all.
   */
  reportCrash: (report: CrashReport) => invoke<string>("report_crash", { report }),
  /** The crash report a previous run left behind, if it crashed. Consumed on read (shown once). */
  pendingCrash: () => invoke<string | null>("pending_crash"),
  /** End the process after a fatal UI error, with the exit code that says so (`EXIT_UI_CRASH`). */
  exitAfterCrash: () => invoke<void>("exit_after_crash"),
};
