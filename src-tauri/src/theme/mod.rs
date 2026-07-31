//! Terminal colour schemes the user imported or edited.
//!
//! **The built-in HUD palette is deliberately not here.** Colour has exactly one home in this project
//! and it is the frontend (`globals.css` + `palette.ts`, rule:theming); a second copy in Rust would be
//! two sources for one fact, and they would drift the first time somebody adjusted a shade. So a
//! stored theme carries only what it actually defines, every field is optional, and the frontend fills
//! the gaps from `PALETTE`. An imported scheme that never mentions a cursor colour simply keeps the
//! HUD's — which is also the behaviour a user expects, rather than a stray black caret.
//!
//! Stored as one JSON document per theme under `<app-data>/themes/`, written atomically, for the same
//! reason settings are: a crash mid-write must not leave a half-parsed file behind.

pub mod itermcolors;

use crate::dto::TerminalTheme;
use crate::error::{AppError, Result};
use std::path::{Path, PathBuf};

/// How many ANSI colours a scheme carries. Fixed by the terminal, not by us.
const ANSI_COUNT: usize = 16;

/// Longest name we will store. Long enough for any real scheme, short enough that a name cannot be
/// used to write a large file through a small command.
const MAX_NAME: usize = 64;

/// Where themes live, under the app data directory.
pub fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("themes")
}

/// Turn a name into a filesystem-safe id.
///
/// Not a general slug: this is the only thing standing between a scheme called `../../evil` and a
/// write outside the themes directory, so it is an allow-list rather than a list of things to strip.
pub fn slug(name: &str) -> String {
    let mapped: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let collapsed = mapped
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if collapsed.is_empty() {
        "theme".to_string()
    } else {
        collapsed.chars().take(MAX_NAME).collect()
    }
}

/// Build a theme from the colours an `.itermcolors` document defined.
///
/// Anything the scheme does not mention stays `None`. See the module header: the frontend fills those
/// from the HUD palette, which is where colour lives.
pub fn from_itermcolors(name: &str, colours: &itermcolors::Colours) -> TerminalTheme {
    let get = |key: &str| colours.get(key).cloned();
    TerminalTheme {
        id: slug(name),
        name: name.chars().take(MAX_NAME).collect(),
        ansi: (0..ANSI_COUNT)
            .map(|i| get(&format!("Ansi {i} Color")))
            .collect(),
        background: get("Background Color"),
        foreground: get("Foreground Color"),
        cursor: get("Cursor Color"),
        cursor_accent: get("Cursor Text Color"),
        selection: get("Selection Color"),
        selection_foreground: get("Selected Text Color"),
    }
}

/// Read an `.itermcolors` file from disk and turn it into a theme.
///
/// The path comes from a file the user dropped on the window, so it is a path from outside: the
/// extension is checked, the size is bounded before anything is read into memory, and the contents are
/// parsed by a reader that resolves nothing (see `itermcolors`).
pub fn import(path: &Path) -> Result<TerminalTheme> {
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase());
    if extension.as_deref() != Some("itermcolors") {
        return Err(AppError::Other(format!(
            "not an iTerm2 colour scheme: {}",
            path.display()
        )));
    }

    let size = std::fs::metadata(path)
        .map_err(|e| AppError::io(path.display().to_string(), e))?
        .len();
    if size > itermcolors::MAX_BYTES as u64 {
        return Err(AppError::Other(format!(
            "colour scheme is too large ({size} bytes); a real one is a few kilobytes"
        )));
    }

    let raw =
        std::fs::read_to_string(path).map_err(|e| AppError::io(path.display().to_string(), e))?;
    let colours = itermcolors::parse(&raw)?;
    let name = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Imported".to_string());

    tracing::info!(name = %name, colours = colours.len(), "imported an iTerm2 colour scheme");
    Ok(from_itermcolors(&name, &colours))
}

