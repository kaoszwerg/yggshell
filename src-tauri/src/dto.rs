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
    /// Which shell a new terminal starts, as an absolute path. Empty means the user's own `$SHELL`.
    ///
    /// Only a path the backend itself offered is ever accepted or acted on — see `terminal::shells`.
    /// This is a *selection*, not a command line: the webview must not be able to name the program a
    /// terminal runs (ADR-PROJ-001 §5).
    #[serde(default)]
    pub terminal_shell: String,
    /// Whether a new terminal joins tmux, and whether it may create a session (ADR-PROJ-001).
    #[serde(default)]
    pub tmux_mode: TmuxMode,
    /// The session to attach. Empty means "whatever is running" for `attach`, and a default name for
    /// `attach-or-create` — see `terminal::tmux`.
    #[serde(default)]
    pub tmux_session: String,
    /// When true, closing the window hides the app to a system-tray icon instead of quitting, so it
    /// keeps running in the background (ADR-APP-021). Default `false` — a fresh app is a normal window.
    #[serde(default)]
    pub minimize_to_tray: bool,
}

/// One line of a diff, with both sides' line numbers already worked out.
///
/// `kind` is `context`, `added` or `removed`. A string rather than an enum because the frontend
/// switches on it to pick a colour and nothing else — and a `#[serde(rename_all)]` enum would arrive
/// as exactly this string anyway (the same shape `GitChange::status` already uses).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct GitDiffLine {
    pub kind: String,
    /// Line number on the old side, absent for an added line.
    pub old_line: Option<u32>,
    /// Line number on the new side, absent for a removed line.
    pub new_line: Option<u32>,
    /// The line itself, without its trailing newline.
    pub text: String,
}

/// A run of changed lines with its surrounding context.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct GitHunk {
    /// The familiar `@@ -a,b +c,d @@`, produced here so the UI does not have to assemble one.
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<GitDiffLine>,
}

/// What changed in one file, ready to draw.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct GitDiff {
    pub path: String,
    /// Where the file was before a rename, when it was renamed.
    pub old_path: Option<String>,
    /// Same vocabulary as `GitChange::status`.
    pub status: String,
    /// True when this is the staged side of the change rather than the working-tree side.
    pub staged: bool,
    /// No hunks are produced for a binary blob — there is nothing a reader could do with them.
    pub binary: bool,
    pub hunks: Vec<GitHunk>,
    pub added: u32,
    pub removed: u32,
}

/// One file's line counts inside a commit, for the file list under a commit message.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct GitFileStat {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub added: u32,
    pub removed: u32,
    pub binary: bool,
}

/// Everything about one commit — the whole message, not the summary the graph shows.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct GitCommitDetail {
    pub sha: String,
    pub short_sha: String,
    /// First line of the message.
    pub summary: String,
    /// Everything after the first line, with the blank separator removed. Empty when there is none.
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    /// RFC 3339, so the frontend formats it in the user's own locale rather than being handed a
    /// pre-formatted string it cannot re-render.
    pub authored_at: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub files: Vec<GitFileStat>,
}

/// A shell this machine offers, as presented in Settings.
///
/// The list is produced by the backend from what the operating system declares (`/etc/shells`, the
/// known Windows interpreters) plus the user's own `$SHELL`. The frontend picks *from* it; it never
/// composes a path of its own, and a value that is not on the list is refused (`terminal::shells`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ShellInfo {
    /// Absolute path to the interpreter.
    pub path: String,
    /// What to call it — the file name, which is how people say it (`zsh`, `fish`).
    pub name: String,
    /// True for the shell the user's account is configured with.
    pub is_default: bool,
}

/// What a new terminal does about tmux.
///
/// Three states rather than a boolean, because "join a session if one is running, otherwise just give
/// me a shell" and "always have a session, creating one if needed" are different wishes, and a toggle
/// can only express one of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum TmuxMode {
    /// Start the shell directly. The default: tmux is a choice, not an assumption.
    #[default]
    Off,
    /// Attach to a running session, or fall back to the shell when there is none.
    Attach,
    /// Attach to a session, creating it when it is not there.
    AttachOrCreate,
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
            terminal_shell: String::new(),
            tmux_mode: TmuxMode::Off,
            tmux_session: String::new(),
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
            terminal_shell: "/bin/zsh".into(),
            tmux_mode: TmuxMode::Off,
            tmux_session: String::new(),
            ui_scale: 1.25,
            minimize_to_tray: true,
        };
        let json = serde_json::to_string(&s).expect("serialize");
        let back: SettingsDto = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.ui_scale, 1.25);
        assert_eq!(back.terminal_shell, "/bin/zsh");
        assert!(back.minimize_to_tray);
    }

    #[test]
    fn settings_from_older_file_defaults_missing_fields() {
        // A file written before `minimize_to_tray` existed must still load without data loss.
        let s: SettingsDto = serde_json::from_str(r#"{"ui_scale":1.25}"#).expect("deserialize");
        assert_eq!(s.ui_scale, 1.25);
        assert_eq!(
            s.terminal_shell, "",
            "an older file means: the default shell"
        );
        assert!(!s.minimize_to_tray);
    }

    #[test]
    fn settings_contract_field_names_are_stable() {
        // Pin the JSON keys the generated frontend binding depends on (rule:testing contract).
        let json = serde_json::to_value(SettingsDto::default()).expect("to_value");
        assert!(json.get("ui_scale").is_some(), "ui_scale key missing");
        assert!(
            json.get("terminal_shell").is_some(),
            "terminal_shell key missing"
        );
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
