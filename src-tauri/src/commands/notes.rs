//! The IPC surface of the notes store.
//!
//! **The frontend names a project and a topic — never a path.** The root is derived here from the
//! app's data directory, so the webview can ask to write a note but cannot say *which directory* to
//! write into. Same principle as ADR-PROJ-001 §5: the frontend must not be able to choose what runs,
//! or in this case what is written to.

use crate::dto::{NoteHit, NoteOrphan, NotesStatus};
use crate::error::{AppError, Result};
use crate::notes;
use crate::state::AppState;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// What the last sync did, for the settings panel.
///
/// In memory rather than on disk: a "last synced" that survived a restart would be describing a
/// different session, and the honest answer after a restart is "not yet this run".
static LAST: Mutex<(Option<u64>, Option<String>)> = Mutex::new((None, None));

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn root(state: &AppState) -> PathBuf {
    notes::root(&state.data_dir)
}

fn status_of(state: &AppState) -> NotesStatus {
    let settings = state.settings.get();
    let clone = notes::clone_dir(&state.data_dir);
    let (last_sync, last_error) = LAST.lock().map(|g| g.clone()).unwrap_or((None, None));
    NotesStatus {
        connected: notes::git::is_clone(&clone),
        remote: settings.notes_remote.clone(),
        branch: settings.notes_branch.clone(),
        sync: settings.notes_sync,
        path: clone.display().to_string(),
        git_available: notes::git::git_binary().is_some(),
        last_sync,
        last_error,
    }
}

/// Where the notes are kept and what the last sync said.
#[tauri::command]
pub fn notes_status(state: State<'_, AppState>) -> NotesStatus {
    status_of(&state)
}

/// Save what is configured, without connecting to anything.
///
/// **The settings panel writes here on every edit**, so what the fields show is what is stored —
/// they were local state saved only on a *successful* connect, which meant a failed attempt left
/// them looking empty while the user had just typed into them. A field that only remembers when
/// everything went well is a field that lies the one time it matters.
#[tauri::command]
pub fn notes_configure(
    state: State<'_, AppState>,
    remote: String,
    branch: String,
    sync: bool,
) -> Result<NotesStatus> {
    tracing::info!(%remote, %branch, sync, "notes_configure");
    state.settings.update(crate::settings::SettingsPatch {
        notes_remote: Some(remote),
        notes_branch: Some(branch),
        notes_sync: Some(sync),
        ..Default::default()
    })?;
    Ok(status_of(&state))
}

/// Delete the local clone, notes and all.
///
/// **Asked for explicitly, and it is the escape hatch adoption needs.** Connecting adopts whatever is
/// already in the directory rather than clobbering it, which is right — but it means a directory in a
/// state the user does not want has no way out from inside the app. This is that way out, and the UI
/// puts a confirmation in front of it naming what goes.
#[tauri::command]
pub fn notes_reset(state: State<'_, AppState>) -> Result<NotesStatus> {
    let clone = notes::clone_dir(&state.data_dir);
    tracing::info!(path = %clone.display(), "notes_reset");
    match std::fs::remove_dir_all(&clone) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(AppError::io(clone.display().to_string(), e)),
    }
    if let Ok(mut last) = LAST.lock() {
        *last = (None, None);
    }
    Ok(status_of(&state))
}

/// Point the notes at a repository that **already exists**.
///
/// The app never creates one: a creation flow would have to choose a visibility, and choosing wrong
/// is silent and permanent (ADR-PROJ-004). A remote it cannot reach comes back with git's own words,
/// which is what the settings field shows.
#[tauri::command]
pub fn notes_connect(
    state: State<'_, AppState>,
    remote: String,
    branch: String,
) -> Result<NotesStatus> {
    tracing::info!(%remote, %branch, "notes_connect");
    // Saved BEFORE the attempt, so a remote that turns out to be unreachable is still what the field
    // shows afterwards — the user typed it, and it is theirs to correct rather than to retype.
    state.settings.update(crate::settings::SettingsPatch {
        notes_remote: Some(remote.clone()),
        notes_branch: Some(branch.clone()),
        ..Default::default()
    })?;
    let clone = notes::clone_dir(&state.data_dir);
    notes::git::connect(&clone, &remote, &branch)?;
    if let Ok(mut last) = LAST.lock() {
        *last = (Some(now()), None);
    }
    tracing::info!("notes_connect ok");
    Ok(status_of(&state))
}

/// Stop syncing and keep every local note.
#[tauri::command]
pub fn notes_disconnect(state: State<'_, AppState>) -> Result<NotesStatus> {
    tracing::info!("notes_disconnect");
    state.settings.update(crate::settings::SettingsPatch {
        notes_remote: Some(String::new()),
        ..Default::default()
    })?;
    Ok(status_of(&state))
}

/// Pull, then commit and push whatever changed.
///
/// Offline is the normal case, not the error case: a failure is recorded and reported, and the notes
/// stay readable and writable regardless.
#[tauri::command]
pub fn notes_sync(state: State<'_, AppState>) -> Result<NotesStatus> {
    let settings = state.settings.get();
    if settings.notes_remote.trim().is_empty() || !settings.notes_sync {
        tracing::debug!("notes_sync skipped — local only");
        return Ok(status_of(&state));
    }
    let clone = notes::clone_dir(&state.data_dir);
    tracing::info!("notes_sync");
    let outcome = notes::git::pull(&clone)
        .and_then(|()| notes::git::push(&clone, &format!("notes: {}", now())));
    if let Ok(mut last) = LAST.lock() {
        match &outcome {
            Ok(sent) => {
                tracing::info!(sent, "notes_sync ok");
                *last = (Some(now()), None);
            }
            Err(error) => {
                // Recorded, not swallowed: this is the message the user acts on (rule:logging).
                tracing::info!(%error, "notes_sync failed");
                *last = (last.0, Some(error.to_string()));
            }
        }
    }
    Ok(status_of(&state))
}

