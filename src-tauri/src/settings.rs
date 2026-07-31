//! Persisted user settings — a small JSON document under `<app_data_dir>/settings.json`.
//!
//! The shell has no database on purpose: settings are a handful of scalar preferences, so a single
//! JSON file (written atomically via a temp file + rename) is the honest fit. Reads are served from
//! an in-memory copy behind an `RwLock`; every write persists immediately, so a crash can never
//! lose more than the write in flight.

use crate::dto::{SettingsDto, TmuxMode};
use crate::error::{AppError, Result};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

pub const MIN_UI_SCALE: f64 = 0.7;
pub const MAX_UI_SCALE: f64 = 1.6;
/// Terminal text bounds, in CSS pixels. Below the minimum a monospace grid stops being readable at
/// all; above the maximum an 80-column line no longer fits in a sensible window.
pub const MIN_TERMINAL_FONT_SIZE: f64 = 8.0;
pub const MAX_TERMINAL_FONT_SIZE: f64 = 32.0;

/// A partial settings update: every field that is `Some` replaces the stored one.
///
/// A struct rather than a growing list of positional `Option`s — with six of them, `update(None,
/// None, Some(x), None, None, None)` says nothing about which setting `x` is, and a field inserted in
/// the middle would silently re-target every existing call.
#[derive(Debug, Default, Clone)]
pub struct SettingsPatch {
    pub ui_scale: Option<f64>,
    pub terminal_font_size: Option<f64>,
    pub terminal_shell: Option<String>,
    pub tmux_mode: Option<TmuxMode>,
    pub tmux_session: Option<String>,
    pub minimize_to_tray: Option<bool>,
}

/// Thread-safe settings store: in-memory state + the JSON file it is persisted to.
pub struct SettingsStore {
    path: PathBuf,
    current: RwLock<SettingsDto>,
}

impl SettingsStore {
    /// Load `<data_dir>/settings.json`. A missing or unreadable file yields the defaults — a
    /// corrupt settings file must never stop the app from starting; it is logged and replaced on
    /// the next write.
    pub fn load(data_dir: &Path) -> Self {
        let path = data_dir.join("settings.json");
        let current = match std::fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<SettingsDto>(&raw) {
                Ok(s) => {
                    tracing::info!(
                        path = %path.display(),
                        ui_scale = s.ui_scale,
                        minimize_to_tray = s.minimize_to_tray,
                        "settings loaded"
                    );
                    sanitize(s)
                }
                Err(e) => {
                    tracing::warn!(path = %path.display(), error = %e, "settings file unreadable — using defaults");
                    SettingsDto::default()
                }
            },
            Err(_) => {
                tracing::info!(path = %path.display(), "no settings file yet — using defaults");
                SettingsDto::default()
            }
        };
        Self {
            path,
            current: RwLock::new(current),
        }
    }

    /// Current settings snapshot.
    pub fn get(&self) -> SettingsDto {
        match self.current.read() {
            Ok(guard) => guard.clone(),
            Err(_) => SettingsDto::default(),
        }
    }

    /// Apply a partial update, persist it, and return the new state.
    ///
    /// Fails if the patch names a shell this machine does not offer — the one field here that is not
    /// a scalar preference but a program that will later be executed (rule:security).
    pub fn update(&self, patch: SettingsPatch) -> Result<SettingsDto> {
        if let Some(shell) = patch.terminal_shell.as_deref() {
            if !crate::terminal::shells::is_offered(shell) {
                tracing::warn!(%shell, "refusing a shell this machine does not offer");
                return Err(AppError::Other(format!(
                    "not a shell this machine offers: {shell}"
                )));
            }
        }
        let next = {
            let mut guard = self
                .current
                .write()
                .map_err(|_| AppError::Other("settings lock poisoned".into()))?;
            if let Some(scale) = patch.ui_scale {
                guard.ui_scale = scale.clamp(MIN_UI_SCALE, MAX_UI_SCALE);
            }
            if let Some(size) = patch.terminal_font_size {
                guard.terminal_font_size =
                    size.clamp(MIN_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE);
            }
            if let Some(shell) = patch.terminal_shell {
                guard.terminal_shell = shell.trim().to_string();
            }
            if let Some(mode) = patch.tmux_mode {
                guard.tmux_mode = mode;
            }
            if let Some(session) = patch.tmux_session {
                // Trimmed here so an accidental space cannot make a name silently different from the
                // one the user believes they typed.
                guard.tmux_session = session.trim().to_string();
            }
            if let Some(tray) = patch.minimize_to_tray {
                guard.minimize_to_tray = tray;
            }
            guard.clone()
        };
        self.persist(&next)?;
        tracing::info!(
            ui_scale = next.ui_scale,
            terminal_font_size = next.terminal_font_size,
            terminal_shell = %if next.terminal_shell.is_empty() { "<default>" } else { &next.terminal_shell },
            tmux_mode = ?next.tmux_mode,
            tmux_session = %next.tmux_session,
            minimize_to_tray = next.minimize_to_tray,
            "settings updated"
        );
        Ok(next)
    }

    /// Write the document atomically: serialise to `<file>.tmp`, then rename over the target, so a
    /// crash mid-write can never leave a half-written settings file behind.
    fn persist(&self, value: &SettingsDto) -> Result<()> {
        let json = serde_json::to_string_pretty(value)?;
        let tmp = self.path.with_extension("json.tmp");
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::io(parent.display().to_string(), e))?;
        }
        std::fs::write(&tmp, json).map_err(|e| AppError::io(tmp.display().to_string(), e))?;
        std::fs::rename(&tmp, &self.path)
            .map_err(|e| AppError::io(self.path.display().to_string(), e))?;
        Ok(())
    }
}

