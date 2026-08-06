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
    /// Deciding what to do — and, in a transcript, maintaining the task list.
    Plan = 1,
    /// Making the thing: code, config, content.
    Build = 2,
    /// Finding out whether it is right.
    Verify = 3,
    /// Putting it where it counts.
    Ship = 4,
}

impl Act {
    /// The word the interface shows, uppercased by CSS rather than here.
    pub fn as_str(self) -> &'static str {
        match self {
            Act::Probe => "probe",
            Act::Plan => "plan",
            Act::Build => "build",
            Act::Verify => "verify",
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
    /// The project script this came from, when it was one — used to look the step up in
    /// `work-levels.json`.
    pub script: Option<String>,
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
            script: None,
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

    pub fn with_script(mut self, script: Option<String>) -> Self {
        self.script = script;
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
        assert!(Act::Build > Act::Plan);
        assert!(Act::Plan > Act::Probe);
    }

    #[test]
    fn every_act_has_a_word_and_they_are_all_different() {
        let acts = [Act::Probe, Act::Plan, Act::Build, Act::Verify, Act::Ship];
        let mut words: Vec<&str> = acts.iter().map(|a| a.as_str()).collect();
        words.sort_unstable();
        words.dedup();
        assert_eq!(words.len(), 5, "two acts share a word");
    }

    #[test]
    fn a_step_carries_the_time_it_happened() {
        let step =
            Step::new(Act::Verify, Some("unit".into())).at(Some("2026-08-06T12:00:00Z".into()));
        assert_eq!(step.at.as_deref(), Some("2026-08-06T12:00:00Z"));
        assert_eq!(step.kind, Kind::Normal, "normal unless said otherwise");
    }
}
