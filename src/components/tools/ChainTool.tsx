import { useEffect, useRef, useState } from "react";
import { copyText } from "../../lib/clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { environmentApi } from "../../api/environment";
import { useTerminalStore } from "../../store/terminal";
import { Button } from "../ui/Button";
import type { Adoption } from "../../bindings/Adoption";
import type { Chain } from "../../bindings/Chain";
import type { ChainLink } from "../../bindings/ChainLink";
import type { Round } from "../../bindings/Round";
import { useChain } from "../../hooks/useChain";
import { useToolFontSize } from "../../hooks/useContentFontSize";
import { useT } from "../../hooks/useT";
import { Disclosure } from "../ui/Disclosure";
import { Splitter } from "../ui/Splitter";
import { Tooltip } from "../ui/Tooltip";
import { CHAIN_SPLIT_MAX, CHAIN_SPLIT_MIN, useUiStore } from "../../store/ui";
import type { PlanStep } from "../../bindings/PlanStep";

/**
 * What the agent in this tab has been through, and what it is doing now.
 *
 * **Two layers over one reader** (`mem:surfaces`): the *plan* comes from the agent's own task list,
 * the *trace* from its transcript — both out of the same file in the same pass. The plan says where
 * the work is going; the trace says how it is going. Neither replaces the other, and when the plan
 * is missing the trace still stands.
 *
 * **The whole surface is content** (rule:content-size). The block type, the target, the durations
 * and the counts all read like a terminal, so the size sits once on the container that holds the
 * header *and* the chain, and everything inside is relative. Drawn with a fixed header, turning the
 * text up would leave the line that says what is running as the smallest thing on screen — the
 * inversion that rule records from the Markdown headings. Only the tool's own name is chrome.
 */