/// Every theme stored on disk, by name.
///
/// A file that will not parse is logged and skipped rather than failing the list: one bad document
/// must not cost the user every other theme they have.
pub fn list(data_dir: &Path) -> Vec<TerminalTheme> {
    let mut themes = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir(data_dir)) else {
        return themes;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e.to_string_lossy().into_owned()) != Some("json".into()) {
            continue;
        }
        match std::fs::read_to_string(&path)
            .map_err(|e| AppError::io(path.display().to_string(), e))
            .and_then(|raw| Ok(serde_json::from_str::<TerminalTheme>(&raw)?))
        {
            Ok(theme) => themes.push(theme),
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "skipping an unreadable theme");
            }
        }
    }
    themes.sort_by_key(|theme| theme.name.to_lowercase());
    themes
}

/// Store a theme, replacing one with the same id.
pub fn save(data_dir: &Path, theme: &TerminalTheme) -> Result<TerminalTheme> {
    let mut theme = theme.clone();
    // The id is derived here rather than taken from the caller: it decides a filename, and a caller
    // that could choose one could choose `../settings`.
    theme.id = slug(&theme.name);
    theme.name = theme.name.chars().take(MAX_NAME).collect();
    if theme.ansi.len() != ANSI_COUNT {
        theme.ansi.resize(ANSI_COUNT, None);
    }

    let directory = dir(data_dir);
    std::fs::create_dir_all(&directory)
        .map_err(|e| AppError::io(directory.display().to_string(), e))?;
    let path = directory.join(format!("{}.json", theme.id));
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&theme)?;
    std::fs::write(&tmp, json).map_err(|e| AppError::io(tmp.display().to_string(), e))?;
    std::fs::rename(&tmp, &path).map_err(|e| AppError::io(path.display().to_string(), e))?;

    tracing::info!(id = %theme.id, name = %theme.name, "theme saved");
    Ok(theme)
}

