//! Shared application state held by Tauri (`tauri::Manager`).

use crate::settings::SettingsStore;
use std::path::{Path, PathBuf};

/// Process-wide state. Domain services are added here as the app grows.
pub struct AppState {
    pub settings: SettingsStore,
    /// Where this app keeps everything it writes. Held so a command can reach the themes directory
    /// without asking Tauri to resolve the path again on every call — and so a test can point the
    /// whole of it at a temporary directory (rule:testing).
    pub data_dir: PathBuf,
    /// Where the app's own bundled files live — the shipped colour schemes, today. Separate from
    /// `data_dir` because one is ours and read-only and the other is the user's.
    pub resource_dir: PathBuf,
    /// How far each transcript has been read, and what was folded out of it.
    ///
    /// **In memory only, deliberately** (ADR-PROJ-005 §3): its contents are transcript-derived, and
    /// writing them anywhere would create a second copy of the user's sessions outside Claude's own
    /// home — unbounded, undeletable, and unknown to them.
    pub chain: crate::agent::chain::cache::ChainCache,
}

impl AppState {
    pub fn new(data_dir: &Path, resource_dir: &Path) -> Self {
        Self {
            settings: SettingsStore::load(data_dir),
            data_dir: data_dir.to_path_buf(),
            resource_dir: resource_dir.to_path_buf(),
            chain: crate::agent::chain::cache::ChainCache::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_loads_settings_from_data_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = AppState::new(dir.path(), dir.path());
        // A fresh data dir yields the defaults.
        assert_eq!(state.settings.get().ui_scale, 1.0);
        assert!(!state.settings.get().minimize_to_tray);
        assert_eq!(state.data_dir, dir.path());
    }
}
