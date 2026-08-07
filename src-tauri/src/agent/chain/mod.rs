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
///
/// `Clone` because this **is** the cache entry: every field accumulates across polls, and keeping
/// only some of them is the defect described on `parse_onto`.
#[derive(Debug, Default, Clone)]
pub struct Parsed {
    pub steps: Vec<Step>,
    pub plan: Vec<PlanStep>,
    pub session_id: Option<String>,
    pub harness_version: Option<String>,
    pub seen: u32,
    pub understood: u32,
    /// How many complete plans came before this one. Kept so the tool can say "the fourth list of
    /// the day" rather than pretending the earlier ones never existed.
    pub finished_plans: u32,
    /// Work started in the background and not yet reported finished, by its task id.
    ///
    /// **Both ends are already in this file**, which is why this needs no second mechanism: the
    /// result of a backgrounded call carries `running in background with ID: …`, and its completion
    /// arrives later as a `<task-notification>` naming the same id. Measured in a live session: 17
    /// starts, each paired.
    pub background: HashMap<String, OpenRun>,
    /// Byte offset one past the last complete line consumed.
    pub offset: u64,
}

/// One backgrounded command, from the moment it started until something says it ended.
#[derive(Debug, Clone)]
pub struct OpenRun {
    pub act: Act,
    pub refinement: Option<String>,
    /// When it started, as the transcript recorded it.
    pub at: Option<String>,
    /// It has ended, and badly. Kept rather than dropped: a background run that failed while the
    /// agent was already idle is invisible in every other surface this app has.
    pub failed: bool,
}

/// Read a transcript and classify everything in it.
///
/// `from` is the byte offset a previous pass stopped at; the caller is responsible for having
/// validated that the file is still the same one (see `state::ChainCache`). Passing `0` re-reads
/// from the beginning, which is always correct — the reader is idempotent by design, because a
/// command that returned a *delta* would be destructive on call and this frontend loses deltas four
/// different ways (StrictMode, retry, remount, two tabs).
pub fn parse_transcript(path: &Path, from: u64) -> Parsed {
    parse_onto(path, from, Parsed::default())
}