/// Every project that has notes.
#[tauri::command]
pub fn notes_projects(state: State<'_, AppState>) -> Vec<String> {
    notes::projects(&root(&state))
}

/// The topics in one project, `inbox` first.
#[tauri::command]
pub fn notes_topics(state: State<'_, AppState>, project: String) -> Result<Vec<String>> {
    notes::topics(&root(&state), &project)
}

/// One note's markdown. A note that was never written reads as empty.
#[tauri::command]
pub fn notes_read(state: State<'_, AppState>, project: String, topic: String) -> Result<String> {
    notes::read(&root(&state), &project, &topic)
}

/// Replace one note's markdown.
#[tauri::command]
pub fn notes_write(
    state: State<'_, AppState>,
    project: String,
    topic: String,
    text: String,
) -> Result<()> {
    notes::write(&root(&state), &project, &topic, &text)
}

/// Append a captured thought to a project's inbox, as a task.
#[tauri::command]
pub fn notes_capture(state: State<'_, AppState>, project: String, text: String) -> Result<()> {
    notes::capture(&root(&state), &project, &text)
}

/// Flip the task item at `offset`. Returns whether it is now done.
#[tauri::command]
pub fn notes_toggle(
    state: State<'_, AppState>,
    project: String,
    topic: String,
    offset: u32,
) -> Result<bool> {
    notes::toggle(&root(&state), &project, &topic, offset as usize)
}

/// Delete one note.
#[tauri::command]
pub fn notes_delete(state: State<'_, AppState>, project: String, topic: String) -> Result<()> {
    notes::delete_note(&root(&state), &project, &topic)
}

/// Rename a project, keeping everything in it.
#[tauri::command]
pub fn notes_rename_project(state: State<'_, AppState>, from: String, to: String) -> Result<()> {
    notes::rename_project(&root(&state), &from, &to)
}

/// Create an empty project, so one can exist before anything has been filed into it.
///
/// The frontend could do this by writing an empty note, and deliberately does not: "a project exists"
/// and "a project has a note in it" are different states, and the tool has to be able to show the
/// first one.
#[tauri::command]
pub fn notes_create_project(state: State<'_, AppState>, project: String) -> Result<()> {
    notes::project_dir(&root(&state), &project)?;
    // An inbox, so the project has somewhere for its first capture to land and shows up in a listing
    // — a directory with no `.md` in it is not a project as far as `projects()` is concerned.
    notes::write(&root(&state), &project, notes::INBOX, "")?;
    tracing::info!(%project, "notes_create_project");
    Ok(())
}

/// Delete a whole project, with every note and image in it.
#[tauri::command]
pub fn notes_delete_project(state: State<'_, AppState>, project: String) -> Result<()> {
    notes::delete_project(&root(&state), &project)
}

/// Plain-text search across every project.
#[tauri::command]
pub fn notes_search(state: State<'_, AppState>, query: String) -> Vec<NoteHit> {
    notes::search(&root(&state), &query)
        .into_iter()
        .map(|hit| NoteHit {
            project: hit.project,
            topic: hit.topic,
            line: hit.line,
            offset: u32::try_from(hit.offset).unwrap_or(u32::MAX),
        })
        .collect()
}

/// Copy an image into a project's assets and return the note-relative path to write in the markdown.
///
/// Bytes rather than a path, because the commonest way one arrives is a paste from the clipboard,
/// which never had a path.
#[tauri::command]
pub fn notes_image_add(
    state: State<'_, AppState>,
    project: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<String> {
    let stamp = now().to_string();
    notes::images::add_bytes(&root(&state), &project, &name, &stamp, &bytes)
}

/// One image's bytes, for the renderer to show inline.
///
/// The webview cannot read a file itself — this application has no `assetProtocol` capability at all
/// — and this is what keeps it that way while still showing a screenshot (ADR-PROJ-004).
#[tauri::command]
pub fn notes_image_read(
    state: State<'_, AppState>,
    project: String,
    path: String,
) -> Result<Vec<u8>> {
    notes::images::read(&root(&state), &project, &path)
}

/// Fetch a remote image, once, because the user pressed.
///
/// Never on render: rendering `![](https://…)` from a pasted note would call a stranger's server the
/// instant the note is read, and reading a note is not consent to that (ADR-PROJ-004).
#[tauri::command]
pub async fn notes_image_fetch(url: String) -> Result<Vec<u8>> {
    notes::images::fetch_remote(&url).await
}

/// Every image no note refers to, with its size. Deletes nothing.
#[tauri::command]
pub fn notes_orphans(state: State<'_, AppState>) -> Vec<NoteOrphan> {
    notes::images::orphans(&root(&state))
        .into_iter()
        .map(|(key, bytes)| NoteOrphan {
            key,
            bytes: u32::try_from(bytes).unwrap_or(u32::MAX),
        })
        .collect()
}

/// Delete the orphaned images the user picked.
#[tauri::command]
pub fn notes_clean(state: State<'_, AppState>, keys: Vec<String>) -> Result<u32> {
    let removed = notes::images::remove(&root(&state), &keys)?;
    u32::try_from(removed).map_err(|_| AppError::Other("too many files".into()))
}
