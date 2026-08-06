// Typed wrappers around the Tauri command surface. Types come from the ts-rs bindings (SSOT,
// ADR-CORE-005). Run `npm run gen:types` after touching Rust DTOs.
import { invoke } from "@tauri-apps/api/core";
import type { AppMenuSpec } from "../bindings/AppMenuSpec";
import type { BuildInfo } from "../bindings/BuildInfo";
import type { SystemLoad } from "../bindings/SystemLoad";
import type { CliInstall } from "../bindings/CliInstall";
import type { CrashReport } from "../bindings/CrashReport";
import type { LogRecord } from "../bindings/LogRecord";
import type { SettingsDto } from "../bindings/SettingsDto";
import type { ShellInfo } from "../bindings/ShellInfo";
import type { TerminalProfile } from "../bindings/TerminalProfile";
import type { TerminalTheme } from "../bindings/TerminalTheme";
import type { TmuxMode } from "../bindings/TmuxMode";

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
   * The shells this machine offers, produced by the backend.
   *
   * Settings picks *from* this list and stores a path that is on it; it never composes one. The
   * backend refuses anything else, both when it is stored and again before it spawns — which is what
   * keeps "which shell to start" from becoming a way for the webview to name a program
   * (ADR-PROJ-001 §5).
   */
  listShells: () => invoke<ShellInfo[]>("list_shells"),

  /**
   * Every colour scheme the user has imported or saved.
   *
   * The built-in HUD palette is deliberately not in this list — colour lives in the frontend
   * (rule:theming), and `terminalTheme.ts` puts it in front of these.
   */
  listTerminalThemes: () => invoke<TerminalTheme[]>("list_terminal_themes"),

  /**
   * Import an `.itermcolors` file and store it.
   *
   * The PATH travels, never the contents: a drop event gives the webview a path, and the backend is
   * the one that opens the file — bounded, extension-checked, and parsed by a reader that resolves no
   * entities (ADR-PROJ-001 §5, rule:security).
   */
  /**
   * Import an `.itermcolors` scheme the user picks.
   *
   * **No path crosses this boundary**: the native picker is opened by the backend inside the command,
   * so the webview asks for an import and is handed the stored theme. `null` means the dialog was
   * closed, which is not an error.
   */
  importTerminalTheme: () => invoke<TerminalTheme | null>("import_terminal_theme"),

  /**
   * Describe the native application menu and have it installed.
   *
   * Sent again whenever the language or a key binding changes: the menu carries no strings and no
   * keys of its own, so this call is the only thing keeping it true (`lib/appMenu`, `menu.rs`).
   */
  setAppMenu: (spec: AppMenuSpec) => invoke<void>("set_app_menu", { spec }),

  /** Store an edited theme. Its id is derived from the name by the backend, never sent. */
  saveTerminalTheme: (theme: TerminalTheme) =>
    invoke<TerminalTheme>("save_terminal_theme", { theme }),

  /** Delete a stored theme. Deleting one that is not there is not a failure. */
  deleteTerminalTheme: (id: string) => invoke<void>("delete_terminal_theme", { id }),

  /** Every terminal profile the user has saved. */
  listTerminalProfiles: () => invoke<TerminalProfile[]>("list_terminal_profiles"),

  /** Store a profile. Its id and the shell it names are both validated by the backend. */
  saveTerminalProfile: (profile: TerminalProfile) =>
    invoke<TerminalProfile>("save_terminal_profile", { profile }),

  /** Delete a profile. Deleting one that is not there is not a failure. */
  deleteTerminalProfile: (id: string) => invoke<void>("delete_terminal_profile", { id }),
  /**
   * Partial update — omitted fields keep their current value. Toggling `minimizeToTray` installs or
   * removes the system-tray icon immediately (no restart).
   */
  updateSettings: (opts: {
    uiScale?: number;
    terminalFontSize?: number;
    toolFontSize?: number;
    terminalShell?: string;
    terminalTheme?: string;
    diffTheme?: string;
    commitTheme?: string;
    notesTheme?: string;
    notesEditTheme?: string;
    terminalFont?: string;
    gitAutoFetch?: boolean;
    language?: string;
    copyOnSelect?: boolean;
    tmuxMode?: TmuxMode;
    tmuxSession?: string;
    minimizeToTray?: boolean;
  }) =>
    invoke<SettingsDto>("update_settings", {
      uiScale: opts.uiScale ?? null,
      terminalFontSize: opts.terminalFontSize ?? null,
      toolFontSize: opts.toolFontSize ?? null,
      terminalShell: opts.terminalShell ?? null,
      terminalTheme: opts.terminalTheme ?? null,
      diffTheme: opts.diffTheme ?? null,
      commitTheme: opts.commitTheme ?? null,
      notesTheme: opts.notesTheme ?? null,
      notesEditTheme: opts.notesEditTheme ?? null,
      terminalFont: opts.terminalFont ?? null,
      gitAutoFetch: opts.gitAutoFetch ?? null,
      language: opts.language ?? null,
      copyOnSelect: opts.copyOnSelect ?? null,
      tmuxMode: opts.tmuxMode ?? null,
      tmuxSession: opts.tmuxSession ?? null,
      minimizeToTray: opts.minimizeToTray ?? null,
    }),
  /**
   * Directories handed to the app before the interface could listen — `ygg <dir>` on a cold start,
   * or a folder opened from Finder while the window was still loading.
   *
   * Draining, not reading: each request opens one tab, and a reload must not reopen terminals the
   * user already has.
   */
  pendingLaunches: () => invoke<string[]>("pending_launches"),
  /**
   * Put `ygg` and `yggshell` on the user's PATH. Only ever called from the button that offers it.
   *
   * Reports where they went and whether that directory is on PATH — installed and not found is a
   * worse outcome than not installed, so the caller has to be able to say so.
   */
  installCli: () => invoke<CliInstall>("install_cli"),
  /**
   * Where the launcher already is, or `null`. Read from the filesystem each time — the user can
   * delete it, and a remembered answer would then be wrong.
   */
  cliStatus: () => invoke<CliInstall | null>("cli_status"),
  /**
   * The licence notices of everything bundled with the app.
   *
   * A licence obligation, not a courtesy: the ported colour schemes are MIT, which requires the
   * copyright notice to travel with the copy. It is embedded in the binary, so it cannot go missing.
   */
  bundledCredits: () => invoke<string>("bundled_credits"),
  /**
   * What changed, release by release. Embedded in the binary, like the licence notices — a changelog
   * in the repository answers the question for people reading the repository, which is not who is
   * looking at the app wondering what the update did.
   */
  changelog: () => invoke<string>("changelog"),
  /**
   * How busy the machine is, or `null` where the platform has no load average.
   *
   * `null` is the honest answer on Windows, which has no such measurement — a zero there would read
   * as a perfectly idle machine.
   */
  systemLoad: () => invoke<SystemLoad | null>("system_load"),
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
