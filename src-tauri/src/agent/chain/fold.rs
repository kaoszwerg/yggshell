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
    first_at: Option<String>,
    last_at: Option<String>,
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
    open.act == Act::Edit || open.refinement == step.refinement
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
                // Nothing open: a session that begins with greps has not started working yet.
                continue;
            }
        }
        match blocks.last_mut() {
            Some(open) if open.kind == step.kind && merges(open, &step) => {
                open.steps += 1;
                if let Some(refinement) = step.refinement {
                    if !open.also.contains(&refinement)
                        && Some(&refinement) != open.refinement.as_ref()
                    {
                        open.also.push(refinement);
                    }
                }
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
        let mut rounds = vec![
            Round {
                act: blocks[i].act,
                refinement: blocks[i].refinement.clone(),
            },
            Round {
                act: blocks[i + 1].act,
                refinement: blocks[i + 1].refinement.clone(),
            },
        ];

        // Extend while the alternation holds: the anchor must stay identical, the other side only
        // has to stay the same *act*.
        while end + 1 < blocks.len()
            && blocks[end + 1].act == blocks[i + 1].act
            && end + 2 < blocks.len()
            && same_anchor(&blocks[end + 2], &blocks[i])
        {
            rounds.push(Round {
                act: blocks[end + 1].act,
                refinement: blocks[end + 1].refinement.clone(),
            });
            end += 2;
            iterations += 1;
        }
        // A trailing half-turn still counts as one more round.
        if end + 1 < blocks.len() && blocks[end + 1].act == blocks[i + 1].act {
            rounds.push(Round {
                act: blocks[end + 1].act,
                refinement: blocks[end + 1].refinement.clone(),
            });
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
        steps: block.steps,
        noise: block.noise,
        compacts: block.compacts,
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
        links[i].outcome = match (links[i].act, next_act) {
            // Nothing after it: this is what is running, whatever kind of act it is.
            (_, None) => Outcome::Live,
            // A check followed by a fix had found something.
            (Act::Verify, Some(Act::Edit)) => Outcome::Failed,
            // A check followed by anything else was passed and the work moved on.
            (Act::Verify, Some(_)) => Outcome::Done,
            // Building, shipping, probing: they happened. Nothing pronounced them good.
            _ => Outcome::Unknown,
        };
        // A cycle whose last round was an edit never resolved: it stopped mid-repair. Not applied to
        // the newest link — that one is still going, and "running" outranks any verdict about how
        // its last round happened to end.
        let is_newest = i + 1 == len;
        if !is_newest && links[i].iterations.is_some() && links[i].act == Act::Verify {
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
        // A session that opens with twenty greps has not started working. Attaching them to the
        // first real block would date that block to the session's start.
        let links = fold(vec![probe(), probe(), step(Act::Edit, "a.rs")]);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].noise, 0);
    }

    fn compact() -> Step {
        Step::new(Act::Compact, None)
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
