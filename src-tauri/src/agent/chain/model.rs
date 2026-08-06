//! What a chain is made of.
//!
//! The vocabulary is `rule:work-legibility`'s and **only** that one. An earlier draft of the UI used
//! a second set of words (`TEST`, `FIX`, `GATE`) beside the rule's five acts; two names for one
//! thing is the duplication ADR-CORE-005 exists to prevent, and it would have meant the declaration
//! in `work-levels.json` could not produce the labels the interface shows.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What is being done. The five acts of `rule:work-legibility`, exhaustive by construction.
///
/// **The ordering is load-bearing**: it is the significance ranking used to pick one act out of a
/// compound command (`cd x && npm run lint && git push` is an act of shipping). Do not reorder
/// without reading `classify::classify_command`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum Act {
    /// Reading, measuring, diagnosing. The default: anything undeclared is a probe.
    Probe = 0,
    /// The context was compacted.
    ///
    /// Not something the agent *does* — the harness does it — but the most consequential thing that
    /// can happen to a long session: everything before it is a summary now, and an agent that
    /// repeats itself afterwards is doing so because it genuinely does not remember. Measured: three
    /// in one 26 MB session, each invisible in the transcript except for one flag. Worth a line
    /// precisely because nothing else in the chain explains what changed.
    Compact = 1,
    /// Deciding what to do — and, in a transcript, maintaining the task list.
    Plan = 2,
    /// Changing the source: code, config, content, a migration.
    ///
    /// **Separate from [`Act::Build`], and the separation was reported rather than designed.** The
    /// first version called this `build`, which is what a compiler does — so the chain said
    /// "build" while the agent was editing a test file, and the maintainer read it as a compile
    /// that was not happening. Editing is what an agent spends its day doing; it deserves its own
    /// word, and the word has to be the one everybody already uses for it.
    Edit = 3,
    /// Producing an artefact from the source: a compile, a bundle, generated bindings.
    Build = 4,
    /// Finding out whether it is right.
    Verify = 5,
    /// Handing work to a subagent.
    ///
    /// **Its own act rather than a marker on another one.** It was first recorded as a `build` that
    /// happened to be flagged — which meant the chain said "build" about the one step where this
    /// transcript contains no work at all. Launching a subagent is a distinct thing a person watching
    /// wants to see by name, and the work it does lives in a different file (`subagents/`).
    Delegate = 6,
    /// Putting it where it counts.
    Ship = 7,
}

impl Act {
    /// The word the interface shows, uppercased by CSS rather than here.
    pub fn as_str(self) -> &'static str {
        match self {
            Act::Probe => "probe",
            Act::Compact => "compact",
            Act::Plan => "plan",
            Act::Edit => "edit",
            Act::Build => "build",
            Act::Verify => "verify",
            Act::Delegate => "subagent",
            Act::Ship => "ship",
        }
    }
}

/// What kind of thing a step is, beyond its act.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Normal,
    /// A subagent was launched. **This transcript does not contain that work** — it lives in
    /// `subagents/agent-*.jsonl`. Marked rather than silently absent: `rule:agent-delegation` makes
    /// fan-out the default, so in the sessions that follow this repo's own governance a plain gap
    /// would be the common case and would read as "nothing happened" (chain-tool.md C3).
    Delegated,
    /// The agent asked the user something.
    Halt,
    /// Maintaining the task list. Never a chain link of its own — it is how the plan is recorded,
    /// not work in its own right.
    Bookkeeping,
}

/// One tool call, classified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub act: Act,
    /// The subtype a person recognises: a suite name, a script, a filename.
    pub refinement: Option<String>,
    pub kind: Kind,
    /// The command this came from, reduced to what identifies it: `cargo test`, `npm run check:all`,
    /// `scripts/run-tests.sh backend`.
    ///
    /// **This is what `work-levels.json` is matched against, and matching the refinement instead was
    /// a real defect.** A refinement is a *category* — `cargo test` becomes `unit` — so a declaration
    /// listing `npm run test` matched nothing, and almost every link in a project that had bothered
    /// to write one still displayed as guessed. Only entries whose refinement happened to be a
    /// script name (`check:all`) worked, which made the failure look like an inconsistency rather
    /// than a bug.
    pub signature: Option<String>,
    /// ISO timestamp from the transcript line. `None` for a line that carried none.
    pub at: Option<String>,
    /// Whether this was *recognised* rather than merely defaulted to a probe.
    ///
    /// A `Read` is a probe and is fully understood; an unknown program is a probe because we could
    /// not tell. Only the second kind lowers the coverage figure — conflating them reported 33 % on
    /// a session the reader had actually read correctly.
    pub recognised: bool,
}

