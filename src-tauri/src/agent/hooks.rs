//! The precise attention signal: Claude Code's own hooks.
//!
//! ## Why this exists next to the bell
//!
//! The terminal bell says *something happened somewhere* and nothing else — it carries no payload,
//! and it is rung by an ambiguous completion as readily as by an agent waiting for an answer. It is
//! kept because it is the only signal that survives tmux and it works for every program.
//!
//! A hook is the opposite: it says which session, in which directory, and why. `cwd` is what matches
//! an event to a tab, so "tab 3 is asking for a permission" becomes expressible.
//!
//! ## How Claude Code learns about it
//!
//! It reads `hooks` out of `settings.json` **when a session starts**. Installing one therefore takes
//! effect in the *next* session, never the one running — which the interface has to say, or the user
//! presses the button, sees nothing change, and presses it again.
//!
//! ## What is written, and what is not
//!
//! Exactly two entries, `Notification` and `Stop`, each pointing at a script this app installed. The
//! rest of `settings.json` is read, modified in memory and written back whole — it is the user's
//! file, holding their permissions, their model choice and their own hooks, and a rewrite that lost
//! any of that would be a far worse failure than the feature is worth. A backup is written first.

use crate::error::{AppError, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// The events worth listening for.
///
/// `Notification` is the agent asking for something — a permission, an answer. `Stop` is it having
/// finished, which is the other moment you want to be told about. The rest (`PreToolUse` and
/// friends) fire constantly and would say nothing a person can act on.
const EVENTS: [&str; 2] = ["Notification", "Stop"];

/// Where the hook script appends its lines. Must match the script itself.
pub fn events_path(app_data: &Path) -> PathBuf {
    app_data.join("agent-events.jsonl")
}

/// Whether this Claude home already has our hook installed for every event.
///
/// All of them, deliberately: half-installed is a state the user cannot see and would experience as
/// "it works sometimes".
pub fn is_installed(home: &Path, script: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(home.join("settings.json")) else {
        return false;
    };
    let Ok(settings) = serde_json::from_str::<Value>(&text) else {
        return false;
    };
    EVENTS
        .iter()
        .all(|event| names_our_script(&settings, event, script))
}

/// Whether one event's entry already runs our script.
fn names_our_script(settings: &Value, event: &str, script: &Path) -> bool {
    let wanted = script.to_string_lossy();
    settings
        .get("hooks")
        .and_then(|hooks| hooks.get(event))
        .and_then(Value::as_array)
        .is_some_and(|matchers| {
            matchers.iter().any(|matcher| {
                matcher
                    .get("hooks")
                    .and_then(Value::as_array)
                    .is_some_and(|entries| {
                        entries.iter().any(|entry| {
                            entry.get("command").and_then(Value::as_str) == Some(wanted.as_ref())
                        })
                    })
            })
        })
}

/// Add our hook to a Claude home's settings, preserving everything else.
///
/// Returns the path written. The file is the user's — it holds their permissions, their model, their
/// own hooks — so it is parsed, extended and written back whole, and backed up first.
pub fn install(home: &Path, script: &Path) -> Result<PathBuf> {
    let path = home.join("settings.json");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut settings: Value = if existing.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&existing).map_err(|e| {
            // Refuse rather than replace: an unparseable settings file is somebody's problem to
            // look at, and overwriting it with a fresh one would take their configuration with it.
            AppError::Other(format!(
                "{} is not valid JSON, so it will not be rewritten: {e}",
                path.display()
            ))
        })?
    };

    if !existing.is_empty() {
        let backup = path.with_extension(format!("json.ygg-backup-{}", existing.len()));
        std::fs::write(&backup, &existing)
            .map_err(|e| AppError::io(backup.display().to_string(), e))?;
        tracing::info!(backup = %backup.display(), "backed up settings.json before adding a hook");
    }

    for event in EVENTS {
        add_hook(&mut settings, event, script);
    }

    let text = serde_json::to_string_pretty(&settings)
        .map_err(|e| AppError::Other(format!("could not serialise settings: {e}")))?;
    std::fs::write(&path, format!("{text}\n"))
        .map_err(|e| AppError::io(path.display().to_string(), e))?;
    tracing::info!(home = %home.display(), "installed the agent hooks");
    Ok(path)
}