/// Clamp values coming from disk — a hand-edited file must not be able to push the UI to an
/// unusable zoom level.
fn sanitize(mut s: SettingsDto) -> SettingsDto {
    if !s.ui_scale.is_finite() {
        s.ui_scale = 1.0;
    }
    s.ui_scale = s.ui_scale.clamp(MIN_UI_SCALE, MAX_UI_SCALE);
    if !s.terminal_font_size.is_finite() {
        s.terminal_font_size = 13.0;
    }
    s.terminal_font_size = s
        .terminal_font_size
        .clamp(MIN_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE);
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_no_file_exists() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SettingsStore::load(dir.path());
        assert_eq!(store.get().ui_scale, 1.0);
        assert!(!store.get().minimize_to_tray);
    }

    #[test]
    fn a_shell_the_machine_does_not_offer_is_refused_and_nothing_is_persisted() {
        // The security property, at the boundary that stores it: a webview cannot smuggle a program
        // into the terminal by way of a settings write (ADR-PROJ-001 §5).
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SettingsStore::load(dir.path());
        let refused = store.update(SettingsPatch {
            terminal_shell: Some("/usr/bin/curl".into()),
            ..Default::default()
        });

        assert!(refused.is_err(), "an unoffered shell must not be storable");
        assert_eq!(store.get().terminal_shell, "");
        assert!(
            !dir.path().join("settings.json").exists(),
            "a refused update must not have written anything"
        );
    }

    #[test]
    fn a_shell_the_machine_offers_is_stored_and_survives_a_reload() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SettingsStore::load(dir.path());
        let offered = crate::terminal::shells::available();
        let pick = offered.first().expect("a machine always offers a shell");

        let next = store
            .update(SettingsPatch {
                terminal_shell: Some(pick.path.clone()),
                ..Default::default()
            })
            .expect("update");

        assert_eq!(next.terminal_shell, pick.path);
        assert_eq!(
            SettingsStore::load(dir.path()).get().terminal_shell,
            pick.path
        );
    }

    #[test]
    fn an_empty_shell_means_the_default_and_is_always_accepted() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SettingsStore::load(dir.path());
        let next = store
            .update(SettingsPatch {
                terminal_shell: Some("  ".into()),
                ..Default::default()
            })
            .expect("update");
        assert_eq!(next.terminal_shell, "");
    }

    #[test]
    fn update_persists_and_reloads() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SettingsStore::load(dir.path());
        let next = store
            .update(SettingsPatch {
                ui_scale: Some(1.25),
                ..Default::default()
            })
            .expect("update");
        assert_eq!(next.ui_scale, 1.25);

        let reloaded = SettingsStore::load(dir.path());
        assert_eq!(reloaded.get().ui_scale, 1.25);
        assert!(dir.path().join("settings.json").is_file());
    }

    #[test]
    fn ui_scale_is_clamped_on_write_and_read() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SettingsStore::load(dir.path());
        let high = store
            .update(SettingsPatch {
                ui_scale: Some(9.0),
                ..Default::default()
            })
            .expect("update");
        assert_eq!(high.ui_scale, MAX_UI_SCALE);
        let low = store
            .update(SettingsPatch {
                ui_scale: Some(0.1),
                ..Default::default()
            })
            .expect("update");
        assert_eq!(low.ui_scale, MIN_UI_SCALE);

        std::fs::write(dir.path().join("settings.json"), r#"{"ui_scale":42.0}"#).expect("write");
        assert_eq!(SettingsStore::load(dir.path()).get().ui_scale, MAX_UI_SCALE);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("settings.json"), "not json at all").expect("write");
        assert_eq!(SettingsStore::load(dir.path()).get().ui_scale, 1.0);
    }

    #[test]
    fn minimize_to_tray_persists_and_reloads() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SettingsStore::load(dir.path());
        assert!(!store.get().minimize_to_tray);
        let next = store
            .update(SettingsPatch {
                minimize_to_tray: Some(true),
                ..Default::default()
            })
            .expect("update");
        assert!(next.minimize_to_tray);
        assert!(SettingsStore::load(dir.path()).get().minimize_to_tray);
    }

    #[test]
    fn older_file_without_tray_field_loads_with_default() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("settings.json"), r#"{"ui_scale":1.25}"#).expect("write");
        let s = SettingsStore::load(dir.path()).get();
        assert_eq!(s.ui_scale, 1.25);
        assert!(!s.minimize_to_tray);
    }
}

