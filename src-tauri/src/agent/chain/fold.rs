//! Turning 381 tool calls into 18 readable links.
//!
//! Three folds, in order, and each one is load-bearing:
//!
//! 1. **Noise folds into the block it happened inside.** Half of every measured session is probing —
//!    reading a log after a test run, checking a status. It is not a link of its own; it is what
//!    the link consisted of. Without this fold a four-hour session is 196 boxes.
//! 2. **Consecutive identical acts merge.** Three edits in a row are one act of building.
//! 3. **An alternation folds into a cycle with a counter** — `verify ⇄ build ×16` is the one number
//!    that says "this is not progressing", and it must be legible without expanding anything.
//!
//! **The third fold is bounded by the refinement, and that is not a detail.** Folding `verify(core)
//! ⇄ build(a.rs)` together with `verify(ui) ⇄ build(b.tsx)` would report `×2` for two independent,
//! *successful* passes — inverting the meaning of the only number the tool exists to show.

use super::model::{Act, ChainLink, Kind, Outcome, Round, Step};

/// Fold a classified step sequence into the chain the tool draws.
pub fn fold(steps: Vec<Step>) -> Vec<ChainLink> {
    let blocks = merge_runs(steps);
    let mut links = collapse_cycles(blocks);
    settle_outcomes(&mut links);
    links
}

/// One block before cycles are considered, with the probes between its steps counted rather than
/// listed.
struct Block {
    act: Act,
    refinement: Option<String>,
    signature: Option<String>,
    /// Further refinements folded into this block — the other files of a run of edits.
    also: Vec<String>,
    kind: Kind,
    steps: u32,
    noise: u32,
    /// Compacts that fell inside this block. **A seam, not work** — which is why it is counted here
    /// rather than being a block of its own: as one it sat between `A` and `A` and ended the
    /// alternation, so a loop that spanned a compact lost its iteration count at exactly the moment
    /// the count became interesting.
    compacts: u32,
    /// What the harness said about the steps in this block: `Some(true)` if any of them failed,
    /// `Some(false)` if some said so and none did, `None` if nobody said anything.
    ///
    /// Three states rather than two, because "passed" and "nobody reported" are different facts and
    /// only the second may be answered by the edge heuristic (see `settle_outcomes`).
    failed: Option<bool>,
    first_at: Option<String>,
    last_at: Option<String>,
}

/// Fold one step's reported result into a block's.
fn merge_failed(open: Option<bool>, step: Option<bool>) -> Option<bool> {
    match (open, step) {
        (Some(true), _) | (_, Some(true)) => Some(true),
        (Some(false), _) | (_, Some(false)) => Some(false),
        _ => None,
    }
}

/// Whether a step continues the block that is open.
///
/// **The two acts are not symmetrical, and measuring a real session is what showed it.** Against
/// four hours of live work this first produced 84 links instead of 18, because every edited file
/// started a new one: `build UserManagement.jsx`, `build de.json`, `build en.json`, `build fr.json`
/// — four lines for one act of translating.
///
/// A `build`'s refinement is a **file**: there are many, they change constantly, and the run of them
/// is one piece of work. A `verify`'s refinement is a **suite**: switching from `backend` to `e2e`
/// is a different check and merging them would hide it. So edits merge across their refinement and
/// everything else does not.
fn merges(open: &Block, step: &Step) -> bool {
    if open.act != step.act {
        return false;
    }
    // **Editing and looking around are both about the run, not the file.** Three edits to three
    // files are one act of building — that short-circuit was always here. Ten reads of ten files are
    // one act of looking around by exactly the same argument, and without `Probe` on this line they
    // were ten separate links: the same intent, implemented for one act and not the other. Which
    // file is current is answered by `refinement`, and the ones before it by `also`.
    matches!(open.act, Act::Edit | Act::Probe) || open.refinement == step.refinement
}

/// How many probes an act may absorb before they stop being its footnotes.
///
/// A judgement, and it is the number that decides whether the panel answers "what now" honestly. Too
/// high and a long look-around keeps announcing the act it followed; too low and every test run
/// splits in two because somebody read its output twice. Four is "a couple of look-ups belong to the
/// thing you were doing"; the fifth says you have moved on to finding something out.
const PROBE_RUN: u32 = 4;