/// Continue a previous pass: read from `from` and fold the result into what is already known.
///
/// **The plan and the counters accumulate exactly as the steps do, and getting that wrong is not a
/// detail.** The first build cached only `steps`, so from the second poll onwards the plan was
/// rebuilt from the handful of new lines alone — a session with nineteen tracked tasks reported
/// "this session keeps no plan", and the coverage figure read `173/173` for a file where it was
/// `275/392`. The invariant is the one this module claims: **a cache, not a consumption counter**,
/// and it holds everything derived, not the part that was convenient.
pub fn parse_onto(path: &Path, from: u64, prior: Parsed) -> Parsed {
    let mut out = Parsed {
        offset: from,
        ..prior
    };
    let Some(text) = read_from(path, from) else {
        return out;
    };
    out.offset = from + text.len() as u64;

    // `TaskCreate` gives a subject; its id comes back in the tool result. Matched by tool-use id so
    // the plan survives interleaved calls.
    let mut pending_subjects: HashMap<String, String> = HashMap::new();
    // The same shape for a backgrounded command: the call says what it is, its result says what the
    // task is called, and only the pair is useful.
    let mut pending_background: HashMap<String, OpenRun> = HashMap::new();
    // How many steps have finished so far, so each learns where it came in that order. Seeded from
    // what is already known, because a poll continues a pass rather than starting one — the same
    // invariant `parse_onto` is documented by, and getting it wrong would restart the ranking at
    // every poll and shuffle the finished list under the reader.
    let mut finished: u32 = out
        .plan
        .iter()
        .filter_map(|s| s.done_at)
        .max()
        .map_or(0, |highest| highest + 1);

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

        // A compact is the one thing in a session that changes what the agent knows, and it leaves
        // no tool call behind — only this flag. Measured: three of them in one 26 MB session, each
        // otherwise invisible. Recorded as a step of its own so the chain can explain why an agent
        // starts repeating itself.
        if value.get("isCompactSummary").and_then(Value::as_bool) == Some(true) {
            out.seen += 1;
            out.understood += 1;
            out.steps
                .push(Step::new(Act::Compact, None).at(timestamp.clone()));
        }
        let content = value.get("message").and_then(|m| m.get("content"));

        // A completion arrives as plain text, not as a tool call — the harness injects it as a
        // message. It is the only line in the file that says a background run has ended.
        if let Some(text) = content.and_then(Value::as_str) {
            close_background(&mut out.background, text);
        }

        let Some(parts) = content.and_then(Value::as_array) else {
            continue;
        };
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

                    // The status a `TaskUpdate` sets: a completion is an event in the trace, every
                    // other move is bookkeeping (see `classify`).
                    let status = input.and_then(|i| i.get("status")).and_then(Value::as_str);
                    let step = classify::classify(&name, command, file, status)
                        .at(timestamp.clone())
                        .from_tool(str_at(part, "id"));

                    // A backgrounded call: remembered by tool-use id, because what it *is* is known
                    // here and what it is *called* only arrives with its result.
                    let backgrounded = input
                        .and_then(|i| i.get("run_in_background"))
                        .and_then(Value::as_bool)
                        == Some(true);
                    if backgrounded {
                        if let Some(id) = str_at(part, "id") {
                            pending_background.insert(
                                id,
                                OpenRun {
                                    act: step.act,
                                    refinement: step.refinement.clone(),
                                    at: timestamp.clone(),
                                    failed: false,
                                },
                            );
                        }
                    }
                    if step.recognised {
                        out.understood += 1;
                    }

                    // Plan bookkeeping, captured on the way past.
                    if name == "TaskCreate" {
                        // **A finished list is replaced, not extended.** The harness clears its task
                        // store the moment nothing is open, so the next `TaskCreate` starts a new
                        // list — and a reader that kept appending would show a plan the harness no
                        // longer has, which is exactly the inconsistency this was reported for:
                        // "19/19 done" here against an empty list there.
                        if !out.plan.is_empty() && out.plan.iter().all(|s| s.status == "completed")
                        {
                            out.finished_plans += 1;
                            out.plan.clear();
                        }
                        if let (Some(id), Some(subject)) = (
                            str_at(part, "id"),
                            input.and_then(|i| i.get("subject")).and_then(Value::as_str),
                        ) {
                            pending_subjects.insert(id, subject.to_string());
                        }
                    } else if name == "TaskUpdate" {
                        apply_update(&mut out.plan, input, &mut finished);
                    }
                    out.steps.push(step);
                }
                Some("tool_result") => {
                    if let Some(id) = str_at(part, "tool_use_id") {
                        // **What the run actually did, from the harness rather than from a guess.**
                        // Searched backwards and bounded: a result follows its call closely, and an
                        // unbounded scan would make every poll cost the whole session again.
                        let failed = part.get("is_error").and_then(Value::as_bool);
                        if let Some(step) = out
                            .steps
                            .iter_mut()
                            .rev()
                            .take(RESULT_LOOKBACK)
                            .find(|s| s.tool_id.as_deref() == Some(id.as_str()))
                        {
                            // `false` matters as much as `true`: it is the difference between "this
                            // passed" and "nobody said", and the second is what the edge heuristic
                            // is still allowed to answer.
                            step.failed = Some(failed == Some(true));
                        }
                        // The result names the task, which is what a completion will name later.
                        if let Some(run) = pending_background.remove(&id) {
                            if let Some(task) = background_id(part) {
                                out.background.insert(task, run);
                            }
                        }
                        if let Some(subject) = pending_subjects.remove(&id) {
                            let task_id = created_id(part)
                                .unwrap_or_else(|| (out.plan.len() + 1).to_string());
                            out.plan.push(PlanStep {
                                id: task_id,
                                subject,
                                status: "pending".into(),
                                done_at: None,
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

/// How far back a tool result will look for the call it belongs to.
///
/// A result follows its call within a handful of lines; a bound keeps a poll from re-scanning the
/// whole session for every one of them. Generous enough that interleaved calls still find theirs.
const RESULT_LOOKBACK: usize = 64;

/// How long an unfinished background run is still believed.
///
/// **A bound, because the end of a run can genuinely never arrive**: the session was closed, the
/// task was killed by something outside this app, or the marker below stopped matching. Reporting
/// "still running" about something that stopped four hours ago is exactly the confident wrongness
/// this whole panel is being corrected for, so an entry older than this is dropped rather than
/// shown. Two hours is longer than any build here and short enough that a stale one does not
/// survive a lunch break.
const BACKGROUND_MAX_SECS: u64 = 2 * 60 * 60;

/// What is still running, oldest first, with the stale entries dropped.
fn still_running(open: &HashMap<String, OpenRun>) -> Vec<model::Background> {
    let mut out: Vec<model::Background> = open
        .values()
        .map(|run| model::Background {
            act: run.act,
            refinement: run.refinement.clone(),
            seconds: run.at.as_deref().map_or(0, seconds_since),
            failed: run.failed,
        })
        .filter(|run| run.seconds <= BACKGROUND_MAX_SECS)
        .collect();
    // Oldest first: the one that has been running longest is the one worth asking about.
    out.sort_by_key(|run| std::cmp::Reverse(run.seconds));
    out
}

/// What the harness calls a backgrounded command, from the result that started it.
///
/// **The one string this feature depends on**, and it is the harness's wording rather than ours — a
/// reword makes it stop finding anything. That failure is deliberately one-sided: nothing is
/// reported, rather than something wrong being reported, and the pinned test below is what turns a
/// reword into a red build here instead of a quiet gap in somebody's panel.
const BACKGROUND_MARKER: &str = "running in background with ID: ";

/// The task id in a result that started something in the background.
fn background_id(part: &Value) -> Option<String> {
    let text = part.get("content").map(|c| match c.as_str() {
        Some(text) => text.to_string(),
        None => c.to_string(),
    })?;
    let after = text.split_once(BACKGROUND_MARKER)?.1;
    let id: String = after
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    (!id.is_empty()).then_some(id)
}

/// Close whatever a task notification says has ended.
///
/// A completion that did **not** succeed is kept rather than removed: the agent has long since gone
/// idle, so a failed background run is otherwise invisible in every surface this app has.
fn close_background(open: &mut HashMap<String, OpenRun>, text: &str) {
    if !text.contains("<task-notification>") {
        return;
    }
    let Some(id) = between(text, "<task-id>", "</task-id>") else {
        return;
    };
    let Some(run) = open.get_mut(&id) else { return };
    match between(text, "<status>", "</status>").as_deref() {
        Some("completed") => {
            open.remove(&id);
        }
        // Killed, failed, or a status this reader has not met: it ended, and not well.
        Some(_) => run.failed = true,
        None => {}
    }
}

fn between(text: &str, open: &str, close: &str) -> Option<String> {
    let after = text.split_once(open)?.1;
    let inner = after.split_once(close)?.0;
    (!inner.is_empty()).then(|| inner.trim().to_string())
}

/// Apply one `TaskUpdate` to the reconstructed plan.
///
/// `finished` counts completions across the whole transcript, so each step learns **where it came in
/// the order things were finished** — which the status alone cannot say, being a state rather than an
/// event. It is what lets the list put open work above done work without inventing an order.
fn apply_update(plan: &mut [PlanStep], input: Option<&Value>, finished: &mut u32) {
    let Some(input) = input else { return };
    let Some(id) = input.get("taskId").and_then(Value::as_str) else {
        return;
    };
    let Some(step) = plan.iter_mut().find(|s| s.id == id) else {
        return;
    };
    if let Some(status) = input.get("status").and_then(Value::as_str) {
        // Only the *transition* counts. A second `completed` on a step that is already finished is
        // bookkeeping, and re-ranking it would shuffle the finished list under the reader.
        if status == "completed" {
            if step.done_at.is_none() {
                step.done_at = Some(*finished);
                *finished += 1;
            }
        } else {
            step.done_at = None;
        }
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
pub fn read(
    home: &Path,
    cwd: &Path,
    live: Option<&Path>,
    store: &cache::ChainCache,
) -> Option<Chain> {
    // **The hook knows which file the live session is writing; the mtime walk only guesses.**
    //
    // That guess fails on a real and frequent input: the walk accepts the newest transcript whose
    // *tail* still contains an assistant turn, and one pasted image is a single line far larger than
    // the 256 kB window. After dropping the partial first line there is nothing left, the newest
    // file looks sessionless, and the walk moves on — to an older session in the same project, whose
    // trace looks plausibly like this one because it worked on the same repository. Measured: a
    // panel showing `edit statusline.sh` from 09:20 as the live step at 19:50, reported twice as
    // "that is not what you are doing".
    //
    // A wrong answer that looks right is the worst failure this tool has, so the authoritative
    // source wins and the walk is only the fallback for a directory no hook has reported from.
    let transcript = match live.filter(|path| path.is_file()) {
        Some(path) => path.to_path_buf(),
        None => super::newest_transcript(home, cwd)?,
    };

    let known = store.resume(&transcript);
    let from = known.offset;
    let mut parsed = parse_onto(&transcript, from, known);
    store.store(&transcript, &parsed);

    // **Which file this chain is made of, on every poll.** The directory holds one transcript per
    // session and the newest live one is *chosen*, so "am I looking at the wrong session?" is a
    // question that will be asked — and it was, about a step nobody recognised. Without this line it
    // is unanswerable after the fact, which makes it a silent failure by the definition in
    // rule:logging. The path and the resumed offset only; never a line out of the file
    // (ADR-PROJ-005 §1). `agent::session` logs the same identity for the same reason.
    tracing::debug!(
        transcript = %transcript.display(),
        from,
        to = parsed.offset,
        steps = parsed.steps.len(),
        "read the chain from a transcript"
    );

    // Delegated work lives in a sibling directory the transcript never mentions again. Added after
    // the cache is written, because it is re-counted on every poll rather than accumulated.
    let delegated = delegated_steps(&transcript);
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
            failed: false,
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

    // How long ago the last thing happened. Reported as a fact, never turned into a verdict: the
    // gap between two tool calls is routinely a minute while an agent thinks or writes a reply, so
    // no threshold over it can distinguish "busy" from "finished" (see `Standing::Unknown`).
    let idle = parsed
        .steps
        .last()
        .and_then(|s| s.at.as_deref())
        .map_or(0, seconds_since);
    // **Nobody has said yet.** The caller fills this in from the hook events, which is the only
    // place the answer actually exists.
    let standing = model::Standing::Unknown;

    // **The declaration is consulted BEFORE the fold, or it arrives too late.** A command the
    // heuristic cannot name is a probe, and a probe is absorbed into whatever block is open — so by
    // the time links exist there is nothing left for `apply` to label. This is what made 16 of one
    // real declaration's 59 entrypoints inert: `python3 scripts/…`, `node scripts/…` and every
    // `./heimdal …` produced no link at all, however correctly the project had written them down.
    //
    // Done here rather than during parsing on purpose: parsing is cached, and a project editing
    // `work-levels.json` must see the effect within one poll rather than after an app restart.
    let mut steps = parsed.steps;
    if let Some(levels) = declaration {
        for step in &mut steps {
            if step.recognised {
                continue;
            }
            let Some(signature) = step.signature.clone() else {
                continue;
            };
            if let Some((act, refinement)) = levels.classify(&signature) {
                step.act = act;
                step.refinement = refinement;
                step.recognised = true;
            }
        }
    }

    let mut links = fold::fold(steps);
    if let Some(levels) = declaration {
        for link in &mut links {
            levels.apply(link);
        }
    }
    // Whether the last link is live and whether anything is expected both depend on the standing,
    // which only the caller knows — so both are decided there, by `settle_standing`.
    let expected = expectation(&links);
    let plan_done = !parsed.plan.is_empty() && parsed.plan.iter().all(|s| s.status == "completed");

    Chain {
        links,
        plan: parsed.plan,
        plan_done,
        expected,
        background: still_running(&parsed.background),
        elapsed,
        idle,
        standing,
        waiting_for: None,
        steps_seen: parsed.seen,
        steps_understood: parsed.understood,
        home: home.to_string(),
        session_id: parsed.session_id,
        harness_version: parsed.harness_version,
    }
}

/// Apply the standing the hook reported, and make the rest of the chain agree with it.
///
/// Kept here rather than at the call site so the consequences of a standing live in one place: a
/// chain that is not working has nothing running and predicts nothing, whoever worked that out.
pub fn settle_standing(chain: &mut Chain, standing: model::Standing, waiting_for: Option<String>) {
    chain.standing = standing;
    chain.waiting_for = waiting_for;

    if standing == model::Standing::Working {
        // **The running step is timed against now, not against its own last recorded step.** A
        // command that is still running writes nothing while it runs, so the span between recorded
        // steps stops moving and the panel showed the same "< 1 min" for a twenty-minute build,
        // jumping to the truth only once it finished.
        if let Some(last) = chain.links.last_mut() {
            last.seconds = last.seconds_live;
        }
        return;
    }
    // Not working: the last link is not running, and predicting the next step for an agent nobody
    // has asked for anything is inventing activity.
    if let Some(last) = chain.links.last_mut() {
        if last.outcome == model::Outcome::Live {
            last.outcome = model::Outcome::Unknown;
        }
    }
    chain.expected.clear();
}

/// Seconds between an ISO timestamp and now, or 0 when it cannot be read.
pub(super) fn seconds_since(at: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(at).map_or(0, |then| {
        (chrono::Utc::now() - then.with_timezone(&chrono::Utc))
            .num_seconds()
            .max(0) as u64
    })
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
        assert_eq!(parsed.steps[1].act, Act::Edit);
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
    fn a_finished_step_records_where_it_came_in_the_finishing_order() {
        // Reported: the list strikes a finished task through and leaves it where it was, so the open
        // work is scattered among the done work. Putting the finished ones underneath needs the ORDER
        // THEY FINISHED IN, and nothing recorded it — the status is a state, not an event.
        //
        // Three created, finished 2 → 3 → 1: an order the creation order cannot produce, so a test
        // that passed by accident here would be visible.
        let dir = tempfile::tempdir().expect("tempdir");
        let body = r#"{"type":"assistant","timestamp":"2026-08-06T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"c1","name":"TaskCreate","input":{"subject":"one"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"c1","content":"Task #1 created successfully: one"}]}}
{"type":"assistant","timestamp":"2026-08-06T12:00:10.000Z","message":{"content":[{"type":"tool_use","id":"c2","name":"TaskCreate","input":{"subject":"two"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"c2","content":"Task #2 created successfully: two"}]}}
{"type":"assistant","timestamp":"2026-08-06T12:00:20.000Z","message":{"content":[{"type":"tool_use","id":"c3","name":"TaskCreate","input":{"subject":"three"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"c3","content":"Task #3 created successfully: three"}]}}
{"type":"assistant","timestamp":"2026-08-06T12:01:00.000Z","message":{"content":[{"type":"tool_use","id":"u1","name":"TaskUpdate","input":{"taskId":"2","status":"completed"}}]}}
{"type":"assistant","timestamp":"2026-08-06T12:02:00.000Z","message":{"content":[{"type":"tool_use","id":"u2","name":"TaskUpdate","input":{"taskId":"3","status":"completed"}}]}}
{"type":"assistant","timestamp":"2026-08-06T12:03:00.000Z","message":{"content":[{"type":"tool_use","id":"u3","name":"TaskUpdate","input":{"taskId":"1","status":"completed"}}]}}
"#;
        let path = write(dir.path(), "t.jsonl", body);

        let plan = parse_transcript(&path, 0).plan;

        // The list itself stays in CREATION order: that is a fact about the session, and the display
        // decides how to show it. Only the rank is added.
        let by_id = |id: &str| plan.iter().find(|s| s.id == id).expect("step").done_at;
        assert_eq!(by_id("2"), Some(0), "finished first");
        assert_eq!(by_id("3"), Some(1));
        assert_eq!(by_id("1"), Some(2), "created first, finished last");
        assert_eq!(
            plan.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["1", "2", "3"],
            "the DTO is not reordered — `plan` still means the order they were created in"
        );
    }

    #[test]
    fn reopening_a_step_takes_its_place_in_the_finished_order_away() {
        // Otherwise a task that was reopened keeps a stale rank, and the list would file it among the
        // finished work while showing it as open. A rank is only meaningful while it holds.
        let dir = tempfile::tempdir().expect("tempdir");
        let body = r#"{"type":"assistant","timestamp":"2026-08-06T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"c1","name":"TaskCreate","input":{"subject":"one"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"c1","content":"Task #1 created successfully: one"}]}}
{"type":"assistant","timestamp":"2026-08-06T12:01:00.000Z","message":{"content":[{"type":"tool_use","id":"u1","name":"TaskUpdate","input":{"taskId":"1","status":"completed"}}]}}
{"type":"assistant","timestamp":"2026-08-06T12:02:00.000Z","message":{"content":[{"type":"tool_use","id":"u2","name":"TaskUpdate","input":{"taskId":"1","status":"in_progress"}}]}}
"#;
        let path = write(dir.path(), "t.jsonl", body);

        let plan = parse_transcript(&path, 0).plan;

        assert_eq!(plan[0].status, "in_progress");
        assert_eq!(
            plan[0].done_at, None,
            "it is open again, so it has no place among the finished"
        );
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
    fn the_reader_never_decides_whether_the_agent_is_working() {
        // **The principle, and it was hard-won**: "das darf kein geratener Zustand sein, das muss
        // ein gewollt herbeigeführter Status sein". A threshold on the age of the last line was
        // tried at ninety seconds and at twenty, and flickered at both — the gap between two tool
        // calls is routinely longer than either, because an agent thinking or writing a reply
        // writes nothing at all. So the transcript reader reports the age and declines the verdict.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "t.jsonl", TRANSCRIPT);

        let chain = assemble(parse_transcript(&path, 0), "/h", None);

        assert_eq!(chain.standing, model::Standing::Unknown);
        assert!(chain.idle > 0, "the age is a fact and is reported");
    }

    #[test]
    fn a_settled_standing_makes_the_rest_of_the_chain_agree() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "t.jsonl", TRANSCRIPT);
        let mut chain = assemble(parse_transcript(&path, 0), "/h", None);
        chain.expected = vec![Round {
            act: Act::Ship,
            refinement: Some("2".into()),
            failed: false,
        }];

        settle_standing(&mut chain, model::Standing::Idle, None);

        assert!(
            chain.expected.is_empty(),
            "nothing is predicted for an agent nobody has asked for anything"
        );
        assert_ne!(
            chain.links.last().map(|l| l.outcome),
            Some(model::Outcome::Live),
            "and nothing is running"
        );
    }

    #[test]
    fn a_working_standing_leaves_the_chain_alone() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "t.jsonl", TRANSCRIPT);
        let mut chain = assemble(parse_transcript(&path, 0), "/h", None);

        settle_standing(&mut chain, model::Standing::Working, None);

        assert_eq!(
            chain.links.last().map(|l| l.outcome),
            Some(model::Outcome::Live)
        );
    }

    #[test]
    fn a_finished_list_is_replaced_by_the_next_one_rather_than_extended() {
        // The inconsistency this was reported for: the harness clears its store the moment nothing
        // is open, so it showed no plan at all while the tool showed "19/19 done". A finished list
        // is history; the next `TaskCreate` starts a new one.
        let dir = tempfile::tempdir().expect("tempdir");
        let body = r#"{"type":"assistant","timestamp":"2026-08-06T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"c1","name":"TaskCreate","input":{"subject":"first"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"c1","content":"Task #1 created successfully: first"}]}}
{"type":"assistant","timestamp":"2026-08-06T12:01:00.000Z","message":{"content":[{"type":"tool_use","id":"u1","name":"TaskUpdate","input":{"taskId":"1","status":"completed"}}]}}
{"type":"assistant","timestamp":"2026-08-06T12:02:00.000Z","message":{"content":[{"type":"tool_use","id":"c2","name":"TaskCreate","input":{"subject":"second"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"c2","content":"Task #2 created successfully: second"}]}}
"#;
        let path = write(dir.path(), "t.jsonl", body);

        let parsed = parse_transcript(&path, 0);

        assert_eq!(parsed.plan.len(), 1, "only the list being kept now");
        assert_eq!(parsed.plan[0].subject, "second");
        assert_eq!(
            parsed.finished_plans, 1,
            "the earlier one is counted, not shown"
        );
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

    #[test]
    fn a_background_run_is_open_until_its_notification_says_otherwise() {
        // **"Nothing outstanding" and "nothing is happening" are different sentences.** `Stop` says
        // the agent has replied; a build it started keeps compiling, and the panel called the
        // session quiet throughout — reported while a DMG was being built. Both ends were already
        // in this file: the result names the task, the notification names it again.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("t.jsonl");
        let start = r#"{"type":"assistant","timestamp":"2026-08-06T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"u1","name":"Bash","input":{"command":"npm run build","run_in_background":true}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"u1","content":"Command running in background with ID: bx42. Output is being written to /tmp/x"}]}}
"#;
        std::fs::write(&path, start).expect("write");

        let open = parse_transcript(&path, 0);
        assert_eq!(open.background.len(), 1, "started and not yet finished");
        assert_eq!(open.background["bx42"].act, Act::Build);

        // And it closes on its own notification, by id.
        std::fs::write(
            &path,
            format!(
                "{start}{}\n",
                r#"{"type":"user","message":{"content":"<task-notification>\n<task-id>bx42</task-id>\n<status>completed</status>\n</task-notification>"}}"#
            ),
        )
        .expect("append");
        assert!(parse_transcript(&path, 0).background.is_empty());
    }

    #[test]
    fn a_background_run_that_ended_badly_is_kept_rather_than_forgotten() {
        // The half nothing else in this app can show: it failed after the agent went idle, so no
        // other surface will ever mention it.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("t.jsonl");
        std::fs::write(
            &path,
            format!(
                "{}\n{}\n{}\n",
                r#"{"type":"assistant","timestamp":"2026-08-06T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"u1","name":"Bash","input":{"command":"npm run build","run_in_background":true}}]}}"#,
                r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"u1","content":"Command running in background with ID: bx42."}]}}"#,
                r#"{"type":"user","message":{"content":"<task-notification>\n<task-id>bx42</task-id>\n<status>killed</status>\n</task-notification>"}}"#,
            ),
        )
        .expect("write");

        let parsed = parse_transcript(&path, 0);
        assert!(parsed.background["bx42"].failed);
    }

    #[test]
    fn a_run_nobody_ever_closed_stops_being_believed() {
        // A session that ended, a task killed from outside, or the marker having stopped matching.
        // Claiming something has been running for four hours is the confident wrongness this whole
        // panel is being corrected for.
        let old = HashMap::from([(
            "b1".to_string(),
            OpenRun {
                act: Act::Build,
                refinement: None,
                at: Some("2020-01-01T00:00:00.000Z".into()),
                failed: false,
            },
        )]);

        assert!(still_running(&old).is_empty());
    }

    #[test]
    fn the_reported_transcript_wins_over_the_newest_one_on_disk() {
        // **The defect this exists for.** The walk takes the newest transcript whose *tail* still
        // holds an assistant turn — and one pasted image is a single line larger than that window,
        // so the live session looks sessionless and an older one in the same project is picked
        // instead. Its trace looks plausible (same repository, same kind of work), which is what
        // made it survive two reports: a wrong answer that looks right.
        let dir = tempfile::tempdir().expect("tempdir");
        let turn = |file: &str| {
            format!(
                r#"{{"type":"assistant","timestamp":"2026-08-06T09:00:00.000Z","message":{{"content":[{{"type":"tool_use","id":"a","name":"Edit","input":{{"file_path":"{file}"}}}}]}}}}"#
            )
        };
        let live = dir.path().join("live.jsonl");
        let stale = dir.path().join("stale.jsonl");
        std::fs::write(&live, format!("{}\n", turn("/repo/live.rs"))).expect("write");
        // Written second, so it is the newer file on disk — the situation that misfires. Ordering by
        // write rather than by setting an mtime: a test dependency for one timestamp is not worth
        // its supply chain (rule:dependencies).
        std::fs::write(&stale, format!("{}\n", turn("/repo/statusline.sh"))).expect("write");

        let chain = read(
            dir.path(),
            dir.path(),
            Some(&live),
            &cache::ChainCache::default(),
        )
        .expect("a chain");

        assert_eq!(
            chain.links.first().and_then(|l| l.refinement.as_deref()),
            Some("live.rs"),
            "the file the harness itself reported, not the newest one on disk"
        );
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
            signature: Some("npm run test".into()),
            outcome: model::Outcome::Done,
            kind: model::Kind::Normal,
            reach: None,
            seconds: 0,
            seconds_live: 0,
            steps: 1,
            noise: 0,
            compacts: 0,
            reported: None,
            iterations: None,
            rounds: Vec::new(),
            guessed: true,
        }
    }
}