#[cfg(test)]
mod font_size_tests {
    use super::*;

    #[test]
    fn the_terminal_font_size_is_its_own_setting() {
        // The whole point: changing one must not move the other. If these ever share a value, the
        // "independent" in the settings copy becomes a lie.
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SettingsStore::load(dir.path());

        store
            .update(SettingsPatch {
                ui_scale: Some(1.25),
                ..Default::default()
            })
            .expect("scale");
        assert_eq!(store.get().terminal_font_size, 13.0, "text size untouched");

        store
            .update(SettingsPatch {
                terminal_font_size: Some(18.0),
                ..Default::default()
            })
            .expect("size");
        assert_eq!(store.get().ui_scale, 1.25, "ui scale untouched");
        assert_eq!(store.get().terminal_font_size, 18.0);
    }

    #[test]
    fn an_unusable_font_size_is_clamped_not_stored() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SettingsStore::load(dir.path());

        assert_eq!(
            store
                .update(SettingsPatch {
                    terminal_font_size: Some(400.0),
                    ..Default::default()
                })
                .expect("high")
                .terminal_font_size,
            MAX_TERMINAL_FONT_SIZE
        );
        assert_eq!(
            store
                .update(SettingsPatch {
                    terminal_font_size: Some(0.0),
                    ..Default::default()
                })
                .expect("low")
                .terminal_font_size,
            MIN_TERMINAL_FONT_SIZE
        );
    }

    #[test]
    fn a_hand_edited_file_cannot_make_the_terminal_unreadable() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            dir.path().join("settings.json"),
            br#"{"ui_scale":1.0,"terminal_font_size":9999,"minimize_to_tray":false}"#,
        )
        .expect("write");

        let store = SettingsStore::load(dir.path());
        assert_eq!(store.get().terminal_font_size, MAX_TERMINAL_FONT_SIZE);
    }
}