fn merge_runs(steps: Vec<Step>) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    // A compact met before any work has an open block to fall into. It is held rather than dropped:
    // a resumed session opens with the summary, and that seam is what explains why the trace starts
    // mid-thought.
    let mut pending_compacts = 0u32;
    // **Held, not dropped — the same treatment a compact gets, and for a related reason.** A
    // look-around before any work is not yet work, so it opens nothing; but "not yet" is a
    // judgement with an expiry, and the expiry already exists four lines down as `PROBE_RUN`. It
    // simply was not applied here, so at the *start* of a session the rule was "drop for ever"
    // rather than "drop until it is clearly what is happening" — and a session that only ever reads
    // folded to nothing at all. Measured in a fresh repository: ten `Read`s, two `Bash`es, zero
    // links, and a panel announcing that no agent had run there.
    let mut pending_probes = 0u32;
    let mut probes_from: Option<String> = None;
    for step in steps {
        // Bookkeeping is how the plan is recorded, not work — it never becomes a link, and it is
        // not noise either, so it does not inflate the count of what a block consisted of.
        if step.kind == Kind::Bookkeeping {
            continue;
        }
        // A compact is an event at the agent, not a piece of work, so it is absorbed exactly as a
        // probe is — and unlike a probe it is never dropped, because losing the context is the one
        // thing about a long session that explains everything after it.
        if step.act == Act::Compact {
            match blocks.last_mut() {
                Some(open) => open.compacts += 1,
                None => pending_compacts += 1,
            }
            continue;
        }
        // A probe belongs inside whatever is open. Before anything is open it is dropped: a session
        // that begins with twenty greps has not started working yet.
        //
        // **Up to a point, and finding that point took two reports.** Reading a log after a test run
        // belongs inside the test; twenty greps after a push are not the push, they are what the
        // agent is doing now — and the panel went on announcing `ship push` through all of them,
        // while the maintainer watched files being edited: *"so denke ich du tust etwas völlig
        // anderes"*. Past the threshold the run becomes a link of its own, which is what `probe` is
        // in the vocabulary for: finding out how things stand.
        if step.act == Act::Probe && step.kind == Kind::Normal {
            let absorbed = blocks
                .last()
                .is_some_and(|open| open.act != Act::Probe && open.noise < PROBE_RUN);
            if absorbed {
                if let Some(open) = blocks.last_mut() {
                    open.noise += 1;
                    if step.at.is_some() {
                        open.last_at = step.at;
                    }
                }
                continue;
            }
            if blocks.is_empty() {
                // Nothing open: a session that begins with greps has not started working yet — for
                // as long as that stays plausible. Past the same threshold used above, looking
                // around IS the work, and the whole run becomes its one link rather than only the
                // steps after the threshold: the user asked what happened, not what happened fifth.
                pending_probes += 1;
                if probes_from.is_none() {
                    probes_from.clone_from(&step.at);
                }
                if pending_probes <= PROBE_RUN {
                    continue;
                }
                blocks.push(Block {
                    act: Act::Probe,
                    refinement: step.refinement,
                    signature: step.signature,
                    also: Vec::new(),
                    kind: step.kind,
                    steps: pending_probes,
                    noise: 0,
                    compacts: std::mem::take(&mut pending_compacts),
                    failed: step.failed,
                    first_at: probes_from.take(),
                    last_at: step.at,
                });
                continue;
            }
        }
        match blocks.last_mut() {
            Some(open) if open.kind == step.kind && merges(open, &step) => {
                open.steps += 1;
                // **The block is named after the file being edited NOW, not the first one.** A run
                // of edits is one act, but its label answered the wrong question: the panel said
                // `edit mod.rs` for minutes while the work had moved on, and the file actually
                // being changed sat behind the expander. Reported as "that edit is not in the
                // trace" — it was, under another name. The earlier ones move into `also`, which is
                // where "what did this consist of" is looked up anyway.
                if let Some(refinement) = step.refinement {
                    if Some(&refinement) != open.refinement.as_ref() {
                        if let Some(previous) = open.refinement.replace(refinement) {
                            if !open.also.contains(&previous) {
                                open.also.push(previous);
                            }
                        }
                    }
                }
                open.failed = merge_failed(open.failed, step.failed);
                if step.at.is_some() {
                    open.last_at = step.at;
                }
            }
            _ => {
                blocks.push(Block {
                    act: step.act,
                    refinement: step.refinement,
                    signature: step.signature,
                    also: Vec::new(),
                    kind: step.kind,
                    steps: 1,
                    noise: 0,
                    compacts: std::mem::take(&mut pending_compacts),
                    failed: step.failed,
                    first_at: step.at.clone(),
                    last_at: step.at,
                });
            }
        }
    }
    blocks
}

