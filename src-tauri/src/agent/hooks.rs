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
const EVENTS: [&str; 3] = ["UserPromptSubmit", "Notification", "Stop"];

/// The event that opens a turn: the user has just sent something and the agent is working on it.
///
/// **Why this exists at all.** An AI harness IS a command that runs for hours, so a terminal's own
/// "is something running" — `pane_current_command` inside tmux, OSC 133 outside it — answers *yes*
/// from the moment it starts until it exits. Correct, and useless: it says "a program is open", not
/// "it is doing something for me". This is the only signal that distinguishes the two, and it costs
/// one line per turn in a file that already holds two.
pub const TURN_START: &str = "UserPromptSubmit";

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
    /// Which KIND of notification — `permission`, `idle_prompt`, whatever the harness adds next.
    ///
    /// **Two very different things arrive as `Notification` and this is the only thing that tells
    /// them apart.** `permission` is work blocked on an answer; `idle_prompt` is the harness noticing
    /// that its prompt has sat empty — the agent finished and nobody came back. It was dropped at
    /// first, so both reached the user as one mark, wearing the harness's own wording: *"Claude is
    /// waiting for your input"*, which reads as a question and is not one. Reported by the
    /// maintainer, who could not tell from the panel whether anything was actually asked of them.
    ///
    /// `None` for a `Stop`, and for a `Notification` from a harness that does not send it.
    pub kind: Option<String>,
    /// Unix seconds, stitched in by our own hook script — the payload carries no time of its own.
    ///
    /// `None` for a line written by a script installed before this existed. Such a line is simply
    /// never aged, which is the safe direction: it keeps behaving exactly as it did.
    pub recorded_at: Option<u64>,
    /// The agent's transcript. **This is what ages an event**: if it has been written to since
    /// `recorded_at`, the agent has produced something, and whatever it was asking for is answered.
    pub transcript: Option<String>,
}

/// The `notification_type` of an idle prompt: finished and unattended, nothing asked.
///
/// The one this app keys on, and the only one it needs to name: everything else — `permission_prompt`
/// today, whatever a later harness adds — is "worth your attention", which is the safe default. Both
/// strings here are **measured** from a real events file, not taken from documentation.
pub const IDLE_PROMPT: &str = "idle_prompt";

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

/// Whether the agent in `dir` is **mid-turn** — `None` when no agent has reported from there.
///
/// The newest event per directory is the state, exactly as in [`waiting_now`]: `UserPromptSubmit`
/// opens a turn, and anything after it closes one — `Stop` because the turn ended, `Notification`
/// because the agent is blocked on an answer and is no longer working *for* you. A turn that is
/// still open is the one thing a terminal's own activity signal cannot see.
pub fn turn_state(events: Vec<AgentEvent>, dir: &str) -> Option<bool> {
    // `None` means "no agent has ever reported from this directory", which is a different answer from
    // "an agent is here and idle" — and the difference decides whether the terminal's own activity
    // signal is overridden at all. Getting it wrong makes every plain shell look permanently idle.
    let latest = newest_per_directory(events)
        .into_iter()
        .find(|event| event.cwd == dir)?;
    Some(latest.event == TURN_START)
}

/// The directories whose agent is working right now.
pub fn working_now(events: Vec<AgentEvent>) -> Vec<String> {
    newest_per_directory(events)
        .into_iter()
        .filter(|event| event.event == TURN_START)
        .map(|event| event.cwd)
        .collect()
}