export function ChainTool() {
  const t = useT();
  const { chain, isPending, isError, ready } = useChain();
  const fontSize = useToolFontSize();
  const split = useUiStore((s) => s.chainSplit);
  const setSplit = useUiStore((s) => s.setChainSplit);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The drag reports a share of this element's height, not a pixel offset — the same reasoning as
  // the Git tool's divider: a screen coordinate drifts the moment the window moves.
  const toShare = (clientY: number) => {
    const box = bodyRef.current?.getBoundingClientRect();
    if (!box || box.height === 0) return split;
    return ((clientY - box.top) / box.height) * 100;
  };

  if (!ready) return <Empty>{t("chain.noTerminal")}</Empty>;
  if (isError) return <Empty>{t("chain.failed")}</Empty>;
  if (isPending) return <Empty>{t("chain.reading")}</Empty>;
  // **The offer comes before the chain does, and that is the whole point.** It was nested in the
  // busy rendering path, so a repository with no transcript yet — or an agent at rest — showed
  // "nothing here" and no offer: it was invisible in exactly the situation it exists for, which is
  // opening a project that has never heard of the convention. Measured on lysisai-dsp, which has
  // neither file and was offered neither.
  // **Two different silences, and saying the wrong one costs an evening.** `null` means no
  // transcript was found: nobody has run an agent here, and the message may say so. An empty
  // `links` means a transcript *was* read and nothing in it became a link — a statement about this
  // reader, not about the directory. It used to say "no agent has run in this directory" for both,
  // which is a confident claim the tool had not established (rule:logging): the maintainer and this
  // agent between them spent an hour looking for a broken lookup that was working the whole time,
  // because the panel blamed the repository.
  //
  // The second message therefore says what actually happened and names the file, so the next person
  // starts where the answer is instead of where it is not.
  if (chain === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col font-mono" style={{ fontSize: `${fontSize}px` }}>
        <Undeclared />
        <Empty>{t("chain.none")}</Empty>
      </div>
    );
  }
  if (chain.links.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col font-mono" style={{ fontSize: `${fontSize}px` }}>
        <Undeclared />
        <Empty>{t("chain.nothingRecognised")}</Empty>
        {/* The coverage the reader reports on itself (ADR-PROJ-005), and the session it read — the
            two facts that point at this tool rather than at the repository. Chrome, so it keeps the
            fixed size `Empty` uses rather than the content size (rule:content-size). */}
        <p className="text-dim -mt-2 px-3 text-center font-mono text-[11px]">
          <code>
            {chain.steps_seen}/{chain.steps_understood}
          </code>{" "}
          {t("chain.seenUnderstood")}
          {chain.session_id ? (
            <>
              {" · "}
              <code>{chain.session_id.slice(0, 8)}</code>
            </>
          ) : null}
        </p>
      </div>
    );
  }

  const running = chain.links.at(-1);
  // A plan is worth its own region only while something in it is still open. Finished, it is
  // history — the header says so in one line, and the trace below is the record.
  const showPlan = chain.plan.some((step) => step.status !== "completed");
  // **And when nothing is outstanding at all, the panel says one line and stops.**
  //
  // The maintainer, twice: *"plan abgeschlossen und du bist mit allem fertig … es wird gar nichts
  // angezeigt, alles erledigt"*. Sixty-one links of finished work is a logbook, not a status — and
  // a panel that looks equally busy whether or not anything is happening has stopped answering the
  // question it was opened for. The record is still there, one keystroke away.
  const atRest = chain.standing === "idle" && !showPlan;

  return (
    // No header of its own: the tool column already draws one with this tool's name, and two
    // identical titles above each other is the panel telling you twice what it is.
    //
    // **The size hangs on the CONTENT, not on the tool.** It used to sit here, on the body, and
    // that made this panel visibly larger than every other tool at the same setting: the heading,
    // the legend, the footer and — because the padding is written in `em` — even the spacing grew
    // with it, while Files, Agent, Docker, Activity, Tmux and Notes all keep their chrome fixed and
    // scale only the region you read. Reported as exactly that. `rule:content-size` draws the line
    // where those tools draw it: the trace and the plan are content, the rest is interface.
    <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col font-mono">
      {running === undefined ? null : <Now chain={chain} link={running} />}
      {showPlan ? <Goal chain={chain} /> : null}

      {/* **Outside every branch below, deliberately.** This is about the repository, not about the
          chain, and it was first written inside the trace — where an agent at rest never reaches it.
          Measured on lysisai-dsp: 62 links, nothing outstanding, neither file present, and no offer
          shown. The one state a foreign project is usually in was the one state it was invisible. */}
      <Undeclared />

      {/* Two scrolling regions, not one. A plan is a handful of lines somebody wants to keep in
          view; the trace grows all day. Sharing a scrollbar means the plan leaves the screen exactly
          when the work gets long — which is when it is worth having. The boundary is the user's,
          and where they put it is remembered (`chainSplit`).

          **A finished plan is not shown at all.** The harness clears its list the moment nothing is
          open, and nineteen struck-through lines saying "all done" is a panel asking for attention
          it does not need. The header says everything is done; the trace below is the record. */}
      {showPlan ? (
        <>
          <div
            className="min-h-0 overflow-x-hidden overflow-y-auto px-2 pt-2"
            // Content, not chrome: a plan reads like a terminal, at the size chosen for one.
            style={{ height: `${split}%`, fontSize: `${fontSize}px` }}
          >
            <SectionLabel>{t("chain.plan")}</SectionLabel>
            <ul aria-label={t("chain.plan")}>
              {orderPlan(chain.plan).map((step) => (
                <PlanRow key={step.id} subject={step.subject} status={step.status} />
              ))}
            </ul>
          </div>
          <Splitter
            label={t("chain.splitLabel")}
            orientation="horizontal"
            value={split}
            min={CHAIN_SPLIT_MIN}
            max={CHAIN_SPLIT_MAX}
            onChange={setSplit}
            toValue={toShare}
          />
        </>
      ) : null}

      {atRest ? (
        <RestingRecord chain={chain} />
      ) : (
        <div
          data-chain-trace
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2"
          // Content: the trace is the same kind of reading as the terminal beside it.
          style={{ fontSize: `${fontSize}px` }}
        >
          {chain.plan.length === 0 && !showPlan ? (
            <NoPlan done={chain.plan_done} />
          ) : (
            <SectionLabel>{t("chain.trace")}</SectionLabel>
          )}

          {/* Oldest first, exactly as the work happened, with what is running at the bottom and the
            expectation below it — reversed, the expectation would hang under the oldest link and
            read as its cause. */}
          {chain.links.map((link, index) => (
            <Link key={`${link.act}-${link.refinement ?? ""}-${index}`} link={link} />
          ))}

          {/* Between the chain and the expectation, not after it: the thing to keep in view is the
            step that is RUNNING, and anchoring below the dashed links would push it up by however
            many of them there happen to be. */}
          <TailAnchor count={chain.links.length} />

          {chain.expected.map((round, index) => (
            <Ahead key={`${round.act}-${index}`} round={round} />
          ))}
        </div>
      )}

      <LegendBar />
      <Footer chain={chain} />
    </div>
  );
}

/**
 * What the panel shows when there is nothing to show.
 *
 * One line, and the record behind it. The alternative — leaving sixty-one finished links on screen
 * — makes the tool look identically busy whether or not anything is happening, which is the same
 * defect as a signal that is always on: it stops carrying information (rule:attention-signals).
 */