/// Fold `A B A B …` into one link carrying its iteration count.
///
/// Only while **both** sides keep their refinement. A run of `verify(core) build(a) verify(core)
/// build(a)` is one cycle; changing either side ends it and starts a new link, because that is a
/// different piece of work and reporting it as another turn of the same wheel would say the
/// opposite of what happened.
/// One turn of a cycle, carrying whether it went badly.
fn round_of(block: &Block) -> Round {
    Round {
        act: block.act,
        refinement: block.refinement.clone(),
        failed: block.failed == Some(true),
    }
}

fn collapse_cycles(blocks: Vec<Block>) -> Vec<ChainLink> {
    let mut out: Vec<ChainLink> = Vec::new();
    let mut i = 0usize;

    while i < blocks.len() {
        // A cycle needs at least A B A, with the SAME A.
        let is_cycle = i + 2 < blocks.len()
            && same_anchor(&blocks[i], &blocks[i + 2])
            && blocks[i].act != blocks[i + 1].act;

        if !is_cycle {
            out.push(link_of(&blocks[i], None, Vec::new()));
            i += 1;
            continue;
        }

        let mut end = i + 2;
        let mut iterations = 2u32;
        let mut rounds = vec![round_of(&blocks[i]), round_of(&blocks[i + 1])];

        // Extend while the alternation holds: the anchor must stay identical, the other side only
        // has to stay the same *act*.
        while end + 1 < blocks.len()
            && blocks[end + 1].act == blocks[i + 1].act
            && end + 2 < blocks.len()
            && same_anchor(&blocks[end + 2], &blocks[i])
        {
            rounds.push(round_of(&blocks[end + 1]));
            end += 2;
            iterations += 1;
        }
        // A trailing half-turn still counts as one more round.
        if end + 1 < blocks.len() && blocks[end + 1].act == blocks[i + 1].act {
            rounds.push(round_of(&blocks[end + 1]));
            end += 1;
        }

        let merged = Block {
            act: blocks[i].act,
            refinement: blocks[i].refinement.clone(),
            signature: blocks[i].signature.clone(),
            also: Vec::new(),
            kind: blocks[i].kind,
            steps: blocks[i..=end].iter().map(|b| b.steps).sum(),
            noise: blocks[i..=end].iter().map(|b| b.noise).sum(),
            compacts: blocks[i..=end].iter().map(|b| b.compacts).sum(),
            // **The LAST round decides the cycle, not the worst one.** A loop that failed twice and
            // then went green ended green; carrying the failures up here would paint the whole thing
            // red and lose exactly the distinction the rounds are kept for.
            failed: blocks[end].failed,
            first_at: blocks[i].first_at.clone(),
            last_at: blocks[end].last_at.clone(),
        };
        out.push(link_of(&merged, Some(iterations), rounds));
        i = end + 1;
    }
    out
}

/// Whether two blocks are the same **anchor** of a cycle — same act and same refinement.
///
/// **The asymmetry is the whole design.** The anchor (the thing being returned to — usually the
/// check) must be identical, or two unrelated passes would fold together and report `×2` for two
/// successful pieces of work. The *other* side is deliberately loose: sixteen rounds of fixing
/// sixteen different files is still one agent stuck on one suite, and that is exactly the case the
/// counter exists to surface.
fn same_anchor(a: &Block, b: &Block) -> bool {
    a.act == b.act && a.refinement == b.refinement
}

