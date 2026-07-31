//! Boundary types (Rust -> TypeScript). `ts-rs` exports these into `src/bindings/` so the frontend
//! never re-declares a shape by hand (ADR-CORE-005). Run `npm run gen:types` after any change here.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Build identity: SemVer version, channel (dev/release), and the exact commit it was built from
/// (ADR-CORE-024). Rendered in the title bar, status bar and About dialog.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BuildInfo {
    /// SemVer version, from `package.json` via `CARGO_PKG_VERSION`.
    pub version: String,
    /// Build channel: `"dev"` for debug builds, `"release"` otherwise (ADR-CORE-024).
    pub channel: String,
    /// Whether this is a debug build (`cfg!(debug_assertions)`).
    pub debug: bool,
    /// Short git commit SHA the binary was built from (set by `build.rs`).
    pub git_sha: String,
    /// Whether the working tree was dirty at build time.
    pub git_dirty: bool,
    /// Commit date of `git_sha` (ISO-8601) — answers "what's in this build".
    pub commit_date: String,
}

/// Persisted user preferences. Stored as JSON under `<app_data_dir>/settings.json`.
///
/// Every field carries a serde default so a settings file written by an older version — missing a
/// newer field — still loads (the missing field falls back to its default) rather than failing to
/// parse and silently discarding the user's other preferences.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SettingsDto {
    /// WebView zoom factor applied to the whole UI (ADR-APP-021). Clamped to [0.7, 1.6].
    #[serde(default = "default_ui_scale")]
    pub ui_scale: f64,
    /// Terminal text size in CSS pixels, **independent of `ui_scale`**.
    ///
    /// Its own setting because the two are different questions: how big the chrome is, and how much
    /// output fits on screen. The frontend divides this by `ui_scale` before handing it to the
    /// emulator, so the WebView zoom cannot drag it along.
    #[serde(default = "default_terminal_font_size")]
    pub terminal_font_size: f64,
    /// When true, closing the window hides the app to a system-tray icon instead of quitting, so it
    /// keeps running in the background (ADR-APP-021). Default `false` — a fresh app is a normal window.
    #[serde(default)]
    pub minimize_to_tray: bool,
}

/// A fatal error from the **UI runtime**, on its way into the durable on-device crash record
/// (ADR-CORE-037, ADR-APP-032).
///
/// The webview is its own entry point: a Rust panic hook cannot see anything thrown inside it, so the
/// frontend hands its last-resort failures over the IPC boundary instead. Nothing here leaves the
/// device (rule:privacy) — it is written to `<app_data_dir>/crashes/` and to the log, and that is all.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct CrashReport {
    /// Where in the UI runtime it surfaced: `render`, `uncaught` or `unhandledrejection`.
    pub source: String,
    /// The error's message. Never a secret or user content (rule:logging).
    pub message: String,
    /// JS stack trace, when the thrown value carried one (a thrown string does not).
    pub stack: Option<String>,
}

fn default_ui_scale() -> f64 {
    1.0
}

fn default_terminal_font_size() -> f64 {
    13.0
}

impl Default for SettingsDto {
    fn default() -> Self {
        Self {
            ui_scale: default_ui_scale(),
            terminal_font_size: default_terminal_font_size(),
            minimize_to_tray: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_is_scale_one_no_tray() {
        let d = SettingsDto::default();
        assert_eq!(d.ui_scale, 1.0);
        assert!(!d.minimize_to_tray);
    }

    #[test]
    fn settings_roundtrip_through_json() {
        let s = SettingsDto {
            terminal_font_size: 13.0,
            ui_scale: 1.25,
            minimize_to_tray: true,
        };
        let json = serde_json::to_string(&s).expect("serialize");
        let back: SettingsDto = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.ui_scale, 1.25);
        assert!(back.minimize_to_tray);
    }

    #[test]
    fn settings_from_older_file_defaults_missing_fields() {
        // A file written before `minimize_to_tray` existed must still load without data loss.
        let s: SettingsDto = serde_json::from_str(r#"{"ui_scale":1.25}"#).expect("deserialize");
        assert_eq!(s.ui_scale, 1.25);
        assert!(!s.minimize_to_tray);
    }

    #[test]
    fn settings_contract_field_names_are_stable() {
        // Pin the JSON keys the generated frontend binding depends on (rule:testing contract).
        let json = serde_json::to_value(SettingsDto::default()).expect("to_value");
        assert!(json.get("ui_scale").is_some(), "ui_scale key missing");
        assert!(
            json.get("minimize_to_tray").is_some(),
            "minimize_to_tray key missing"
        );
    }
}

/// A terminal session ended by itself — the user typed `exit`, or the shell died (ADR-PROJ-001).
///
/// Closing a tab is the other direction and needs no event: the frontend already knows.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TerminalExit {
    /// The session that ended.
    pub id: u32,
    /// Its exit code, or `null` when the status could not be read at all.
    pub code: Option<u32>,
}

/// One path the working tree or index disagrees with (ADR-PROJ-001, Git tool).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct GitChange {
    /// Path relative to the repository root, as git itself reports it.
    pub path: String,
    /// `modified` | `added` | `deleted` | `renamed` | `untracked` | `conflicted`.
    pub status: String,
    /// Whether the change is in the index (staged) rather than only in the working tree.
    pub staged: bool,
}

/// One commit in the branch history.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct GitCommit {
    pub sha: String,
    /// Abbreviated sha, for display.
    pub short_sha: String,
    /// First line of the message.
    pub summary: String,
    pub author: String,
    /// Commit time, ISO-8601.
    pub when: String,
    /// Parent shas. Two or more means a merge — which is what the lane drawing is derived from.
    pub parents: Vec<String>,
    /// Branch and tag names pointing at this commit, already shortened.
    pub refs: Vec<String>,
}

/// Everything the Git tool shows for one repository, read in a single pass.
///
/// One DTO rather than four commands: the tool always renders all of it together, and four round
/// trips would let the branch, the file list and the history disagree with each other on screen.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct GitSnapshot {
    /// Absolute path of the repository's working-tree root.
    pub root: String,
    /// Current branch, or `null` when HEAD is detached or unborn.
    pub branch: Option<String>,
    /// Whether HEAD points at a commit rather than a branch.
    pub detached: bool,
    /// Abbreviated sha of HEAD, or `null` in a repository with no commits yet.
    pub head: Option<String>,
    /// Commits ahead of / behind the upstream branch. Both `0` when there is no upstream.
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<GitChange>,
    pub commits: Vec<GitCommit>,
}