/// Add one event's entry, leaving any hook the user already has on that event in place.
///
/// Appended rather than replacing the array: somebody else's `Stop` hook is theirs, and a feature
/// that quietly removed it would be indistinguishable from a bug in their own setup.
pub fn add_hook(settings: &mut Value, event: &str, script: &Path) {
    if names_our_script(settings, event, script) {
        return;
    }
    let entry = json!({
        "hooks": [{ "type": "command", "command": script.to_string_lossy() }]
    });

    let hooks = settings
        .as_object_mut()
        .expect("settings is an object")
        .entry("hooks")
        .or_insert_with(|| json!({}));
    let Some(hooks) = hooks.as_object_mut() else {
        return;
    };
    match hooks
        .entry(event)
        .or_insert_with(|| json!([]))
        .as_array_mut()
    {
        Some(list) => list.push(entry),
        // `hooks.Stop` is there but is not an array — somebody's hand-edit. Left exactly as it is:
        // guessing what they meant is worse than not installing.
        None => tracing::warn!(
            event,
            "the existing hook entry is not a list — leaving it alone"
        ),
    }
}

/// One event the hook recorded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentEvent {
    pub event: String,
    pub cwd: String,
    pub message: Option<String>,
}

/// How much of the end of the events file is read per poll.
///
/// **The file is append-only and nobody prunes it**, so its size is a function of how much the user
/// has worked, without limit. Reading it whole every three seconds therefore gets slower for as long
/// as the app is useful — the classic feature that degrades quietly. A tail costs the same on day one
/// and in month six.
///
/// 64 kB is many hundreds of ordinary events and still comfortably holds the last handful even when
/// a `Stop` line carries a long final message, which is what makes these lines large.
const EVENTS_TAIL_BYTES: u64 = 64 * 1024;

/// Read the events file, newest last.
///
/// Bounded twice over, and unparseable lines are skipped rather than fatal: this file is appended to
/// by a shell script running in the user's sessions, and a half-written line must cost one event
/// rather than the feature. The first line read is dropped when the file was longer than the tail —
/// half a JSON object is not an object (`agent::read_tail`, same reasoning, same trap).
pub fn read_events(path: &Path, keep: usize) -> Vec<AgentEvent> {
    let Some(text) = super::read_tail(path, EVENTS_TAIL_BYTES) else {
        return Vec::new();
    };
    let mut events: Vec<AgentEvent> = text.lines().filter_map(parse_event).collect();
    if events.len() > keep {
        events.drain(..events.len() - keep);
    }
    events
}

/// What is asking for attention **right now** — the last word per directory, never the history.
///
/// **A queue of everything that ever happened is not an attention signal.** The file is append-only
/// and keeps its contents until cleared, so reporting its contents meant reporting every turn that
/// had ever ended, for ever, until the user pressed a button. Two things follow, and both were
/// reported:
///
/// - **Only `Notification` can ask for something.** `Stop` fires at the end of every single turn; it
///   says "finished", which is the opposite of "waiting for you".
/// - **Answering makes it go away by itself.** When the user replies, the agent runs again and the
///   next event for that directory is a `Stop` — so the newest event per directory is the whole
///   state, and no "mark as seen" is needed. Clearing by hand stays possible; it is no longer the
///   only way out.
pub fn waiting_now(events: Vec<AgentEvent>) -> Vec<AgentEvent> {
    // Insertion order = file order = chronological (the script appends), so a later event for the
    // same directory simply replaces the earlier one.
    let mut latest: Vec<AgentEvent> = Vec::new();
    for event in events {
        match latest.iter_mut().find(|kept| kept.cwd == event.cwd) {
            Some(kept) => *kept = event,
            None => latest.push(event),
        }
    }
    latest.retain(|event| event.event == "Notification");
    latest
}