fn link_of(block: &Block, iterations: Option<u32>, rounds: Vec<Round>) -> ChainLink {
    // The further refinements of a merged run ride in `rounds` — that is where the interface looks
    // for "what exactly did this consist of", whether it came from a cycle or from a run of edits.
    let rounds = if rounds.is_empty() && !block.also.is_empty() {
        block
            .also
            .iter()
            .map(|refinement| Round {
                act: block.act,
                refinement: Some(refinement.clone()),
                failed: false,
            })
            .collect()
    } else {
        rounds
    };
    ChainLink {
        act: block.act,
        refinement: block.refinement.clone(),
        signature: block.signature.clone(),
        outcome: Outcome::Unknown,
        kind: block.kind,
        reach: None,
        seconds: seconds_between(block.first_at.as_deref(), block.last_at.as_deref()),
        seconds_live: block.first_at.as_deref().map_or(0, super::seconds_since),
        steps: block.steps,
        noise: block.noise,
        compacts: block.compacts,
        reported: block.failed,
        iterations,
        rounds,
        guessed: true,
    }
}

/// Infer each link's outcome from what followed it (see [`Outcome`]).
///
/// **Only a `verify` has an outcome.** Everything else merely happened: a file was edited, a commit
/// was made, a directory was read. Painting those green says *checked and good* about work nothing
/// checked — and a chain where every link is green is a chain that has stopped carrying the one
/// signal it exists for. Reported from the running app, where four hours of mixed work rendered as
/// an unbroken column of green.
///
/// So the palette means exactly this: **green — a check that passed. Red — a check that failed.
/// Cyan — running now. Everything else is plain.**
fn settle_outcomes(links: &mut [ChainLink]) {
    let len = links.len();
    for i in 0..len {
        let next_act = links.get(i + 1).map(|l| l.act);
        let reported = links[i].reported;
        links[i].outcome = match (reported, links[i].act, next_act) {
            // Nothing after it: this is what is running, whatever kind of act it is.
            (_, _, None) => Outcome::Live,
            // **What the harness said, whenever it said anything.** Every tool result carries
            // `is_error`; using it turns the commonest mark in this panel from an inference into a
            // fact, for every act rather than only for a check.
            (Some(true), _, _) => Outcome::Failed,
            (Some(false), Act::Verify, _) => Outcome::Done,
            // A check followed by a fix had found something — the fallback, and only where nobody
            // reported: a shell line that swallows the status (`… ; echo "EXIT=$?"`) exits 0
            // whatever the gate did, so the edge is still the best available answer there.
            (None, Act::Verify, Some(Act::Edit)) => Outcome::Failed,
            (None, Act::Verify, Some(_)) => Outcome::Done,
            // Building, shipping, probing: they happened. Nothing pronounced them good.
            _ => Outcome::Unknown,
        };
        // A cycle whose last round was an edit never resolved: it stopped mid-repair. Not applied to
        // the newest link — that one is still going, and "running" outranks any verdict about how
        // its last round happened to end.
        //
        // **And only where nobody reported.** This inference used to overrule the harness's own
        // answer: a loop that failed twice and then went green was still painted red, because its
        // last recorded round was the fix that made it green. An inference that beats a fact is the
        // defect this whole change is about.
        let is_newest = i + 1 == len;
        if reported.is_none()
            && !is_newest
            && links[i].iterations.is_some()
            && links[i].act == Act::Verify
        {
            if let Some(last) = links[i].rounds.last() {
                if last.act == Act::Edit {
                    links[i].outcome = Outcome::Failed;
                }
            }
        }
    }
}