function RestingRecord({ chain }: { chain: Chain }) {
  const t = useT();
  const fontSize = useToolFontSize();
  return (
    <div
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2"
      // The folded record is the same content as the trace it replaces, so it is sized like it.
      style={{ fontSize: `${fontSize}px` }}
    >
      <Disclosure
        summaryClassName="text-dim"
        summary={<span>{t("chain.showRecord", { n: String(chain.links.length) })}</span>}
      >
        <div className="mt-[0.6em]">
          {chain.links.map((link, index) => (
            <Link key={`${link.act}-${link.refinement ?? ""}-${index}`} link={link} />
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

/**
 * Keeps the running step in view as the chain grows — **unless the reader has scrolled up.**
 *
 * The maintainer's requirement, and it is two rules rather than one:
 *
 * - **Follow by default.** The step being worked on is the reason the panel is open; having to
 *   scroll to it after every poll would make the tool something you operate instead of something
 *   you glance at.
 * - **Never yank.** Scrolling up to read an earlier link and being dragged back by an arriving one
 *   is worse than scrolling down once. So following stops the moment the reader leaves the end, and
 *   resumes by itself when they return.
 *
 * The tolerance is generous on purpose: the dashed expectation sits below this anchor, so being
 * "at the end" has to mean "the running step is in view", not "scrolled to the last pixel".
 */
const FOLLOW_TOLERANCE_PX = 140;

function TailAnchor({ count }: { count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const node = ref.current;
    const box = node?.parentElement;
    if (!node || !box) return;

    const atEnd = () => box.scrollHeight - box.scrollTop - box.clientHeight < FOLLOW_TOLERANCE_PX;
    const onScroll = () => {
      following.current = atEnd();
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    // `scrollTop`, not `scrollIntoView`: it moves only this box (the latter can scroll every
    // ancestor, including the window), and it is a plain property rather than a method jsdom does
    // not implement — so the behaviour is testable rather than only observable by hand.
    if (following.current) box.scrollTop = box.scrollHeight;
    return () => box.removeEventListener("scroll", onScroll);
  }, [count]);

  return <div ref={ref} aria-hidden />;
}

/** The one line that answers "what is it doing" without scrolling. */
function Now({ chain, link }: { chain: Chain; link: ChainLink }) {
  const t = useT();
  const waiting = chain.standing === "waiting";
  const working = chain.standing === "working";
  const openSteps = chain.plan.filter((s) => s.status !== "completed").length;

  return (
    <div
      className={`shrink-0 border-b border-white/6 bg-gradient-to-r px-[0.6em] py-[0.45em] ${
        waiting ? "from-amber-300/12" : working ? "from-cyan-400/6" : "from-transparent"
      } to-transparent`}
    >
      <div
        className={`flex items-baseline gap-[0.4em] text-[1.05em] ${
          waiting ? "text-gold" : working ? "text-cyan" : "text-dim"
        }`}
      >
        {waiting ? (
          <span className="tracking-wider">{t("chain.waiting")}</span>
        ) : working ? (
          <>
            <span className="tracking-wider">{actWord(link.act, t)}</span>
            {link.refinement === null ? null : (
              <span className="text-dim min-w-0 truncate text-[0.85em]">{link.refinement}</span>
            )}
            <Reach link={link} />
          </>
        ) : (
          <span className="tracking-wider">
            {openSteps > 0 ? t("chain.stopped") : t("chain.finished")}
          </span>
        )}
      </div>

      <div className="text-dim mt-[0.1em] truncate text-[0.85em] tabular-nums">
        {waiting
          ? (chain.waiting_for ?? t("chain.waitingUnspecified"))
          : working
            ? // The RUNNING STEP's own duration, not the session's. It said "running for 4:26 h"
              // about a step that had started a minute earlier — the number was real and answered a
              // different question than the sentence around it asked.
              t("chain.running", { duration: duration(Number(link.seconds), t) }) +
              (link.iterations === null
                ? ""
                : ` · ${t("chain.attempt", { n: String(link.iterations) })}`)
            : openSteps > 0
              ? t("chain.openSteps", { n: String(openSteps) })
              : t("chain.quietFor", { duration: duration(Number(chain.idle), t) })}
      </div>

      <BackgroundRuns chain={chain} />
    </div>
  );
}

/**
 * What is still running after the agent stopped.
 *
 * **Drawn under the state line rather than inside it**, because it answers a different question.
 * The line above says whether the agent owes you something; this says whether the machine is busy —
 * and "nothing outstanding" was being read as "nothing is happening" while a build compiled for
 * minutes. Folding it into `working` would put back the inferred state that was just cut out of it:
 * the agent really has finished.
 */
function BackgroundRuns({ chain }: { chain: Chain }) {
  const t = useT();
  if (chain.background.length === 0) return null;
  return (
    <div className="mt-[0.35em] flex flex-col gap-[0.15em]">
      {chain.background.map((run, index) => (
        <div
          key={`${run.act}-${index}`}
          className={`flex items-baseline gap-[0.4em] text-[0.85em] tabular-nums ${
            run.failed ? "text-danger" : "text-dim"
          }`}
        >
          <span aria-hidden>{run.failed ? "▲" : "↻"}</span>
          <span className="tracking-wider">{actWord(run.act, t)}</span>
          {run.refinement === null ? null : (
            <span className="min-w-0 truncate">{run.refinement}</span>
          )}
          <span className="ml-auto shrink-0">
            {run.failed ? t("chain.backgroundFailed") : duration(Number(run.seconds), t)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Where the run reaches. Always drawn when known — including `local`.
 *
 * `rule:work-legibility` calls this "the axis that cannot be guessed and the one that hurts when it
 * is wrong". A tool that showed it only for production would teach people that its absence means
 * safety, which is exactly backwards: absence means nobody declared it.
 */
function Reach({ link }: { link: ChainLink }) {
  const t = useT();
  if (link.reach === null) return null;
  const far = link.reach.target === "prod" || link.reach.target === "staging";
  const label = link.reach.host ?? link.reach.target;
  return (
    <Tooltip
      content={
        link.reach.disputed
          ? t("chain.disputed")
          : `${link.reach.target} · ${link.reach.host ?? ""}`
      }
    >
      <span
        className={`min-w-0 shrink truncate text-[0.8em] ${far ? "text-gold" : "text-dim"} ${
          link.reach.disputed ? "decoration-danger underline decoration-wavy" : ""
        }`}
      >
        {"→ "}
        {label}
      </span>
    </Tooltip>
  );
}

function Goal({ chain }: { chain: Chain }) {
  const t = useT();
  const done = chain.plan.filter((s) => s.status === "completed").length;
  return (
    <div className="shrink-0 border-b border-white/6 px-[0.6em] py-[0.45em]">
      <div className="text-purple text-[0.7em] tracking-[0.18em] uppercase">{t("chain.goal")}</div>
      {/* The step being worked towards, not `plan[0]`. The first task is where the list started,
          which after an hour is the least interesting line in it — and on a finished plan it made a
          completed step masquerade as the goal. */}
      <div className="text-fg truncate text-[0.9em]">
        {
          (
            chain.plan.find((s) => s.status === "in_progress") ??
            chain.plan.find((s) => s.status !== "completed")
          )?.subject
        }
      </div>
      <div className="mt-[0.35em] flex items-center gap-[2px]">
        {chain.plan.map((step) => (
          <i
            key={step.id}
            className={`h-[0.3em] flex-1 ${
              step.status === "completed"
                ? "bg-green"
                : step.status === "in_progress"
                  ? "bg-cyan"
                  : "bg-white/12"
            }`}
            aria-hidden
          />
        ))}
        <span className="text-dim ml-[0.35em] text-[0.75em] tabular-nums">
          {done}/{chain.plan.length}
        </span>
      </div>
    </div>
  );
}

/**
 * One step of the agent's plan, drawn the way the harness draws its own list.
 *
 * **What is finished recedes; what is running stands out.** The first version painted completed
 * steps green, which made them the loudest thing on a list where everything eventually completes —
 * a plan of nineteen finished tasks was nineteen bright green lines and no visible state at all.
 * Green means "a check passed" in the trace below; using it for "done" here made it mean two things.
 *
 * So: done is struck through and dimmed, exactly as a crossed-off list looks; running is the only
 * line with an accent; pending is plain, waiting its turn.
 */
/**
 * The plan as it should be read: **what is left, then what is done.**
 *
 * Reported from the running app — a finished task was struck through and left where it was, so the
 * open work sat scattered among the done work and the list had to be searched rather than read. On a
 * list of nineteen that is the difference between a plan and a log.
 *
 * - **Open work keeps the order it was created in.** That order is the agent's own sequencing and
 *   carries real information about what it intends to do next.
 * - **Finished work follows, in the order it finished.** Not creation order: what a reader looks
 *   back at is *what happened*, and the sequence in which things were completed is the only account
 *   of that the list has. `done_at` exists for exactly this and comes out of the transcript, so it
 *   survives a poll and a compaction.
 *
 * Sorted here rather than in the reader on purpose: `chain.plan` means *the order the agent created
 * them*, which is a fact about the session. **How to read it is a question about a screen**, and a
 * DTO that arrives pre-sorted for one surface would quietly decide it for every other.
 *
 * A finished step with no rank — from a transcript read before the field existed — keeps its place
 * among the finished rather than jumping to the top: `Infinity` sorts it last, and being slightly
 * out of order is a much smaller lie than appearing to be open work.
 */
function orderPlan(plan: readonly PlanStep[]): PlanStep[] {
  const done = (step: PlanStep) => step.status === "completed";
  return [...plan].sort((a, b) => {
    if (done(a) !== done(b)) return done(a) ? 1 : -1;
    if (!done(a)) return 0; // stable: both open, so creation order stands
    return (a.done_at ?? Infinity) - (b.done_at ?? Infinity);
  });
}

function PlanRow({ subject, status }: { subject: string; status: string }) {
  const done = status === "completed";
  const running = status === "in_progress";
  return (
    // `li`, because it is one: a plan is an ordered list of steps, and saying so is what lets a
    // screen reader announce "3 of 7" instead of reading seven unrelated lines.
    <li className="flex items-baseline gap-[0.5em] pb-[0.35em]">
      <Node state={done ? "done" : running ? "live" : "todo"} />
      <span
        className={`min-w-0 flex-1 truncate ${
          done ? "text-dim line-through" : running ? "text-cyan" : "text-fg"
        }`}
      >
        {subject}
      </span>
    </li>
  );
}

/** One chain link, with its cycle detail behind a disclosure. */
function Link({ link }: { link: ChainLink }) {
  const t = useT();
  // `unknown` is its own mark, not "todo". A finished `ship commit` was drawn with the hollow
  // outline that means *still to come* — reported as an icon nobody could read, and it was saying
  // the opposite of the truth. It happened; nothing pronounced it good or bad.
  const state =
    link.outcome === "failed"
      ? "failed"
      : link.outcome === "live"
        ? "live"
        : link.outcome === "done"
          ? "done"
          : "happened";
  const colour =
    state === "failed"
      ? "text-danger"
      : state === "live"
        ? "text-cyan"
        : state === "done"
          ? "text-green"
          : "text-dim";

  const head = (
    <>
      <span className={`tracking-wider ${link.iterations === null ? colour : "text-gold"}`}>
        {actWord(link.act, t)}
      </span>
      {link.refinement === null ? null : (
        <span className="text-dim min-w-0 flex-1 truncate text-[0.85em]">{link.refinement}</span>
      )}
      {link.iterations === null ? null : (
        // The number carries the whole message of this link, so it says what it counts rather than
        // leaving a bare `2×` to be decoded. Reported: "ich verstehe auch nicht das gelbe 2x badge".
        <Tooltip content={t("chain.iterationsExplain", { n: String(link.iterations) })}>
          <span className="bg-gold text-deep shrink-0 px-[0.4em] text-[0.8em] font-bold">
            {t("chain.iterations", { n: String(link.iterations) })}
          </span>
        </Tooltip>
      )}
      {link.guessed ? <Guessed /> : null}
      {/* Where it reached, on the link itself and not only in the header — the header shows one
          line, and "am I about to hit production?" is a question about the step you are reading. */}
      <Reach link={link} />
      <span className="text-dim ml-auto shrink-0 text-[0.8em] tabular-nums">
        {duration(Number(link.seconds), t)}
      </span>
    </>
  );

  // What the rounds are is stated, not implied. Without the heading a list of bare filenames under
  // "verify unit 2×" is unreadable — reported in exactly those words.
  const detail = link.rounds.length > 0 && (
    <div className="border-gold/25 mt-[0.3em] ml-[1em] flex flex-col gap-[0.1em] border-l pl-[0.5em]">
      <div className="text-dim/80 text-[0.78em]">
        {link.iterations === null ? t("chain.roundsAlso") : t("chain.roundsHeading")}
      </div>
      {link.rounds.map((round: Round, index: number) => (
        <div key={index} className="text-dim flex gap-[0.5em] text-[0.85em]">
          <span className="text-gold/80 shrink-0 tabular-nums">{index + 1}</span>
          <span className="shrink-0">{actWord(round.act, t)}</span>
          <span className="min-w-0 truncate">{round.refinement ?? ""}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex gap-[0.5em] pb-[0.55em]">
      <Node
        state={state}
        cycle={link.iterations !== null}
        stumbled={link.rounds.some((round) => round.failed)}
      />
      <div className="min-w-0 flex-1">
        {detail === false ? (
          <div className="flex items-baseline gap-[0.4em]">{head}</div>
        ) : (
          <Disclosure summary={head} label={t("chain.openDetail")}>
            {detail}
          </Disclosure>
        )}
        <Meta link={link} />
      </div>
    </div>
  );
}

/**
 * The small print under a link: folded probes and delegation.
 *
 * **Nothing is drawn when there is nothing to say.** The guess marker used to hang here on its own,
 * so a link whose only note was "this was guessed" got a whole line containing one tilde — which
 * reads as a rendering fault rather than as information. It now rides beside the title, where the
 * thing it qualifies actually is.
 */
function Meta({ link }: { link: ChainLink }) {
  const t = useT();
  const notes: string[] = [];
  if (link.kind === "delegated") notes.push(t("chain.delegated", { n: String(link.steps) }));
  if (link.noise > 0) notes.push(t("chain.probes", { n: String(link.noise) }));
  // **The seam gets its own line, and it is not dim.** A compact is not a tally like the others: it
  // is the moment the agent stopped knowing what it had been doing, and everything odd below it
  // follows from that. It is drawn here rather than as a step of its own because as a step it broke
  // every cycle it fell into — see `ChainLink.compacts`.
  const seam =
    link.compacts > 0 ? (
      <div className="text-gold/80 truncate text-[0.78em]">
        {t("chain.compacted", { n: String(link.compacts) })}
      </div>
    ) : null;
  if (notes.length === 0) return seam;
  return (
    <>
      {seam}
      <Tooltip content={t("chain.probesExplain")}>
        <div className="text-dim truncate text-[0.78em]">{notes.join(" · ")}</div>
      </Tooltip>
    </>
  );
}

/** The mark that says a classification came from the heuristic rather than from a declaration. */
function Guessed() {
  const t = useT();
  return (
    <Tooltip content={t("chain.guessed")}>
      <span className="text-dim shrink-0 text-[0.8em]" aria-label={t("chain.guessed")}>
        ~
      </span>
    </Tooltip>
  );
}

/** An expectation from this session's own edges. Drawn unmistakably differently from a plan. */
function Ahead({ round }: { round: Round }) {
  const t = useT();
  return (
    <div className="flex items-baseline gap-[0.5em] pb-[0.5em] opacity-70">
      <Node state="ahead" />
      <span className="text-dim tracking-wider">{actWord(round.act, t)}</span>
      <span className="text-dim text-[0.8em]">
        {t("chain.expected", { n: round.refinement ?? "1" })}
      </span>
    </div>
  );
}

/**
 * The state marker.
 *
 * **Shape carries the meaning, colour only reinforces it.** Under `prefers-reduced-motion` the
 * pulse is gone, so a live and a done link would otherwise differ by hue alone — and the two states
 * that differ only in border colour were unreadable with deuteranopia. Every marker also carries a
 * text alternative, which doubles as the legend the panel has no room for.
 */
function Node({
  state,
  cycle = false,
  stumbled = false,
}: {
  state: "done" | "failed" | "live" | "todo" | "ahead" | "happened";
  cycle?: boolean;
  /** A round inside this cycle failed, whatever the whole thing came to in the end. */
  stumbled?: boolean;
}) {
  const t = useT();
  // **A bad ending is a triangle, whether or not it looped.** How it came out is the first question
  // and the shape answers it; that a loop happened is the ring, and how many times is the counter
  // beside it. The maintainer's own formulation: *"roter Kreis mit grün ist multiturn mit Ergebnis
  // grün, und nur grün ist alles gut"* — so the ring may now be red while its centre is green,
  // which is the one thing the old drawing could not say.
  const ring = cycle && state !== "failed";
  const shape = ring
    ? "rounded-full border-[0.16em]"
    : state === "failed"
      ? "[clip-path:polygon(50%_0,100%_100%,0_100%)]"
      : "[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]";

  // A switch rather than an object lookup: the union already makes the lookup total, but an indexed
  // read is what `security/detect-object-injection` is there to catch and the exemption would have
  // to be argued at every future reader (rule:security — never silence a check to go green).
  // The ring says a round went badly; the centre says how the whole thing came out.
  const border = stumbled ? "border-danger" : "border-green";
  const paint = ((): string => {
    switch (state) {
      case "done":
        return ring ? `${border} bg-green/70` : "bg-green/70";
      // A bad ending never draws a ring, so there is no centre to fill here.
      case "failed":
        return "bg-danger";
      case "live":
        return ring
          ? `${border} bg-cyan motion-safe:animate-pulse`
          : "bg-cyan motion-safe:animate-pulse";
      // Filled, so it reads as "this is behind us", but in the neutral colour, so it does not claim
      // to have been checked. Hollow would mean the opposite — still to come.
      case "happened":
        return ring ? `${border} bg-dim` : "bg-dim";
      case "todo":
        return "border border-dim bg-transparent";
      case "ahead":
        return "border border-dashed border-dim bg-transparent";
    }
  })();

  // The label is for a screen reader, not a tooltip: a hint on every mark fires constantly while
  // reading the chain, which is noise. What a mark means is looked up **on demand**, in the legend
  // at the foot — asked for in those words.
  return (
    <span
      className={`mt-[0.3em] size-[0.75em] shrink-0 ${shape} ${paint}`}
      role="img"
      aria-label={stateMeaning(state, cycle, t)}
    />
  );
}

/**
 * The marks and what they mean, folded away until somebody asks.
 *
 * **Grouped by where a mark can appear, not by colour.** The same six shapes serve two different
 * questions — *"how did that go?"* about the trace, and *"what is still outstanding?"* about the
 * plan — and a flat list of six answers neither. Asked in exactly those terms: *"was sagt mir jetzt
 * was noch geplant ist und was noch aussteht?"*. So each group is headed by the region it belongs
 * to, and a mark that appears in both regions is listed in both.
 */
function Legend() {
  const t = useT();
  const groups: {
    heading: "chain.legend.trace" | "chain.legend.plan" | "chain.legend.ahead";
    marks: ("done" | "failed" | "live" | "todo" | "ahead" | "happened")[];
    cycle?: boolean;
  }[] = [
    { heading: "chain.legend.trace", marks: ["live", "failed", "done", "happened"], cycle: true },
    { heading: "chain.legend.plan", marks: ["live", "todo", "done"] },
    { heading: "chain.legend.ahead", marks: ["ahead"] },
  ];

  return (
    <Disclosure
      summaryClassName="text-dim text-[0.75em]"
      summary={<span>{t("chain.legend")}</span>}
      contentClassName="mt-[0.4em] flex flex-col gap-[0.55em] pb-[0.3em]"
    >
      {groups.map((group) => (
        <div key={group.heading} className="flex flex-col gap-[0.25em]">
          <div className="text-dim/70 text-[0.7em] tracking-[0.12em] uppercase">
            {t(group.heading)}
          </div>
          {group.marks.map((mark) => (
            <div key={mark} className="text-dim flex items-baseline gap-[0.6em] text-[0.8em]">
              <Node state={mark} />
              <span className="min-w-0">{stateMeaning(mark, false, t)}</span>
            </div>
          ))}
          {group.cycle === true ? (
            <>
              <div className="text-dim flex items-baseline gap-[0.6em] text-[0.8em]">
                <Node state="done" cycle />
                <span className="min-w-0">{t("chain.mark.cycle")}</span>
              </div>
              <div className="text-dim flex items-baseline gap-[0.6em] text-[0.8em]">
                <Node state="done" cycle stumbled />
                <span className="min-w-0">{t("chain.mark.cycleStumbled")}</span>
              </div>
            </>
          ) : null}
        </div>
      ))}
    </Disclosure>
  );
}

/**
 * The offer shown to a repository that has never heard of the convention.
 *
 * **Two buttons because there are two channels, and they are not interchangeable**
 * (`src-tauri/src/adoption.rs`). The gate is machinery and is *written*; the rule is text for
 * another agent's context and is *copied*, because the repositories this is meant for do not consume
 * this app's governance and cannot be reached by any cascade.
 *
 * It sits here for the same reason the plan nudge does: this is the moment somebody notices the
 * absence — every level in the trace marked as a guess.
 */
/**
 * Asks what this repository has of the convention, and offers what it is missing.
 *
 * **Also for a repository that already adopted**, which is the case the first version could not
 * serve at all: the offer only existed where no declaration did, so once a project had one there
 * was no way to hand it the manual again — and no way to learn that the gate it copied is behind
 * the one this app now ships. A copy inside somebody's repository is never rewritten silently
 * (`adoption::Adoption`); it is reported, and updating it stays a button they press.
 */
function Undeclared() {
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);
  const state = useQuery({
    queryKey: ["adoption", cwd],
    queryFn: () => (cwd === null ? null : environmentApi.adoptionState(cwd)),
    enabled: cwd !== null,
  });
  // Absent or still loading, nothing is offered: proposing to fix something that may not be missing
  // is worse than proposing nothing. Its own padding, so the caller can drop it anywhere without
  // leaving an empty box behind when there is nothing to say.
  if (cwd === null || !state.data) return null;
  if (state.data.declared && !state.data.gate_stale) return null;
  return (
    <div className="shrink-0 px-2 pt-2">
      <NoDeclaration cwd={cwd} state={state.data} />
    </div>
  );
}

function NoDeclaration({ cwd, state }: { cwd: string; state: Adoption }) {
  const t = useT();
  const [gatePath, setGatePath] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // `copyText` already reports both outcomes as a toast — the one confirmation path in this app
  // (rule:reusability). A second one here would eventually disagree with it.
  const copyRule = async () => {
    setFailed(false);
    try {
      copyText(await environmentApi.adoptionRule(), "chain.copyRuleDone");
    } catch {
      setFailed(true);
    }
  };
  const installGate = async () => {
    setFailed(false);
    try {
      setGatePath(await environmentApi.adoptionInstallGate(cwd));
    } catch {
      // Logged in the backend; the user is told here rather than in a console they cannot see.
      setFailed(true);
    }
  };

  return (
    <div className="border-dim/25 text-dim mb-2 border border-dashed px-2 py-1.5 text-[11px]">
      <b className="text-fg mb-0.5 block font-medium">
        {state.declared ? t("chain.gateStale") : t("chain.undeclared")}
      </b>
      {state.declared ? t("chain.gateStaleHint") : t("chain.undeclaredHint")}
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Button variant="ghost" accent="cyan" onClick={() => void copyRule()}>
          {t("chain.copyRule")}
        </Button>
        <Button variant="ghost" accent="purple" onClick={() => void installGate()}>
          {state.gate ? t("chain.updateGate") : t("chain.installGate")}
        </Button>
      </div>
      {gatePath === null ? null : (
        <div className="text-green mt-1 break-all">
          {t("chain.installGateDone", { path: gatePath })}
        </div>
      )}
      {failed ? <div className="text-danger mt-1">{t("chain.adoptionFailed")}</div> : null}
    </div>
  );
}

/** What a mark means, as a sentence. */
function stateMeaning(
  state: "done" | "failed" | "live" | "todo" | "ahead" | "happened",
  cycle: boolean,
  t: ReturnType<typeof useT>,
): string {
  const base = (() => {
    switch (state) {
      case "done":
        return t("chain.mark.done");
      case "failed":
        return t("chain.mark.failed");
      case "live":
        return t("chain.mark.live");
      case "happened":
        return t("chain.mark.happened");
      case "todo":
        return t("chain.mark.todo");
      case "ahead":
        return t("chain.mark.ahead");
    }
  })();
  return cycle ? `${t("chain.mark.cycle")} · ${base}` : base;
}

/**
 * Said plainly, with the one thing that can be done about it.
 *
 * The offer sits **here** rather than in Settings, because this is the moment somebody notices the
 * absence — and it is offered rather than assumed: the nudge writes into the agent's context, which
 * is a different consent from the attention hook's (ADR-PROJ-005 §7).
 */
function NoPlan({ done }: { done: boolean }) {
  const t = useT();
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);
  const client = useQueryClient();
  const installed = useQuery({
    queryKey: ["nudge", cwd],
    queryFn: () => (cwd === null ? false : environmentApi.nudgeInstalled(cwd)),
    enabled: cwd !== null && !done,
  });
  const install = useMutation({
    mutationFn: () => environmentApi.installPlanNudge(cwd ?? ""),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["nudge"] }),
  });

  return (
    <div className="border-dim/25 text-dim mb-[0.8em] border border-dashed px-[0.5em] py-[0.45em] text-[0.9em]">
      <b className="text-fg mb-[0.15em] block font-medium">
        {done ? t("chain.planDone") : t("chain.noPlan")}
      </b>
      {done ? null : (
        <>
          {t("chain.noPlanHint")}
          {cwd === null || installed.data === true ? null : (
            <div className="mt-[0.5em]">
              <Button
                variant="ghost"
                accent="cyan"
                onClick={() => install.mutate()}
                disabled={install.isPending}
                tooltip={t("chain.nudgeExplain")}
              >
                {t("chain.nudgeInstall")}
              </Button>
              {install.isSuccess ? (
                <div className="text-green mt-[0.3em]">{t("chain.nudgeInstalled")}</div>
              ) : null}
              {install.isError ? (
                <div className="text-danger mt-[0.3em]">{t("chain.nudgeFailed")}</div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Footer({ chain }: { chain: Chain }) {
  const t = useT();
  return (
    <div className="text-dim flex shrink-0 gap-[0.8em] border-t border-white/6 px-[0.6em] py-[0.35em] text-[0.75em] tabular-nums">
      <span>{t("chain.links", { n: String(chain.links.length) })}</span>
      <Tooltip
        content={t("chain.coverage", {
          understood: String(chain.steps_understood),
          seen: String(chain.steps_seen),
        })}
      >
        <span>
          {chain.steps_understood}/{chain.steps_seen}
        </span>
      </Tooltip>
      {/* **A measurement, never an identity.** This used to compare the harness version against a
          list of ones the reader had been "verified against" — so it fired on nearly every session,
          because the harness ships versions constantly, and it would have refused to vouch for a
          different vendor's harness altogether. The maintainer's rule: *whatever behaves and is
          configured the way this tool reads gets rendered, whatever it is called and whatever
          version it claims.* So the only question left is the honest one — how much of this
          transcript did the reader actually understand? The version is still shown as context you
          would quote in a report; nothing branches on it. */}
      {chain.coverage_poor ? (
        <Tooltip
          content={t("chain.coverageLow", {
            understood: String(chain.steps_understood),
            seen: String(chain.steps_seen),
          })}
        >
          <span className="text-gold ml-auto">!</span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * The legend, at the very foot of the tool.
 *
 * It sits **outside** the scrolling trace: a legend that scrolled away with the content would be
 * unreachable exactly when the trace is long enough to need one.
 */
function LegendBar() {
  return (
    <div className="shrink-0 border-t border-white/6 px-[0.6em] py-[0.2em]">
      <Legend />
    </div>
  );
}

/**
 * The word for an act, from the catalogue.
 *
 * A `switch` rather than a template key, so a new act is a compile error here instead of a missing
 * translation somebody notices in production — and so `no-restricted-syntax` never has to argue
 * about an indexed lookup.
 */
function actWord(act: ChainLink["act"], t: ReturnType<typeof useT>): string {
  switch (act) {
    case "plan":
      return t("chain.act.plan");
    case "edit":
      return t("chain.act.edit");
    case "build":
      return t("chain.act.build");
    case "verify":
      return t("chain.act.verify");
    // The wire value is the Rust variant name; the word a person reads is "subagent".
    case "delegate":
      return t("chain.act.subagent");
    case "ship":
      return t("chain.act.ship");
    case "compact":
      return t("chain.act.compact");
    case "probe":
      return t("chain.act.probe");
  }
}

/** `0 min` reads as "did not run", so anything under a minute says so instead. */
function duration(seconds: number, t: ReturnType<typeof useT>): string {
  if (seconds < 60) return t("chain.underMinute");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
}

function SectionLabel({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`text-dim mb-[0.5em] text-[0.72em] tracking-[0.16em] uppercase ${className}`}>
      {children}
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-dim p-3 text-center font-mono text-[11px]">{children}</p>;
}
