//! The chain: what the agent in this tab is doing, and how it is going.
//!
//! ## One reader, two layers
//!
//! The **trace** (what happened) and the **plan** (what was intended) both come out of the same file
//! in the same pass. That is not an optimisation — `mem:surfaces` requires it: *"one reader with two
//! renderings, **never two readers"***. The obvious second reader would be the task store at
//! `<home>/tasks/<session>/`, and it is the lossy one: measured, it is **cleared the moment nothing
//! is open**, so a finished plan and a plan that never existed look identical there. The transcript
//! keeps `TaskCreate`/`TaskUpdate` either way, which is what tells "done" from "absent".
//!
//! ## Nothing read here is ever logged
//!
//! ADR-PROJ-005 §1. The transcript carries every prompt, every command, every file written — the
//! same data class ADR-PROJ-001 §6 keeps out of the log for the terminal. Counters, classifications
//! and offsets may be logged; a command, a path, a task subject or a tool result may not, at any
//! level. Errors carry an offset, never content.
//!
//! ## And it cannot panic
//!
//! Every extraction is an `Option`. An unknown shape yields *less*, never an error — because a panic
//! would route the content into the crash report and defeat the rule above.

pub mod cache;
pub mod classify;
pub mod fold;
pub mod levels;
pub mod model;

use model::{Act, Chain, ChainLink, PlanStep, Round, Step};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

/// How much of a transcript is read in one pass when there is no cached offset.
///
/// A live session was measured at **26 MB**. This is the cold-start cost, paid once per session per
/// app run, and it is why the tool shows a loading state rather than blocking (rule:ui-design).
const MAX_TRANSCRIPT_BYTES: u64 = 64 * 1024 * 1024;

/// The harness versions this reader has been verified against.
///
/// Not a compatibility check — the reader degrades on anything. It is what lets the tool **say** it
/// is on unproven ground instead of quietly showing a shorter chain, which is indistinguishable
/// from a genuinely shorter one (ADR-PROJ-005, chain-tool.md §Format drift).
const VERIFIED_VERSIONS: &[&str] = &["2.1.220", "2.1.223"];

/// Whether this reader has been checked against the version that wrote the transcript.
pub fn version_is_verified(version: Option<&str>) -> bool {
    version.is_some_and(|v| VERIFIED_VERSIONS.contains(&v))
}

/// Everything parsed out of one transcript, before folding.
#[derive(Debug, Default)]
pub struct Parsed {
    pub steps: Vec<Step>,
    pub plan: Vec<PlanStep>,
    pub session_id: Option<String>,
    pub harness_version: Option<String>,
    pub seen: u32,
    pub understood: u32,
    /// Byte offset one past the last complete line consumed.
    pub offset: u64,
}