/// Seconds between two ISO timestamps, 0 when either is missing or unparseable.
///
/// Deliberately lenient: the timestamps come from somebody else's working file, and a duration is
/// worth less than the chain it sits in. A missing one costs a zero, never an error
/// (ADR-PROJ-005 §1 — the parser cannot fail on transcript-derived data).
fn seconds_between(from: Option<&str>, to: Option<&str>) -> u64 {
    let (Some(from), Some(to)) = (from, to) else {
        return 0;
    };
    let parse = |s: &str| chrono::DateTime::parse_from_rfc3339(s).ok();
    match (parse(from), parse(to)) {
        (Some(a), Some(b)) => (b - a).num_seconds().max(0) as u64,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(act: Act, refinement: &str) -> Step {
        Step::new(act, Some(refinement.to_string()))
    }

    fn probe() -> Step {
        Step::new(Act::Probe, None)
    }

    #[test]
    fn probes_fold_into_the_block_they_happened_inside() {
        // Half of every measured session is probing. Listed as links, a four-hour session is 196
        // boxes; folded, it is 18.
        let links = fold(vec![
            step(Act::Verify, "core"),
            probe(),
            probe(),
            probe(),
            step(Act::Ship, "commit"),
        ]);

        assert_eq!(links.len(), 2, "the probes are not links of their own");
        assert_eq!(links[0].noise, 3);
        assert_eq!(links[0].steps, 1);
    }

    #[test]
    fn a_session_that_only_ever_reads_is_still_a_session() {
        // **The first session in any repository, and it rendered as nothing at all.** Measured in
        // `kaoszwerg/mot` on 2026-08-08: an agent read the design and answered — 12 tool calls, ten
        // `Read` and two `Bash`, every one of them a probe. The reader saw all twelve and folded
        // them to **zero links**, so the panel fell through to its empty state and said *"no agent
        // has run in this directory"* about a directory an agent was working in. The maintainer
        // spent half an hour on it, and so did this agent, because the message blamed the wrong
        // thing.
        //
        // The rule that discarded them — "a session that begins with greps has not started working
        // yet" — is right, and it already carries its own limit four lines further down: past
        // `PROBE_RUN` a look-around *is* the work. That limit simply was not applied before the
        // first block existed, so at the start of a session it was "drop for ever" instead of
        // "drop until it is clearly what is happening".
        let links = fold(std::iter::repeat_with(probe).take(10).collect());

        assert_eq!(links.len(), 1, "looking around IS what happened here");
        assert_eq!(links[0].act, Act::Probe);
        assert_eq!(
            links[0].steps, 10,
            "and all ten are counted, not merely the ones past the threshold"
        );
    }

    #[test]
    fn a_short_look_around_that_leads_nowhere_still_shows_nothing() {
        // The other half of the same judgement, and it must not be lost while fixing the first: a
        // couple of look-ups at the start of a session is not yet work, and announcing it would put
        // a box on screen for every session anybody has ever opened.
        let links = fold(
            std::iter::repeat_with(probe)
                .take(PROBE_RUN as usize)
                .collect(),
        );

        assert!(links.is_empty(), "four is still 'has not started yet'");
    }

    #[test]
    fn a_leading_look_around_is_discarded_once_real_work_arrives() {
        // Unchanged behaviour, pinned because the fix above holds the probes rather than dropping
        // them immediately — and a held thing is a thing that can leak out later.
        let mut steps = std::iter::repeat_with(probe).take(3).collect::<Vec<_>>();
        steps.push(step(Act::Edit, "a.rs"));

        let links = fold(steps);

        assert_eq!(links.len(), 1, "the edit, and nothing before it");
        assert_eq!(links[0].act, Act::Edit);
    }

    #[test]
    fn a_look_around_across_many_files_is_one_act_of_looking_around() {
        // **The same fold that already merges a run of edits.** `merges` short-circuited on `Edit`
        // alone, so three edits to three files were one act of building while ten reads of ten files
        // were ten separate links — the same intent, implemented for one act and not the other. In
        // the measured session every `Read` named a different file.
        let links = fold(
            (0..10)
                .map(|i| Step::new(Act::Probe, Some(format!("{i}.md"))))
                .collect(),
        );

        assert_eq!(links.len(), 1, "one look-around, not ten");
        assert_eq!(links[0].steps, 10);
    }

    #[test]
    fn a_long_look_around_stops_being_a_footnote_of_the_act_before_it() {
        // **Reported twice, and the second time it was named exactly.** After a push, twenty
        // look-ups went on being counted as the push, so the panel announced `ship push` while the
        // agent was reading files: *"das push ist schon erledigt … so denke ich du tust etwas
        // völlig anderes"*. A handful still belongs to the act; a run of them is its own work.
        let mut steps = vec![step(Act::Ship, "push")];
        steps.extend(std::iter::repeat_with(probe).take(10));

        let links = fold(steps);

        assert_eq!(links.len(), 2, "the push, then the looking around");
        assert_eq!(links[0].act, Act::Ship);
        assert_eq!(links[0].noise, PROBE_RUN, "a few still ride along");
        assert_eq!(
            links[1].act,
            Act::Probe,
            "and the rest is what is happening now"
        );
        assert_eq!(links[1].steps, 6);
    }

    #[test]
    fn a_couple_of_look_ups_still_belong_to_what_they_followed() {
        // The other half, and the reason the threshold is not zero: reading a log after a test run
        // is part of the test, and splitting it out would undo the fold this tool exists for.
        let links = fold(vec![step(Act::Verify, "core"), probe(), probe(), probe()]);

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].noise, 3);
    }

    #[test]
    fn probes_before_any_work_are_dropped_rather_than_invented_into_a_block() {
        // A session that opens with a couple of greps has not started working. Attaching them to
        // the first real block would date that block to the session's start.
        //
        // **This used to say "twenty greps", and twenty is no longer true** — past `PROBE_RUN` a
        // leading look-around becomes its own link, because a session that only ever reads is still
        // a session (`a_session_that_only_ever_reads_is_still_a_session`). What this test pins is
        // the *short* case, which is what it always actually exercised.
        let links = fold(vec![probe(), probe(), step(Act::Edit, "a.rs")]);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].noise, 0);
    }

    fn compact() -> Step {
        Step::new(Act::Compact, None)
    }

    /// A step the harness pronounced on, rather than one the reader has to guess about.
    fn reported(act: Act, refinement: &str, failed: bool) -> Step {
        let mut step = step(act, refinement);
        step.failed = Some(failed);
        step
    }

    #[test]
    fn a_reported_result_beats_the_guess_from_the_next_step() {
        // **The commonest mark in this panel stops being an inference.** A check followed by an edit
        // was called failed — right when a gate goes red, wrong every time a green check is simply
        // followed by the next piece of work, and both were drawn identically. Every tool result
        // carries `is_error`; 20 of 1356 in the session this was written in.
        let links = fold(vec![
            reported(Act::Verify, "core", false),
            step(Act::Edit, "a.rs"),
            step(Act::Ship, "commit"),
        ]);

        assert_eq!(
            links[0].outcome,
            Outcome::Done,
            "it passed, and what followed says nothing about that"
        );

        // And the other direction, where the guess happened to agree.
        let links = fold(vec![
            reported(Act::Verify, "core", true),
            step(Act::Edit, "a.rs"),
            step(Act::Ship, "commit"),
        ]);
        assert_eq!(links[0].outcome, Outcome::Failed);
    }

    #[test]
    fn the_edge_still_answers_where_nobody_reported() {
        // The fallback has to stay: `npm run check:all > log; echo "EXIT=$?"` exits 0 whatever the
        // gate did, so nothing is reported and the following step is the best available answer.
        let links = fold(vec![
            step(Act::Verify, "core"),
            step(Act::Edit, "a.rs"),
            step(Act::Ship, "commit"),
        ]);

        assert_eq!(links[0].outcome, Outcome::Failed);
        assert_eq!(links[0].reported, None, "and it says nobody pronounced it");
    }

    #[test]
    fn a_cycle_ends_where_its_last_round_ended() {
        // "Three attempts, two of them red, green in the end" is the sentence a counter exists for.
        // Carrying the failures up would paint the whole loop red and lose it.
        let links = fold(vec![
            reported(Act::Verify, "core", true),
            step(Act::Edit, "a.rs"),
            reported(Act::Verify, "core", true),
            step(Act::Edit, "b.rs"),
            reported(Act::Verify, "core", false),
            step(Act::Ship, "commit"),
        ]);

        assert_eq!(links[0].iterations, Some(3));
        assert_eq!(links[0].outcome, Outcome::Done, "green in the end");
        assert!(
            links[0].rounds.iter().any(|r| r.failed),
            "and the red rounds are still on the record"
        );
    }

    #[test]
    fn a_run_of_edits_is_named_after_the_file_being_changed_now() {
        // **Reported as "that edit is not in the trace".** It was — under the name of the file
        // edited first, minutes earlier. A run of edits is one act, but its label has to answer
        // "what is happening", and the answer moved on. The earlier files are not lost: they are
        // where the panel already looks for what a block consisted of.
        let links = fold(vec![
            step(Act::Edit, "mod.rs"),
            step(Act::Edit, "classify.rs"),
            step(Act::Edit, "fold.rs"),
        ]);

        assert_eq!(links.len(), 1, "still one act");
        assert_eq!(
            links[0].refinement.as_deref(),
            Some("fold.rs"),
            "the newest"
        );
        let earlier: Vec<&str> = links[0]
            .rounds
            .iter()
            .filter_map(|r| r.refinement.as_deref())
            .collect();
        assert!(earlier.contains(&"mod.rs") && earlier.contains(&"classify.rs"));
    }

    #[test]
    fn a_compact_does_not_break_the_cycle_it_lands_in() {
        // **The case this exists for, and it is the interesting one.** An agent that loses its
        // context and then tries the same thing again is exactly what an iteration count is meant to
        // surface — so the seam must not be what hides it. As its own block a compact sat between
        // `A` and `A` and ended the alternation, and a loop of five turns was reported as two
        // unrelated pieces of work.
        let links = fold(vec![
            step(Act::Verify, "core"),
            step(Act::Edit, "a.rs"),
            compact(),
            step(Act::Verify, "core"),
            step(Act::Edit, "b.rs"),
            step(Act::Verify, "core"),
        ]);

        assert_eq!(links.len(), 1, "one loop, not two");
        assert_eq!(links[0].iterations, Some(3));
    }

    #[test]
    fn a_compact_is_still_reported_by_the_link_that_contains_it() {
        // It stops being a line of its own; it may not stop being visible. "The agent forgot what it
        // was doing here" is the single most useful thing this trace can say about a long session.
        let links = fold(vec![
            step(Act::Edit, "a.rs"),
            compact(),
            compact(),
            step(Act::Edit, "b.rs"),
        ]);

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].compacts, 2, "both seams, on the link they fall in");
    }

    #[test]
    fn a_compact_before_any_work_belongs_to_what_comes_after_it() {
        // A resumed session opens with the summary. There is nothing behind it to attach to, and
        // dropping it would lose the one event that explains why the trace starts mid-thought.
        let links = fold(vec![compact(), step(Act::Edit, "a.rs")]);

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].compacts, 1);
    }

    #[test]
    fn consecutive_identical_acts_are_one_block() {
        let links = fold(vec![
            step(Act::Edit, "a.rs"),
            step(Act::Edit, "a.rs"),
            step(Act::Edit, "a.rs"),
        ]);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].steps, 3);
    }

    #[test]
    fn an_alternation_folds_into_a_cycle_with_its_count() {
        // THE feature: `verify ⇄ build ×N` is the number that says "this is not progressing".
        let links = fold(vec![
            step(Act::Verify, "core"),
            step(Act::Edit, "a.rs"),
            step(Act::Verify, "core"),
            step(Act::Edit, "a.rs"),
            step(Act::Verify, "core"),
        ]);

        assert_eq!(links.len(), 1, "one link, not five");
        assert_eq!(links[0].iterations, Some(3));
        assert_eq!(links[0].act, Act::Verify);
    }

    #[test]
    fn two_independent_passes_are_not_one_cycle() {
        // The inversion this bound exists to prevent: a Rust suite fixed once and a TS suite fixed
        // once would read as `×2` — stagnation — when it is two successful passes.
        let links = fold(vec![
            step(Act::Verify, "rust"),
            step(Act::Edit, "a.rs"),
            step(Act::Verify, "typescript"),
            step(Act::Edit, "b.ts"),
        ]);

        assert!(
            links.iter().all(|l| l.iterations.is_none()),
            "different refinements are different work, not another turn of one wheel"
        );
        assert_eq!(links.len(), 4);
    }

    #[test]
    fn the_rounds_of_a_cycle_are_kept_so_the_two_readings_can_be_told_apart() {
        // 16 iterations over 16 files is a list being worked through; over one file it is stuck.
        // The counter alone cannot distinguish them, so the rounds ride along.
        let links = fold(vec![
            step(Act::Verify, "core"),
            step(Act::Edit, "a.rs"),
            step(Act::Verify, "core"),
            step(Act::Edit, "b.rs"),
            step(Act::Verify, "core"),
        ]);

        let rounds = &links[0].rounds;
        let files: Vec<&str> = rounds
            .iter()
            .filter(|r| r.act == Act::Edit)
            .filter_map(|r| r.refinement.as_deref())
            .collect();
        assert_eq!(files, vec!["a.rs", "b.rs"]);
    }

    #[test]
    fn a_verify_followed_by_a_build_was_red() {
        // Read from the following edge, never from an exit code — measured, only 6 of 381 tool
        // results carry one, because agents pipe test runs through `tail`.
        let links = fold(vec![
            step(Act::Verify, "core"),
            step(Act::Edit, "a.rs"),
            step(Act::Verify, "core2"),
            step(Act::Ship, "commit"),
        ]);

        assert_eq!(links[0].outcome, Outcome::Failed, "a fix followed it");
        assert_eq!(links[2].outcome, Outcome::Done, "this one was passed");
    }

    #[test]
    fn only_a_check_is_ever_green() {
        // Reported from the running app: four hours of mixed work rendered as an unbroken column of
        // green, because every link that was not the newest was called `Done`. Building and shipping
        // *happened* — nothing pronounced them good, and saying so drowns out the one signal the
        // chain exists to carry.
        let links = fold(vec![
            step(Act::Edit, "a.rs"),
            step(Act::Ship, "commit"),
            step(Act::Verify, "core"),
            step(Act::Ship, "push"),
        ]);

        assert_eq!(links[0].outcome, Outcome::Unknown, "an edit is not a pass");
        assert_eq!(links[1].outcome, Outcome::Unknown, "nor is a commit");
        assert_eq!(links[2].outcome, Outcome::Done, "the check is");
        assert_eq!(links[3].outcome, Outcome::Live, "and the last is running");
    }

    #[test]
    fn the_last_link_is_what_is_running() {
        let links = fold(vec![step(Act::Edit, "a.rs"), step(Act::Verify, "core")]);
        assert_eq!(links.last().expect("a link").outcome, Outcome::Live);
    }

    #[test]
    fn bookkeeping_never_becomes_a_link() {
        // Maintaining the task list is how the plan is recorded, not work in its own right — and a
        // `plan` link between every other step would be noise of the worst kind, the kind that
        // looks like content.
        let links = fold(vec![
            Step::new(Act::Plan, None).with_kind(Kind::Bookkeeping),
            step(Act::Edit, "a.rs"),
            Step::new(Act::Plan, None).with_kind(Kind::Bookkeeping),
        ]);

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].act, Act::Edit);
        assert_eq!(links[0].noise, 0, "bookkeeping is not noise either");
    }

    #[test]
    fn durations_come_from_the_timestamps_and_a_missing_one_costs_a_zero() {
        let steps = vec![
            Step::new(Act::Verify, Some("core".into())).at(Some("2026-08-06T12:00:00.000Z".into())),
            Step::new(Act::Verify, Some("core".into())).at(Some("2026-08-06T12:03:20.000Z".into())),
        ];
        assert_eq!(fold(steps)[0].seconds, 200);

        let no_time = vec![step(Act::Verify, "core"), step(Act::Verify, "core")];
        assert_eq!(fold(no_time)[0].seconds, 0, "never an error");
    }

    #[test]
    fn an_empty_session_is_an_empty_chain_and_not_a_failure() {
        assert!(fold(Vec::new()).is_empty());
        assert!(fold(vec![probe(), probe()]).is_empty());
    }
}