impl Step {
    pub fn new(act: Act, refinement: Option<String>) -> Self {
        Self {
            act,
            refinement,
            kind: Kind::Normal,
            signature: None,
            at: None,
            recognised: true,
        }
    }

    /// A probe we fell back to because nothing was recognised — the only kind that lowers coverage.
    pub fn unrecognised() -> Self {
        Self {
            recognised: false,
            ..Self::new(Act::Probe, None)
        }
    }

    pub fn with_kind(mut self, kind: Kind) -> Self {
        self.kind = kind;
        self
    }

    pub fn with_signature(mut self, signature: Option<String>) -> Self {
        self.signature = signature;
        self
    }

    pub fn at(mut self, at: Option<String>) -> Self {
        self.at = at;
        self
    }
}

/// How a link ended — inferred from what followed it, never from an exit code.
///
/// **Measured twice, in two projects, with different tooling: 6 of 381 and 6 of 876 tool results
/// carry `is_error`.** Agents pipe test runs through `| tail -60`, so the status belongs to the pipe.
/// Parsing output for `FAILED`/`passed` would be framework-specific and would lie after the next
/// tool update. What followed does not lie: a verify followed by a build was red; a verify followed
/// by a ship was green.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    /// Still running — the last link in the chain.
    Live,
    /// Something was fixed afterwards, so it had found something.
    Failed,
    /// The work moved on rather than back.
    Done,
    /// Nothing follows it yet and it is not the newest link: no claim is made.
    Unknown,
}

/// What the agent is doing, when it is not doing anything.
///
/// **There are exactly two ways for a chain to be quiet, and conflating them is the difference
/// between a useful panel and a decorative one** — the maintainer put it plainly: either nothing is
/// outstanding, or it is waiting for a person. "Quiet" alone leaves the reader to open the terminal
/// and find out, which is the work the panel exists to save.
///
/// The distinction is not inferred from the transcript, which cannot express it: an agent waiting on
/// a permission prompt and one that finished write exactly the same thing — nothing. It comes from
/// the hook events (`agent::hooks`), which already separate a request that blocks from a turn that
/// ended, and which this app already installs for the attention bell (ADR-CORE-005: one source).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum Standing {
    /// A turn is open: the agent is working on something for you.
    Working,
    /// It asked for something and stopped. **This is the one that needs you.**
    Waiting,
    /// The turn ended and nothing was asked. Finished.
    Idle,
    /// **Nobody said.** No hook is installed for this account, so there is no report — and the tool
    /// says so rather than inferring one.
    ///
    /// An earlier version guessed from the age of the last transcript line: quiet for N seconds
    /// meant finished. It flickered, because the gap between two tool calls is routinely longer than
    /// any threshold worth setting — an agent thinking, or writing a reply, writes nothing. The
    /// maintainer named the principle: *"das darf kein geratener Zustand sein, das muss ein gewollt
    /// herbeigeführter Status sein"*, which is ADR-CORE-004 applied to a panel. A state nobody
    /// declared is not a state; it is a guess wearing one's clothes.
    Unknown,
}

/// Where a run reaches. Shown always, even when it cannot be interpreted — `verify e2e → dev-backend`
/// is informative with no configuration, and the day it reads `→ app.example.com` the difference is
/// visible without anybody having defined "live" (chain-tool.md §8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Reach {
    /// `local`, `dev`, `staging`, `prod`.
    pub target: String,
    /// The host, cluster or container actually touched, when the declaration names one.
    pub host: Option<String>,
    /// True when the declaration claimed something closer than the heuristic recognised. The UI
    /// shows this as a contradiction rather than resolving it (ADR-PROJ-005 §4).
    pub disputed: bool,
}

/// One iteration inside a folded cycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Round {
    pub act: Act,
    pub refinement: Option<String>,
}

