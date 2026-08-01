//! Terminal profiles: a named set of overrides for what a tab starts as.
//!
//! **A profile is a reference, never a command line** (ADR-PROJ-001 §5). `terminal_open` takes a
//! profile *id*; the backend is what turns that into a program. The webview naming a profile is a
//! webview choosing between things the backend already agreed to; a webview naming a program is a
//! webview that can run anything the user's account can, and those are not the same thing however
//! similar the code would look.
//!
//! **Everything in a profile is an override, and the Settings are the defaults.** There is no separate
//! "default profile" document to keep in step: a profile that sets only a theme takes its shell and
//! its tmux behaviour from Settings, and changing Settings changes it. A second copy of those values
//! would be two sources for one fact (ADR-CORE-005) and would drift the first time someone edited one.
//!
//! Stored like themes — one atomically written JSON document each, under `<app-data>/profiles/`.

use crate::dto::TerminalProfile;
use crate::error::{AppError, Result};
use std::path::{Path, PathBuf};

/// Longest name we will store, and the bound on a working directory a profile may carry.
const MAX_NAME: usize = 64;

/// Where profiles live, under the app data directory.
pub fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("profiles")
}

/// Every profile stored on disk, by name.
///
/// One unreadable document is logged and skipped rather than costing the user every other profile.
pub fn list(data_dir: &Path) -> Vec<TerminalProfile> {
    let mut profiles = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir(data_dir)) else {
        return profiles;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e.to_string_lossy().into_owned()) != Some("json".into()) {
            continue;
        }
        match std::fs::read_to_string(&path)
            .map_err(|e| AppError::io(path.display().to_string(), e))
            .and_then(|raw| Ok(serde_json::from_str::<TerminalProfile>(&raw)?))
        {
            Ok(profile) => profiles.push(profile),
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "skipping an unreadable profile");
            }
        }
    }
    profiles.sort_by_key(|profile| profile.name.to_lowercase());
    profiles
}

/// One profile by id, or `None` when there is no such profile.
///
/// `None` is not a failure: a tab can name a profile the user has since deleted, and the honest
/// answer is to start a terminal from the Settings defaults rather than to refuse to open one.
pub fn get(data_dir: &Path, id: &str) -> Option<TerminalProfile> {
    let safe = crate::theme::slug(id);
    list(data_dir).into_iter().find(|p| p.id == safe)
}

/// Store a profile, replacing one with the same id.
///
/// The shell is validated here, against the same list Settings is checked against: a profile is
/// another way to name a program that will be executed, and it must not be a way around that check
/// (rule:security).
pub fn save(data_dir: &Path, profile: &TerminalProfile) -> Result<TerminalProfile> {
    let mut profile = profile.clone();
    // Derived, never accepted: the id decides a filename.
    profile.id = crate::theme::slug(&profile.name);
    profile.name = profile.name.chars().take(MAX_NAME).collect();

    if let Some(shell) = profile.shell.as_deref() {
        if !crate::terminal::shells::is_offered(shell) {
            tracing::warn!(%shell, "refusing a profile naming a shell this machine does not offer");
            return Err(AppError::Other(format!(
                "not a shell this machine offers: {shell}"
            )));
        }
    }
    // An empty override is no override. Stored as `None` so "use the default" has one representation
    // rather than two that behave the same but compare differently.
    profile.shell = profile.shell.filter(|s| !s.trim().is_empty());
    profile.theme = profile.theme.filter(|s| !s.trim().is_empty());
    profile.cwd = profile
        .cwd
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty());

    let directory = dir(data_dir);
    std::fs::create_dir_all(&directory)
        .map_err(|e| AppError::io(directory.display().to_string(), e))?;
    let path = directory.join(format!("{}.json", profile.id));
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&profile)?;
    std::fs::write(&tmp, json).map_err(|e| AppError::io(tmp.display().to_string(), e))?;
    std::fs::rename(&tmp, &path).map_err(|e| AppError::io(path.display().to_string(), e))?;

    tracing::info!(id = %profile.id, name = %profile.name, "profile saved");
    Ok(profile)
}