/// Parse one line of the events file.
pub fn parse_event(line: &str) -> Option<AgentEvent> {
    let value: Value = serde_json::from_str(line).ok()?;
    let event = value.get("hook_event_name")?.as_str()?.to_string();
    // `cwd` is the whole point: it is what matches an event to a tab. An event without one cannot be
    // placed and is worth nothing.
    let cwd = value.get("cwd")?.as_str()?.to_string();
    Some(AgentEvent {
        event,
        cwd,
        message: value
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// Forget every event recorded so far.
///
/// Called when the user has looked: the file is a queue of things not yet seen, not a log. Truncated
/// rather than deleted, so the script never has to recreate it and can keep appending.
pub fn clear(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    std::fs::write(path, "").map_err(|e| AppError::io(path.display().to_string(), e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn script() -> PathBuf {
        PathBuf::from("/Users/x/.local/bin/ygg-hook")
    }

    #[test]
    fn installing_keeps_everything_else_in_the_file() {
        // It is the user's file: their permissions, their model, their own hooks. A rewrite that
        // lost any of it would be a far worse failure than this feature is worth.
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"model":"opus","permissions":{"allow":["Bash"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"/theirs"}]}]}}"#,
        )
        .expect("write");

        install(dir.path(), &script()).expect("install");

        let after: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("settings.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(after["model"], "opus");
        assert_eq!(after["permissions"]["allow"][0], "Bash");
        // Their own Stop hook survives beside ours.
        let stop = after["hooks"]["Stop"].as_array().expect("array");
        assert_eq!(stop.len(), 2);
        assert_eq!(stop[0]["hooks"][0]["command"], "/theirs");
    }

    #[test]
    fn a_second_install_changes_nothing() {
        // The button can be pressed twice, and a duplicated hook would run the script twice per
        // event — every notification counted double.
        let dir = tempfile::tempdir().expect("tempdir");
        install(dir.path(), &script()).expect("first");
        install(dir.path(), &script()).expect("second");

        let after: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("settings.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(after["hooks"]["Notification"].as_array().unwrap().len(), 1);
        assert!(is_installed(dir.path(), &script()));
    }

    #[test]
    fn a_home_with_no_settings_at_all_gets_a_valid_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        install(dir.path(), &script()).expect("install");

        assert!(is_installed(dir.path(), &script()));
    }

    #[test]
    fn a_settings_file_that_is_not_json_is_refused_rather_than_replaced() {
        // Somebody's problem to look at. Overwriting it with a fresh one takes their configuration.
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("settings.json"), "{ this is not json").expect("write");

        assert!(install(dir.path(), &script()).is_err());
        assert!(std::fs::read_to_string(dir.path().join("settings.json"))
            .unwrap()
            .contains("this is not json"));
    }

    #[test]
    fn the_original_is_backed_up_before_it_is_touched() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("settings.json"), r#"{"model":"opus"}"#).expect("write");

        install(dir.path(), &script()).expect("install");

        let backups: Vec<_> = std::fs::read_dir(dir.path())
            .expect("read")
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("ygg-backup"))
            .collect();
        assert_eq!(backups.len(), 1);
    }

    #[test]
    fn half_installed_does_not_read_as_installed() {
        // A user who has only one of the two events would experience "it works sometimes", which is
        // the worst possible state to report as done.
        let mut settings = json!({});
        add_hook(&mut settings, "Notification", &script());

        assert!(names_our_script(&settings, "Notification", &script()));
        assert!(!names_our_script(&settings, "Stop", &script()));
    }

    #[test]
    fn an_event_is_read_with_the_directory_that_places_it() {
        // `cwd` is what matches an event to a tab — an event without one is worth nothing.
        let line = r#"{"hook_event_name":"Notification","session_id":"s","cwd":"/repo","transcript_path":"/t","message":"Claude needs your permission to use Bash","notification_type":"permission"}"#;
        let event = parse_event(line).expect("an event");

        assert_eq!(event.event, "Notification");
        assert_eq!(event.cwd, "/repo");
        assert!(event.message.as_deref().unwrap().contains("permission"));
    }

    #[test]
    fn a_stop_event_needs_no_message() {
        let line =
            r#"{"hook_event_name":"Stop","session_id":"s","cwd":"/repo","transcript_path":"/t"}"#;
        let event = parse_event(line).expect("an event");
        assert_eq!(event.event, "Stop");
        assert_eq!(event.message, None);
    }

    #[test]
    fn a_half_written_line_costs_one_event_and_not_the_feature() {
        // A shell script appends to this file from the user's own sessions.
        assert!(parse_event(r#"{"hook_event_name":"Stop","cwd"#).is_none());
        assert!(parse_event("").is_none());
        assert!(
            parse_event(r#"{"hook_event_name":"Stop"}"#).is_none(),
            "no cwd, no placement"
        );
    }

    #[test]
    fn only_the_last_events_are_kept() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("agent-events.jsonl");
        let line = r#"{"hook_event_name":"Stop","cwd":"/repo"}"#;
        std::fs::write(&path, format!("{line}\n").repeat(50)).expect("write");

        assert_eq!(read_events(&path, 10).len(), 10);
    }

    #[test]
    fn clearing_leaves_a_file_the_script_can_keep_appending_to() {
        // Deleted, the script would have to recreate it; truncated, it simply continues.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("agent-events.jsonl");
        std::fs::write(&path, "{}\n").expect("write");

        clear(&path).expect("clear");
        assert!(path.exists());
        assert!(read_events(&path, 10).is_empty());
    }

    #[test]
    fn clearing_something_that_is_not_there_is_not_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(clear(&dir.path().join("nothing.jsonl")).is_ok());
    }

    fn event(name: &str, cwd: &str) -> AgentEvent {
        AgentEvent {
            event: name.to_string(),
            cwd: cwd.to_string(),
            message: None,
        }
    }

    #[test]
    fn only_an_agent_that_wants_something_is_asking_for_attention() {
        // `Stop` fires at the end of every turn. Reporting it as "waiting for you" lights the signal
        // up permanently, and a signal that is always on has stopped being one.
        let now = waiting_now(vec![event("Stop", "/a"), event("Notification", "/b")]);

        assert_eq!(now.len(), 1);
        assert_eq!(now[0].cwd, "/b");
    }

    #[test]
    fn answering_clears_it_without_anybody_pressing_a_button() {
        // The sequence a real session produces: it asks, the user replies, it runs again and ends the
        // turn. The `Stop` is the proof that the question was answered — so the newest event per
        // directory IS the state, and "mark as seen" is not something the user should have to do.
        let now = waiting_now(vec![event("Notification", "/repo"), event("Stop", "/repo")]);

        assert!(now.is_empty(), "a directory that carried on is not waiting");
    }

    #[test]
    fn a_fresh_question_after_an_answer_asks_again() {
        let now = waiting_now(vec![
            event("Notification", "/repo"),
            event("Stop", "/repo"),
            event("Notification", "/repo"),
        ]);

        assert_eq!(now.len(), 1);
    }

    #[test]
    fn each_directory_keeps_its_own_state() {
        // Two tabs, two agents: one carried on, the other is still asking. Collapsing them would
        // either hide a real question or invent one.
        let now = waiting_now(vec![
            event("Notification", "/a"),
            event("Notification", "/b"),
            event("Stop", "/a"),
        ]);

        assert_eq!(now.len(), 1);
        assert_eq!(now[0].cwd, "/b");
    }
}