/// Remove a stored theme. Removing one that is not there is not an error — the user's intent is
/// already satisfied.
pub fn remove(data_dir: &Path, id: &str) -> Result<()> {
    let safe = slug(id);
    let path = dir(data_dir).join(format!("{safe}.json"));
    match std::fs::remove_file(&path) {
        Ok(()) => {
            tracing::info!(id = %safe, "theme removed");
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::io(path.display().to_string(), e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn theme(name: &str) -> TerminalTheme {
        TerminalTheme {
            id: String::new(),
            name: name.to_string(),
            ansi: vec![None; ANSI_COUNT],
            background: Some("#0a0a0f".into()),
            foreground: None,
            cursor: None,
            cursor_accent: None,
            selection: None,
            selection_foreground: None,
        }
    }

    #[test]
    fn a_slug_is_an_allow_list_and_cannot_escape_the_themes_directory() {
        // The only thing between a scheme named `../../evil` and a write outside the directory.
        assert_eq!(slug("../../evil"), "evil");
        assert_eq!(slug("/etc/passwd"), "etc-passwd");
        assert_eq!(slug("..\\..\\win"), "win");
        assert_eq!(slug("Solarized Dark"), "solarized-dark");
        assert_eq!(slug("Tomorrow Night 80s"), "tomorrow-night-80s");
    }

    #[test]
    fn a_name_with_nothing_usable_in_it_still_gets_an_id() {
        assert_eq!(slug("..."), "theme");
        assert_eq!(slug(""), "theme");
        assert_eq!(slug("///"), "theme");
    }

    #[test]
    fn an_imported_scheme_keeps_only_what_it_defined() {
        // The rest is the frontend's to fill from PALETTE — a scheme with no cursor colour must not
        // arrive carrying a black one nobody chose.
        let mut colours = itermcolors::Colours::new();
        colours.insert("Ansi 1 Color".into(), "#ff0000".into());
        colours.insert("Background Color".into(), "#000000".into());

        let theme = from_itermcolors("Solarized Dark", &colours);
        assert_eq!(theme.id, "solarized-dark");
        assert_eq!(theme.name, "Solarized Dark");
        assert_eq!(theme.ansi.len(), ANSI_COUNT);
        assert_eq!(
            theme.ansi.get(1).cloned().flatten().as_deref(),
            Some("#ff0000")
        );
        assert!(theme.ansi.first().cloned().flatten().is_none());
        assert_eq!(theme.background.as_deref(), Some("#000000"));
        assert!(theme.cursor.is_none(), "not invented");
    }

    #[test]
    fn saving_then_listing_round_trips_through_disk() {
        let dir = tempfile::tempdir().expect("tempdir");
        save(dir.path(), &theme("Solarized Dark")).expect("save");
        save(dir.path(), &theme("Ayu Mirage")).expect("save");

        let listed = list(dir.path());
        let names: Vec<&str> = listed.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["Ayu Mirage", "Solarized Dark"], "sorted by name");
        assert_eq!(listed.first().map(|t| t.id.as_str()), Some("ayu-mirage"));
    }

    #[test]
    fn saving_the_same_name_twice_replaces_rather_than_duplicates() {
        let dir = tempfile::tempdir().expect("tempdir");
        save(dir.path(), &theme("Nord")).expect("save");
        let mut second = theme("Nord");
        second.background = Some("#2e3440".into());
        save(dir.path(), &second).expect("save");

        let listed = list(dir.path());
        assert_eq!(listed.len(), 1);
        assert_eq!(
            listed.first().and_then(|t| t.background.clone()).as_deref(),
            Some("#2e3440")
        );
    }

    #[test]
    fn the_id_is_derived_on_save_so_a_caller_cannot_choose_a_filename() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut hostile = theme("Nice Name");
        hostile.id = "../../settings".into();
        let saved = save(dir.path(), &hostile).expect("save");

        assert_eq!(saved.id, "nice-name");
        assert!(dir.path().join("themes/nice-name.json").is_file());
        assert!(!dir.path().join("settings.json").exists());
    }

    #[test]
    fn an_unreadable_theme_is_skipped_rather_than_costing_the_user_the_others() {
        let dir = tempfile::tempdir().expect("tempdir");
        save(dir.path(), &theme("Good")).expect("save");
        std::fs::write(super::dir(dir.path()).join("broken.json"), "{ not json").expect("write");

        let listed = list(dir.path());
        assert_eq!(listed.len(), 1);
        assert_eq!(listed.first().map(|t| t.name.as_str()), Some("Good"));
    }

    #[test]
    fn listing_a_directory_that_does_not_exist_yet_is_empty_not_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(list(dir.path()).is_empty());
    }

    #[test]
    fn removing_a_theme_that_is_not_there_is_not_a_failure() {
        let dir = tempfile::tempdir().expect("tempdir");
        remove(dir.path(), "never-existed").expect("no error");

        save(dir.path(), &theme("Gone")).expect("save");
        remove(dir.path(), "gone").expect("remove");
        assert!(list(dir.path()).is_empty());
    }

    #[test]
    fn importing_something_that_is_not_a_scheme_is_refused_by_extension_first() {
        let dir = tempfile::tempdir().expect("tempdir");
        let wrong = dir.path().join("secrets.txt");
        std::fs::write(&wrong, "not a scheme").expect("write");
        assert!(import(&wrong).is_err());
    }

    #[test]
    fn importing_a_real_scheme_reads_it_off_disk() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("Ayu Mirage.itermcolors");
        std::fs::write(
            &file,
            r#"<plist><dict>
                <key>Ansi 0 Color</key><dict>
                    <key>Red Component</key><real>0.0</real>
                    <key>Green Component</key><real>0.0</real>
                    <key>Blue Component</key><real>0.0</real>
                </dict>
            </dict></plist>"#,
        )
        .expect("write");

        let theme = import(&file).expect("import");
        assert_eq!(theme.name, "Ayu Mirage");
        assert_eq!(
            theme.ansi.first().cloned().flatten().as_deref(),
            Some("#000000")
        );
    }

    #[test]
    fn a_file_far_larger_than_any_real_scheme_is_refused_before_it_is_read() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("huge.itermcolors");
        std::fs::write(&file, vec![b'x'; itermcolors::MAX_BYTES + 1]).expect("write");
        assert!(import(&file).is_err());
    }
}