/// Remove a stored profile. Removing one that is not there is not an error.
pub fn remove(data_dir: &Path, id: &str) -> Result<()> {
    let safe = crate::theme::slug(id);
    let path = dir(data_dir).join(format!("{safe}.json"));
    match std::fs::remove_file(&path) {
        Ok(()) => {
            tracing::info!(id = %safe, "profile removed");
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::io(path.display().to_string(), e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(name: &str) -> TerminalProfile {
        TerminalProfile {
            id: String::new(),
            name: name.to_string(),
            shell: None,
            cwd: None,
            theme: None,
            tmux: None,
        }
    }

    #[test]
    fn saving_then_listing_round_trips_and_sorts_by_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        save(dir.path(), &profile("Work")).expect("save");
        save(dir.path(), &profile("Ad hoc")).expect("save");

        let names: Vec<String> = list(dir.path()).into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["Ad hoc", "Work"]);
    }

    #[test]
    fn the_id_is_derived_so_a_caller_cannot_choose_a_filename() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut hostile = profile("Nice");
        hostile.id = "../../settings".into();
        let saved = save(dir.path(), &hostile).expect("save");

        assert_eq!(saved.id, "nice");
        assert!(dir.path().join("profiles/nice.json").is_file());
        assert!(!dir.path().join("settings.json").exists());
    }

    #[test]
    fn a_profile_naming_a_shell_this_machine_does_not_offer_is_refused() {
        // A profile must not be a way around the check Settings makes (ADR-PROJ-001 §5).
        let dir = tempfile::tempdir().expect("tempdir");
        let mut hostile = profile("Sneaky");
        hostile.shell = Some("/usr/bin/curl".into());

        assert!(save(dir.path(), &hostile).is_err());
        assert!(list(dir.path()).is_empty());
    }

    #[test]
    fn a_profile_naming_a_shell_this_machine_does_offer_is_stored() {
        let dir = tempfile::tempdir().expect("tempdir");
        let offered = crate::terminal::shells::available();
        let pick = offered.first().expect("a machine always offers a shell");

        let mut allowed = profile("Fish");
        allowed.shell = Some(pick.path.clone());
        let saved = save(dir.path(), &allowed).expect("save");

        assert_eq!(saved.shell.as_deref(), Some(pick.path.as_str()));
    }

    #[test]
    fn an_empty_override_is_stored_as_no_override_at_all() {
        // "Use the default" must have one representation, or two profiles that behave identically
        // would compare as different.
        let dir = tempfile::tempdir().expect("tempdir");
        let mut blanks = profile("Blanks");
        blanks.shell = Some("   ".into());
        blanks.theme = Some("".into());
        blanks.cwd = Some("  ".into());

        let saved = save(dir.path(), &blanks).expect("save");
        assert!(saved.shell.is_none());
        assert!(saved.theme.is_none());
        assert!(saved.cwd.is_none());
    }

    #[test]
    fn a_profile_that_was_deleted_reads_as_absent_rather_than_as_an_error() {
        // A tab can name a profile the user has since removed; the honest answer is to start from the
        // Settings defaults, not to refuse to open a terminal.
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(get(dir.path(), "never-existed").is_none());

        save(dir.path(), &profile("Gone")).expect("save");
        assert!(get(dir.path(), "gone").is_some());
        remove(dir.path(), "gone").expect("remove");
        assert!(get(dir.path(), "gone").is_none());
    }

    #[test]
    fn getting_a_profile_by_a_hostile_id_cannot_reach_outside_the_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        save(dir.path(), &profile("Work")).expect("save");
        assert!(
            get(dir.path(), "../../work").is_some(),
            "slugged, then matched"
        );
        assert!(get(dir.path(), "/etc/passwd").is_none());
    }

    #[test]
    fn an_unreadable_profile_is_skipped_rather_than_costing_the_user_the_others() {
        let dir = tempfile::tempdir().expect("tempdir");
        save(dir.path(), &profile("Good")).expect("save");
        std::fs::write(super::dir(dir.path()).join("broken.json"), "{ nope").expect("write");

        assert_eq!(list(dir.path()).len(), 1);
    }
}