/// One link of the chain, as the tool draws it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ChainLink {
    pub act: Act,
    pub refinement: Option<String>,
    /// The command that produced it, as a person would write it down — what `work-levels.json` is
    /// looked up by.
    pub signature: Option<String>,
    pub outcome: Outcome,
    pub kind: Kind,
    pub reach: Option<Reach>,
    /// Seconds from the first to the last step folded into this link.
    pub seconds: u64,
    /// How many tool calls it took. Not shown as such; it is what `noise` is measured against.
    pub steps: u32,
    /// Probes folded into this link — reading a log after a test run belongs *inside* the test.
    pub noise: u32,
    /// `Some` when this link is a folded cycle: how many times it went round.
    pub iterations: Option<u32>,
    /// The distinct refinements seen inside a cycle. **The reading is opposite** depending on this:
    /// 16 iterations over 16 files is a list being worked through, over 1 file it is stuck.
    pub rounds: Vec<Round>,
    /// True when the classification came from the built-in heuristic rather than a declaration.
    /// The interface says so; a guess that looks like a fact is the defect `AgentTool` already
    /// avoids for the context window.
    pub guessed: bool,
}

/// One step of the agent's own plan, reconstructed from its task list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct PlanStep {
    pub id: String,
    pub subject: String,
    /// `pending`, `in_progress`, `completed`.
    pub status: String,
    /// Ids of steps that must finish first. Empty in every live file measured so far, so the UI must
    /// not depend on it — but it is carried, because when it appears it is the causal chain.
    pub blocked_by: Vec<String>,
}

/// Everything the tool needs for one tab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Chain {
    /// Newest last, exactly as the work happened.
    pub links: Vec<ChainLink>,
    /// The agent's plan, in the order it created it. Empty when it kept none.
    pub plan: Vec<PlanStep>,
    /// True when a plan existed and every step of it finished. **Distinct from an empty plan**: the
    /// task store is cleared the moment nothing is open, so "finished" and "never had one" look
    /// identical there. The transcript still holds the history, which is what tells them apart.
    pub plan_done: bool,
    /// What is expected next, from this session's own edge frequencies. An observation, never a
    /// plan — the interface draws it differently for that reason.
    pub expected: Vec<Round>,
    /// Seconds since the first step of the session.
    pub elapsed: u64,
    /// Seconds since the **last** step — how long nothing has happened.
    ///
    /// **The chain has no other way to know the present.** It reads a file and would otherwise treat
    /// the end of it as "now": an agent that stopped an hour ago still showed a link as running and
    /// three more as expected, while nobody had asked it for anything. That is the same failure
    /// `rule:attention-signals` records — a state that does not age becomes a lie, and the lie looks
    /// exactly like information.
    pub idle: u64,
    /// What the agent is doing right now — the question the tool exists to answer.
    pub standing: Standing,
    /// What it is waiting for, when it is waiting. The harness's own words, because a request names
    /// what it wants and nothing we could write would be more accurate.
    pub waiting_for: Option<String>,
    /// Tool calls seen, and how many were understood. A shorter chain and a genuinely shorter chain
    /// look identical, so the reader reports its own coverage instead of going quiet (ADR-PROJ-005).
    pub steps_seen: u32,
    pub steps_understood: u32,
    /// The Claude home this was read from — shown, because several can be in use and a wrong
    /// attribution renders another account's work in this tab.
    pub home: String,
    pub session_id: Option<String>,
    /// The harness version the transcript was written by. When it is one this reader was never
    /// verified against, the tool says it is on unproven ground rather than quietly showing less.
    pub harness_version: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_act_ordering_is_the_significance_ranking() {
        // Load-bearing: `classify_command` takes the maximum across a compound command's segments,
        // so this ordering decides that `lint && git push` is a ship rather than a verify.
        assert!(Act::Ship > Act::Verify);
        assert!(Act::Verify > Act::Build);
        assert!(Act::Build > Act::Edit);
        assert!(Act::Edit > Act::Plan);
        assert!(Act::Plan > Act::Probe);
    }

    #[test]
    fn every_act_has_a_word_and_they_are_all_different() {
        let acts = [
            Act::Probe,
            Act::Plan,
            Act::Edit,
            Act::Build,
            Act::Verify,
            Act::Delegate,
            Act::Ship,
        ];
        let mut words: Vec<&str> = acts.iter().map(|a| a.as_str()).collect();
        words.sort_unstable();
        words.dedup();
        assert_eq!(words.len(), 7, "two acts share a word");
    }

    #[test]
    fn a_step_carries_the_time_it_happened() {
        let step =
            Step::new(Act::Verify, Some("unit".into())).at(Some("2026-08-06T12:00:00Z".into()));
        assert_eq!(step.at.as_deref(), Some("2026-08-06T12:00:00Z"));
        assert_eq!(step.kind, Kind::Normal, "normal unless said otherwise");
    }
}