/// Read a transcript and classify everything in it.
///
/// `from` is the byte offset a previous pass stopped at; the caller is responsible for having
/// validated that the file is still the same one (see `state::ChainCache`). Passing `0` re-reads
/// from the beginning, which is always correct — the reader is idempotent by design, because a
/// command that returned a *delta* would be destructive on call and this frontend loses deltas four
/// different ways (StrictMode, retry, remount, two tabs).
pub fn parse_transcript(path: &Path, from: u64) -> Parsed {
    let mut out = Parsed {
        offset: from,
        ..Default::default()
    };
    let Some(text) = read_from(path, from) else {
        return out;
    };
    out.offset = from + text.len() as u64;

    // `TaskCreate` gives a subject; its id comes back in the tool result. Matched by tool-use id so
    // the plan survives interleaved calls.
    let mut pending_subjects: HashMap<String, String> = HashMap::new();

    for line in text.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            // A half-written line, or a shape we do not know. Costs one line, never the feature.
            continue;
        };
        if out.session_id.is_none() {
            out.session_id = str_at(&value, "sessionId");
        }
        if out.harness_version.is_none() {
            out.harness_version = str_at(&value, "version");
        }

        let timestamp = str_at(&value, "timestamp");
        let content = value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array);

        let Some(parts) = content else { continue };
        for part in parts {
            match str_at(part, "type").as_deref() {
                Some("tool_use") => {
                    out.seen += 1;
                    let Some(name) = str_at(part, "name") else {
                        continue;
                    };
                    let input = part.get("input");
                    let command = input.and_then(|i| i.get("command")).and_then(Value::as_str);
                    let file = input
                        .and_then(|i| i.get("file_path"))
                        .and_then(Value::as_str);

                    let step = classify::classify(&name, command, file).at(timestamp.clone());
                    if step.recognised {
                        out.understood += 1;
                    }

                    // Plan bookkeeping, captured on the way past.
                    if name == "TaskCreate" {
                        if let (Some(id), Some(subject)) = (
                            str_at(part, "id"),
                            input.and_then(|i| i.get("subject")).and_then(Value::as_str),
                        ) {
                            pending_subjects.insert(id, subject.to_string());
                        }
                    } else if name == "TaskUpdate" {
                        apply_update(&mut out.plan, input);
                    }
                    out.steps.push(step);
                }
                Some("tool_result") => {
                    if let Some(id) = str_at(part, "tool_use_id") {
                        if let Some(subject) = pending_subjects.remove(&id) {
                            let task_id = created_id(part)
                                .unwrap_or_else(|| (out.plan.len() + 1).to_string());
                            out.plan.push(PlanStep {
                                id: task_id,
                                subject,
                                status: "pending".into(),
                                blocked_by: Vec::new(),
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }
    out
}

/// Apply one `TaskUpdate` to the reconstructed plan.
fn apply_update(plan: &mut [PlanStep], input: Option<&Value>) {
    let Some(input) = input else { return };
    let Some(id) = input.get("taskId").and_then(Value::as_str) else {
        return;
    };
    let Some(step) = plan.iter_mut().find(|s| s.id == id) else {
        return;
    };
    if let Some(status) = input.get("status").and_then(Value::as_str) {
        step.status = status.to_string();
    }
    if let Some(subject) = input.get("subject").and_then(Value::as_str) {
        step.subject = subject.to_string();
    }
    if let Some(blocked) = input.get("addBlockedBy").and_then(Value::as_array) {
        for entry in blocked {
            if let Some(other) = entry.as_str() {
                step.blocked_by.push(other.to_string());
            }
        }
    }
}

/// `Task #7 created successfully: …` → `7`.
///
/// Read rather than counted, because the harness resumes numbering from a high-water mark after it
/// clears a finished list — so the nth task of a session is not necessarily id `n`.
fn created_id(part: &Value) -> Option<String> {
    let text = part.get("content").and_then(Value::as_str)?;
    let rest = text.split_once('#')?.1;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    (!digits.is_empty()).then_some(digits)
}

/// A string field, or `None` — never a panic, never a default that could be mistaken for data.
fn str_at(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

/// Read a file from `offset` to its end, starting at a line boundary.
///
/// Returns `None` when the file cannot be read at all, and an empty string when there is nothing
/// new — the caller must be able to tell "no new work" from "no session".
fn read_from(path: &Path, offset: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    if offset >= len {
        return Some(String::new());
    }
    if len - offset > MAX_TRANSCRIPT_BYTES {
        // Not silent: the chain will be short, and the coverage figure is what says so.
        tracing::debug!(
            bytes = len - offset,
            "transcript exceeds the read budget; reading its tail only"
        );
    }
    let start = len.saturating_sub(MAX_TRANSCRIPT_BYTES).max(offset);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut raw = Vec::new();
    file.read_to_end(&mut raw).ok()?;
    let mut text = String::from_utf8_lossy(&raw).into_owned();
    if start > 0 && offset == 0 {
        // Dropped rather than parsed: half a JSON object is not an object.
        let cut = text.find('\n').map_or(text.len(), |at| at + 1);
        text = text.split_off(cut);
    }
    Some(text)
}

/// Read the chain for one tab, resuming from the cache where the file allows it.
///
/// `None` when no agent has run in this directory — not a failure, and the common case.
pub fn read(home: &Path, cwd: &Path, store: &cache::ChainCache) -> Option<Chain> {
    let transcript = super::newest_transcript(home, cwd)?;

    let (from, mut steps) = match store.resume(&transcript) {
        cache::Resume::From(offset, kept) => (offset, kept),
        cache::Resume::Fresh => (0, Vec::new()),
    };
    let mut parsed = parse_transcript(&transcript, from);
    // Delegated work lives in a sibling directory the transcript never mentions again.
    let delegated = delegated_steps(&transcript);

    steps.append(&mut parsed.steps);
    store.store(&transcript, parsed.offset, &steps);
    parsed.steps = steps;
    parsed.seen += delegated;
    parsed.understood += delegated;

    let declaration = levels::Levels::load(cwd);
    let mut chain = assemble(parsed, &home.to_string_lossy(), declaration.as_ref());
    // Every delegated link says how much work it is hiding, so a gap in the record cannot be
    // mistaken for nothing having happened (chain-tool.md C3).
    for link in &mut chain.links {
        if link.kind == model::Kind::Delegated && delegated > 0 {
            link.steps = delegated;
        }
    }
    Some(chain)
}

/// How many tool calls the subagents of this session made.
///
/// **Measured: 1.17 MB across four files for one session of this repository, against five `Agent`
/// calls in the main transcript.** `rule:agent-delegation` makes fan-out the default, so without
/// this the chain would be emptiest in exactly the sessions that follow the house rules.
///
/// Counted rather than folded in: the sub-chains belong under their own link, which is a second
/// step. What must not happen first is that the work looks like it never occurred.
fn delegated_steps(transcript: &Path) -> u32 {
    let Some(stem) = transcript.file_stem() else {
        return 0;
    };
    let dir = match transcript.parent() {
        Some(parent) => parent.join(stem).join("subagents"),
        None => return 0,
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return 0;
    };
    let mut total = 0u32;
    for entry in entries.flatten().take(64) {
        let path = entry.path();
        if path.extension().is_none_or(|e| e != "jsonl") {
            continue;
        }
        total = total.saturating_add(parse_transcript(&path, 0).seen);
    }
    total
}

/// What tends to follow the last act, from this session's own history.
///
/// **An observation, never a plan.** The interface draws it differently for exactly that reason.
pub fn expectation(links: &[ChainLink]) -> Vec<Round> {
    let Some(last) = links.last() else {
        return Vec::new();
    };
    let mut counts: HashMap<Act, u32> = HashMap::new();
    for pair in links.windows(2) {
        if pair[0].act == last.act {
            *counts.entry(pair[1].act).or_insert(0) += 1;
        }
    }
    let mut ranked: Vec<(Act, u32)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    ranked
        .into_iter()
        .take(3)
        .map(|(act, seen)| Round {
            act,
            refinement: Some(format!("{seen}")),
        })
        .collect()
}

/// Build the chain a tab should show.
pub fn assemble(parsed: Parsed, home: &str, declaration: Option<&levels::Levels>) -> Chain {
    let elapsed = parsed
        .steps
        .first()
        .and_then(|s| s.at.clone())
        .and_then(|first| {
            parsed
                .steps
                .last()
                .and_then(|s| s.at.clone())
                .map(|last| (first, last))
        })
        .map_or(0, |(a, b)| seconds_between(&a, &b));

    let mut links = fold::fold(parsed.steps);
    if let Some(levels) = declaration {
        for link in &mut links {
            levels.apply(link);
        }
    }
    let expected = expectation(&links);
    let plan_done = !parsed.plan.is_empty() && parsed.plan.iter().all(|s| s.status == "completed");

    Chain {
        links,
        plan: parsed.plan,
        plan_done,
        expected,
        elapsed,
        steps_seen: parsed.seen,
        steps_understood: parsed.understood,
        home: home.to_string(),
        session_id: parsed.session_id,
        harness_version: parsed.harness_version,
    }
}

fn seconds_between(from: &str, to: &str) -> u64 {
    let parse = |s: &str| chrono::DateTime::parse_from_rfc3339(s).ok();
    match (parse(from), parse(to)) {
        (Some(a), Some(b)) => (b - a).num_seconds().max(0) as u64,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shapes taken from a real transcript, trimmed to the fields this reader uses.
    const TRANSCRIPT: &str = r#"{"type":"assistant","sessionId":"abc","version":"2.1.223","timestamp":"2026-08-06T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"cargo test --locked"}}]}}
{"type":"assistant","sessionId":"abc","version":"2.1.223","timestamp":"2026-08-06T12:01:00.000Z","message":{"content":[{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"/repo/src/lib.rs"}}]}}
{"type":"assistant","sessionId":"abc","version":"2.1.223","timestamp":"2026-08-06T12:02:00.000Z","message":{"content":[{"type":"tool_use","id":"t3","name":"Bash","input":{"command":"cargo test --locked"}}]}}
"#;

    fn write(dir: &std::path::Path, name: &str, body: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, body).expect("write");
        path
    }

    #[test]
    fn a_transcript_becomes_classified_steps() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "t.jsonl", TRANSCRIPT);

        let parsed = parse_transcript(&path, 0);

        assert_eq!(parsed.steps.len(), 3);
        assert_eq!(parsed.steps[0].act, Act::Verify);
        assert_eq!(parsed.steps[1].act, Act::Build);
        assert_eq!(parsed.session_id.as_deref(), Some("abc"));
        assert_eq!(parsed.harness_version.as_deref(), Some("2.1.223"));
        assert_eq!(parsed.seen, 3);
        assert_eq!(parsed.understood, 3);
    }

    #[test]
    fn reading_twice_from_zero_gives_the_same_answer() {
        // The invariant that makes the whole thing safe: StrictMode double-mounts, `retry: 3` is the
        // default, a tool switch remounts, and two tabs on one repo poll the same file. A delta
        // command loses work in all four; an idempotent one cannot.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "t.jsonl", TRANSCRIPT);

        let a = parse_transcript(&path, 0);
        let b = parse_transcript(&path, 0);
        assert_eq!(a.steps, b.steps);
        assert_eq!(a.offset, b.offset);
    }

    #[test]
    fn continuing_from_an_offset_reads_only_what_is_new() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "t.jsonl", TRANSCRIPT);
        let first = parse_transcript(&path, 0);

        let more = format!(
            "{TRANSCRIPT}{}",
            r#"{"type":"assistant","timestamp":"2026-08-06T12:03:00.000Z","message":{"content":[{"type":"tool_use","id":"t4","name":"Bash","input":{"command":"git push"}}]}}
"#
        );
        std::fs::write(&path, more).expect("append");

        let second = parse_transcript(&path, first.offset);
        assert_eq!(second.steps.len(), 1, "only the new line");
        assert_eq!(second.steps[0].act, Act::Ship);
    }

    #[test]
    fn nothing_new_is_an_empty_read_and_not_a_failure() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "t.jsonl", TRANSCRIPT);
        let first = parse_transcript(&path, 0);

        let again = parse_transcript(&path, first.offset);
        assert!(again.steps.is_empty());
        assert_eq!(again.offset, first.offset);
    }

    #[test]
    fn a_missing_transcript_yields_nothing_rather_than_an_error() {
        let parsed = parse_transcript(std::path::Path::new("/nowhere/at/all.jsonl"), 0);
        assert!(parsed.steps.is_empty());
    }

    #[test]
    fn a_half_written_line_costs_one_line_and_not_the_feature() {
        let dir = tempfile::tempdir().expect("tempdir");
        let body = format!("{{\"type\":\"assist\n{TRANSCRIPT}");
        let path = write(dir.path(), "t.jsonl", &body);

        assert_eq!(parse_transcript(&path, 0).steps.len(), 3);
    }

    #[test]
    fn the_plan_is_reconstructed_from_the_transcript() {
        // C2: the store is cleared the moment nothing is open, so a finished plan and a plan that
        // never existed look identical there. The transcript keeps both halves.
        let dir = tempfile::tempdir().expect("tempdir");
        let body = r#"{"type":"assistant","timestamp":"2026-08-06T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"c1","name":"TaskCreate","input":{"subject":"verify@local: prove the reader"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"c1","content":"Task #4 created successfully: verify@local: prove the reader"}]}}
{"type":"assistant","timestamp":"2026-08-06T12:01:00.000Z","message":{"content":[{"type":"tool_use","id":"u1","name":"TaskUpdate","input":{"taskId":"4","status":"completed"}}]}}
"#;
        let path = write(dir.path(), "t.jsonl", body);

        let parsed = parse_transcript(&path, 0);
        assert_eq!(parsed.plan.len(), 1);
        assert_eq!(
            parsed.plan[0].id, "4",
            "the id comes from the result, not a count"
        );
        assert_eq!(parsed.plan[0].status, "completed");
    }

    #[test]
    fn bookkeeping_does_not_become_chain_links() {
        let dir = tempfile::tempdir().expect("tempdir");
        let body = r#"{"type":"assistant","timestamp":"2026-08-06T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"c1","name":"TaskCreate","input":{"subject":"x"}}]}}
{"type":"assistant","timestamp":"2026-08-06T12:01:00.000Z","message":{"content":[{"type":"tool_use","id":"b1","name":"Bash","input":{"command":"cargo test"}}]}}
"#;
        let path = write(dir.path(), "t.jsonl", body);

        let chain = assemble(parse_transcript(&path, 0), "/home/.claude", None);
        assert_eq!(chain.links.len(), 1);
        assert_eq!(chain.links[0].act, Act::Verify);
    }

    #[test]
    fn a_finished_plan_is_marked_done_rather_than_reported_absent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let body = r#"{"type":"assistant","timestamp":"2026-08-06T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"c1","name":"TaskCreate","input":{"subject":"x"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"c1","content":"Task #1 created successfully: x"}]}}
{"type":"assistant","timestamp":"2026-08-06T12:01:00.000Z","message":{"content":[{"type":"tool_use","id":"u1","name":"TaskUpdate","input":{"taskId":"1","status":"completed"}}]}}
"#;
        let path = write(dir.path(), "t.jsonl", body);

        let chain = assemble(parse_transcript(&path, 0), "/h", None);
        assert!(chain.plan_done, "finished, not absent");
        assert_eq!(chain.plan.len(), 1);
    }

    #[test]
    fn the_elapsed_time_spans_the_whole_session() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "t.jsonl", TRANSCRIPT);

        let chain = assemble(parse_transcript(&path, 0), "/h", None);
        assert_eq!(chain.elapsed, 120);
    }

    #[test]
    fn coverage_is_reported_so_a_short_chain_can_be_told_from_a_misread_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let body = r#"{"type":"assistant","timestamp":"2026-08-06T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"a","name":"Bash","input":{"command":"cargo test"}}]}}
{"type":"assistant","timestamp":"2026-08-06T12:01:00.000Z","message":{"content":[{"type":"tool_use","id":"b","name":"Bash","input":{"command":"someunknownthing --flag"}}]}}
"#;
        let path = write(dir.path(), "t.jsonl", body);

        let parsed = parse_transcript(&path, 0);
        assert_eq!(parsed.seen, 2);
        assert_eq!(
            parsed.understood, 1,
            "the unknown program is counted honestly"
        );
    }

    #[test]
    fn an_unverified_harness_version_is_recognised_as_such() {
        assert!(version_is_verified(Some("2.1.223")));
        assert!(!version_is_verified(Some("9.9.9")));
        assert!(!version_is_verified(None));
    }

    #[test]
    fn the_expectation_comes_from_this_sessions_own_edges() {
        // An observation about what this agent has actually been doing, never a plan — which is why
        // the count rides along and the interface draws it dashed.
        let links = vec![
            stub(Act::Verify),
            stub(Act::Ship),
            stub(Act::Verify),
            stub(Act::Ship),
            stub(Act::Verify),
        ];
        let expected = expectation(&links);

        assert_eq!(expected.first().map(|r| r.act), Some(Act::Ship));
        assert_eq!(
            expected[0].refinement.as_deref(),
            Some("2"),
            "twice, and the number is what makes it an observation rather than a claim"
        );
    }

    #[test]
    fn an_empty_chain_expects_nothing_rather_than_guessing() {
        assert!(expectation(&[]).is_empty());
        assert!(expectation(&[stub(Act::Verify)]).is_empty());
    }

    /// Run the whole reader against a real transcript.
    ///
    /// `#[ignore]` because it needs a file this machine happens to have — a test that depends on
    /// the developer's home is not a test (rule:testing). It is kept because unit fixtures cannot
    /// answer the question this feature stands or falls on: **does four hours of real work fold
    /// into something a person can read?**
    ///
    /// ```sh
    /// YGG_CHAIN_TRANSCRIPT=~/.claude/projects/<slug>/<session>.jsonl \
    ///   cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture against_a_real
    /// ```
    #[test]
    #[ignore = "needs a real transcript; see the doc comment"]
    fn against_a_real_transcript() {
        let Ok(path) = std::env::var("YGG_CHAIN_TRANSCRIPT") else {
            panic!("set YGG_CHAIN_TRANSCRIPT to a transcript path");
        };
        let parsed = parse_transcript(std::path::Path::new(&path), 0);
        let chain = assemble(parsed, "(real)", None);

        eprintln!(
            "steps {} of {} understood → {} links, {} plan steps, {} s elapsed, harness {:?}",
            chain.steps_understood,
            chain.steps_seen,
            chain.links.len(),
            chain.plan.len(),
            chain.elapsed,
            chain.harness_version
        );
        for link in &chain.links {
            eprintln!(
                "  {:<7} {:<28} {:>5}s  {:>3} steps  +{:>3} noise  {}{}",
                link.act.as_str(),
                link.refinement.as_deref().unwrap_or("—"),
                link.seconds,
                link.steps,
                link.noise,
                link.iterations
                    .map_or(String::new(), |n| format!("cycle x{n} ")),
                match link.outcome {
                    model::Outcome::Failed => "RED",
                    model::Outcome::Live => "running",
                    _ => "",
                }
            );
        }
        assert!(!chain.links.is_empty(), "a real session has links");
    }

    fn stub(act: Act) -> ChainLink {
        ChainLink {
            act,
            refinement: None,
            outcome: model::Outcome::Done,
            kind: model::Kind::Normal,
            reach: None,
            seconds: 0,
            steps: 1,
            noise: 0,
            iterations: None,
            rounds: Vec::new(),
            guessed: true,
        }
    }
}