/// The last event for each directory, in the order they were first seen.
fn newest_per_directory(events: Vec<AgentEvent>) -> Vec<AgentEvent> {
    // Insertion order = file order = chronological (the script appends), so a later event for the
    // same directory simply replaces the earlier one.
    let mut latest: Vec<AgentEvent> = Vec::new();
    for event in events {
        match latest.iter_mut().find(|kept| kept.cwd == event.cwd) {
            Some(kept) => *kept = event,
            None => latest.push(event),
        }
    }
    latest
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
    let mut latest = newest_per_directory(events);
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
        kind: value
            .get("notification_type")
            .and_then(Value::as_str)
            .map(str::to_string),
        recorded_at: value.get("recorded_at").and_then(Value::as_u64),
        transcript: value
            .get("transcript_path")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// How far the transcript may run past an event before the event is considered answered.
///
/// Not zero, and both reasons matter. `date +%s` truncates to the second, so an event recorded at
/// `T.9` is written down as `T` — a transcript flushed at `T.95`, *before* the prompt appeared, would
/// otherwise look like progress made after it. And the harness writes the tool call, then shows the
/// prompt, then runs the hook, so the two are only microseconds apart by design.
///
/// Two seconds is far below the time any prompt survives (a human answering) and far above the
/// ordering jitter. It errs toward keeping a mark: a signal shown a little too long is a nuisance,
/// one cleared while the agent is still blocked is the feature failing silently.
const PROGRESS_MARGIN_SECS: u64 = 2;

/// Whether the agent has carried on since this event, which makes the event answered.
///
/// **The hole this closes.** Self-clearing was built on "the next event for that directory replaces
/// this one" — and the next event is a `Stop`, which fires only at the END of a turn. A permission
/// prompt answered five minutes into a twenty-minute turn therefore sat on screen, reading "Claude
/// needs your permission", for the remaining fifteen. Measured: a notification whose transcript had
/// since been written to for **592 seconds**, still shown as current. That is exactly the "veraltet"
/// this signal exists not to be.
///
/// The transcript is the finer-grained clock the harness does not give us directly: it grows with
/// every tool call and every line of output, and it stops growing precisely while the agent is
/// blocked waiting for an answer.
///
/// `modified` is passed in so this is testable without a filesystem — and so the caller decides how
/// a missing or unreadable transcript is treated (as "no information", never as "answered").
pub fn has_moved_on(event: &AgentEvent, modified: impl Fn(&str) -> Option<u64>) -> bool {
    let (Some(recorded_at), Some(transcript)) = (event.recorded_at, event.transcript.as_deref())
    else {
        // A line from an older script, or a harness that names no transcript. Nothing to compare, so
        // nothing is claimed: the event stands until something supersedes it, as before.
        return false;
    };
    modified(transcript).is_some_and(|at| at > recorded_at + PROGRESS_MARGIN_SECS)
}

/// The mtime of `path` in unix seconds, or `None` when it cannot be read.
pub fn modified_secs(path: &str) -> Option<u64> {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

/// Whether this event is the harness saying "finished and unattended" rather than asking anything.
///
/// The distinction the UI needs and the wording cannot give it: an `idle_prompt` arrives carrying
/// *"Claude is waiting for your input"*, which reads as a question. It is not one — it is a timer
/// noticing the prompt has been empty. A `permission` event names what it wants, and is the one that
/// actually blocks.
pub fn is_idle(event: &AgentEvent) -> bool {
    event.kind.as_deref() == Some(IDLE_PROMPT)
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
        let line = r#"{"hook_event_name":"Notification","session_id":"s","cwd":"/repo","transcript_path":"/t","message":"Claude needs your permission to use Bash","notification_type":"permission_prompt"}"#;
        let event = parse_event(line).expect("an event");

        assert_eq!(event.event, "Notification");
        assert_eq!(event.cwd, "/repo");
        assert!(event.message.as_deref().unwrap().contains("permission"));
        assert_eq!(event.kind.as_deref(), Some("permission_prompt"));
    }

    #[test]
    fn an_event_the_agent_has_worked_past_is_answered() {
        // THE staleness fix. `Stop` fires only at the end of a turn, so a permission prompt answered
        // five minutes into a twenty-minute turn used to stay on screen for the remaining fifteen —
        // measured at 592 seconds of a transcript still growing behind a mark that said "needs your
        // permission". The transcript is the finer clock: it grows with every tool call, and it stops
        // growing precisely while the agent is blocked.
        let event = AgentEvent {
            event: "Notification".into(),
            cwd: "/repo".into(),
            message: Some("Claude needs your permission".into()),
            kind: Some("permission_prompt".into()),
            recorded_at: Some(1_000),
            transcript: Some("/t".into()),
        };

        assert!(has_moved_on(&event, |_| Some(1_600)), "ten minutes of work");
        assert!(!has_moved_on(&event, |_| Some(1_000)), "still blocked");
        assert!(
            !has_moved_on(&event, |_| Some(1_002)),
            "inside the margin — the harness writes the tool call, shows the prompt, then runs the \
             hook, so the two are microseconds apart and `date +%s` truncates to the second"
        );
        assert!(has_moved_on(&event, |_| Some(1_003)), "past the margin");
    }

    #[test]
    fn an_event_that_cannot_be_aged_is_left_alone() {
        // A line written by a script installed before the timestamp existed, or a transcript that has
        // been moved away. Nothing to compare, so nothing is claimed — it behaves exactly as it did
        // before, rather than being cleared on a guess (rule:no-guessing).
        let base = AgentEvent {
            event: "Notification".into(),
            cwd: "/repo".into(),
            message: None,
            kind: None,
            recorded_at: None,
            transcript: Some("/t".into()),
        };
        assert!(!has_moved_on(&base, |_| Some(9_999)), "no timestamp");

        let no_transcript = AgentEvent {
            recorded_at: Some(1),
            transcript: None,
            ..base.clone()
        };
        assert!(!has_moved_on(&no_transcript, |_| Some(9_999)));

        let gone = AgentEvent {
            recorded_at: Some(1),
            ..base
        };
        assert!(!has_moved_on(&gone, |_| None), "transcript unreadable");
    }

    #[test]
    fn the_recorded_time_and_the_transcript_survive_the_parse() {
        // Both come from OUR hook script stitching them in — the harness payload carries no time.
        let line = r#"{"recorded_at":1785615639,"hook_event_name":"Notification","cwd":"/repo","transcript_path":"/t.jsonl","message":"x","notification_type":"permission_prompt"}"#;
        let event = parse_event(line).unwrap();
        assert_eq!(event.recorded_at, Some(1_785_615_639));
        assert_eq!(event.transcript.as_deref(), Some("/t.jsonl"));
    }

    #[test]
    fn a_turn_is_open_from_the_prompt_until_something_closes_it() {
        // The signal a terminal cannot produce. A harness IS a command that runs for hours, so
        // `pane_current_command` and OSC 133 both answer "something is running" from the moment it
        // starts until it exits — correct, and useless. Only the turn boundaries say whether it is
        // doing something FOR YOU.
        let submit = event(TURN_START, "/repo");
        assert_eq!(turn_state(vec![submit.clone()], "/repo"), Some(true));

        // `Stop` ends it; so does a `Notification`, because an agent blocked on an answer has stopped
        // working for you — that state belongs to the bell, not to the activity line.
        assert_eq!(
            turn_state(vec![submit.clone(), event("Stop", "/repo")], "/repo"),
            Some(false)
        );
        assert_eq!(
            turn_state(vec![submit, event("Notification", "/repo")], "/repo"),
            Some(false)
        );
    }

    #[test]
    fn a_directory_with_no_agent_is_not_reported_as_idle() {
        // `None` and `Some(false)` are different answers and the difference decides whether the
        // terminal's own activity signal is overridden at all. Confusing them makes every plain shell
        // look permanently idle — a build running in one would show nothing.
        assert_eq!(turn_state(vec![], "/repo"), None);
        assert_eq!(turn_state(vec![event("Stop", "/other")], "/repo"), None);
    }

    #[test]
    fn only_the_newest_event_per_directory_decides() {
        // The file is append-only and nobody prunes it, so an old `UserPromptSubmit` must not keep a
        // turn open for ever — the same rule the attention signal already lives by.
        let events = vec![
            event(TURN_START, "/repo"),
            event("Stop", "/repo"),
            event(TURN_START, "/repo"),
        ];
        assert_eq!(turn_state(events, "/repo"), Some(true));
    }

    #[test]
    fn the_hook_installs_the_turn_start_event() {
        // Without it there is no "the agent began working" at all, and the activity line falls back
        // to reporting that a harness exists.
        assert!(EVENTS.contains(&TURN_START));
    }

    #[test]
    fn the_kind_of_notification_survives_the_parse() {
        // Two very different things arrive as `Notification`, and this field is the only thing that
        // separates them. Dropping it — which is what shipped — meant work blocked on an answer and a
        // prompt that had merely gone quiet reached the user as the same mark.
        let permission = r#"{"hook_event_name":"Notification","cwd":"/repo","message":"Claude needs your permission to use Bash","notification_type":"permission_prompt"}"#;
        let idle = r#"{"hook_event_name":"Notification","cwd":"/repo","message":"Claude is waiting for your input","notification_type":"idle_prompt"}"#;

        let permission = parse_event(permission).unwrap();
        let idle = parse_event(idle).unwrap();

        assert_eq!(permission.kind.as_deref(), Some("permission_prompt"));
        assert!(!is_idle(&permission), "a permission request blocks");
        assert!(is_idle(&idle), "an idle prompt asks for nothing");
    }

    #[test]
    fn a_notification_without_a_kind_is_treated_as_asking() {
        // A harness that does not send `notification_type`, or a future kind we have not met. The
        // safe default is the one that gets the user's attention: missing a real request is worse
        // than one line that turns out to have been informational.
        let line = r#"{"hook_event_name":"Notification","cwd":"/repo","message":"something"}"#;
        let event = parse_event(line).unwrap();
        assert_eq!(event.kind, None);
        assert!(!is_idle(&event));
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
            kind: None,
            recorded_at: None,
            transcript: None,
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
