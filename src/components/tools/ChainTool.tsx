import { Link2 } from "lucide-react";
import type { Chain } from "../../bindings/Chain";
import type { ChainLink } from "../../bindings/ChainLink";
import type { Round } from "../../bindings/Round";
import { useChain } from "../../hooks/useChain";
import { useContentFontSize } from "../../hooks/useContentFontSize";
import { useT } from "../../hooks/useT";
import { Disclosure } from "../ui/Disclosure";
import { Tooltip } from "../ui/Tooltip";

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
  const fontSize = useContentFontSize();

  if (!ready) return <Empty>{t("chain.noTerminal")}</Empty>;
  if (isError) return <Empty>{t("chain.failed")}</Empty>;
  if (isPending) return <Empty>{t("chain.reading")}</Empty>;
  if (chain === null || chain.links.length === 0) return <Empty>{t("chain.none")}</Empty>;

  const running = chain.links.at(-1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-cyan/15 flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <Link2 size={13} className="text-cyan shrink-0" aria-hidden />
        <span className="text-fg flex-1 font-mono text-[11px] tracking-wider uppercase">
          {t("nav.chain")}
        </span>
      </header>

      {/* One font-size for header AND chain — see the component doc. */}
      <div className="flex min-h-0 flex-1 flex-col font-mono" style={{ fontSize: `${fontSize}px` }}>
        {running === undefined ? null : <Now link={running} elapsed={chain.elapsed} />}
        {chain.plan.length > 0 ? <Goal chain={chain} /> : null}

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-[0.6em] py-[0.5em]">
          {chain.plan.length > 0 ? (
            <>
              <SectionLabel>{t("chain.plan")}</SectionLabel>
              {chain.plan.map((step) => (
                <PlanRow key={step.id} subject={step.subject} status={step.status} />
              ))}
              <SectionLabel className="mt-[1em] border-t border-white/8 pt-[0.8em]">
                {t("chain.trace")}
              </SectionLabel>
            </>
          ) : (
            <NoPlan done={chain.plan_done} />
          )}

          {[...chain.links].reverse().map((link, index) => (
            <Link key={`${link.act}-${link.refinement ?? ""}-${index}`} link={link} />
          ))}

          {chain.expected.map((round, index) => (
            <Ahead key={`${round.act}-${index}`} round={round} />
          ))}
        </div>

        <Footer chain={chain} />
      </div>
    </div>
  );
}

/** The one line that answers "what is it doing" without scrolling. */
function Now({ link, elapsed }: { link: ChainLink; elapsed: bigint }) {
  const t = useT();
  return (
    <div className="shrink-0 border-b border-white/6 bg-gradient-to-r from-cyan-400/6 to-transparent px-[0.6em] py-[0.45em]">
      <div className="text-cyan flex items-baseline gap-[0.4em] text-[1.05em]">
        <span className="tracking-wider">{link.act}</span>
        {link.refinement === null ? null : (
          <span className="text-dim min-w-0 truncate text-[0.85em]">{link.refinement}</span>
        )}
        <Reach link={link} />
      </div>
      <div className="text-dim mt-[0.1em] text-[0.85em] tabular-nums">
        {t("chain.running", { duration: duration(Number(elapsed), t) })}
        {link.iterations === null ? "" : ` · ${t("chain.attempt", { n: String(link.iterations) })}`}
      </div>
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
        className={`ml-auto shrink-0 text-[0.8em] ${far ? "text-gold" : "text-dim"} ${
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
      <div className="text-fg truncate text-[0.9em]">{chain.plan[0]?.subject}</div>
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

function PlanRow({ subject, status }: { subject: string; status: string }) {
  const colour =
    status === "completed" ? "text-green" : status === "in_progress" ? "text-cyan" : "text-dim";
  return (
    <div className="flex items-baseline gap-[0.5em] pb-[0.35em]">
      <Node state={status === "completed" ? "done" : status === "in_progress" ? "live" : "todo"} />
      <span className={`min-w-0 flex-1 truncate ${colour}`}>{subject}</span>
    </div>
  );
}

/** One chain link, with its cycle detail behind a disclosure. */
function Link({ link }: { link: ChainLink }) {
  const t = useT();
  const state =
    link.outcome === "failed"
      ? "failed"
      : link.outcome === "live"
        ? "live"
        : link.outcome === "done"
          ? "done"
          : "todo";
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
        {link.act}
      </span>
      {link.refinement === null ? null : (
        <span className="text-dim min-w-0 flex-1 truncate text-[0.85em]">{link.refinement}</span>
      )}
      {link.iterations === null ? null : (
        <span className="bg-gold text-deep shrink-0 px-[0.4em] text-[0.8em] font-bold">
          {t("chain.iterations", { n: String(link.iterations) })}
        </span>
      )}
      <span className="text-dim ml-auto shrink-0 text-[0.8em] tabular-nums">
        {duration(Number(link.seconds), t)}
      </span>
    </>
  );

  const detail = link.rounds.length > 0 && (
    <div className="border-gold/25 mt-[0.3em] ml-[1em] flex flex-col gap-[0.1em] border-l pl-[0.5em]">
      {link.rounds.map((round: Round, index: number) => (
        <div key={index} className="text-dim flex gap-[0.5em] text-[0.85em]">
          <span className="text-gold/80 shrink-0 tabular-nums">{index + 1}</span>
          <span className="min-w-0 truncate">{round.refinement ?? round.act}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex gap-[0.5em] pb-[0.55em]">
      <Node state={state} cycle={link.iterations !== null} />
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

/** The small print under a link: folded probes, delegation, and whether the label was a guess. */
function Meta({ link }: { link: ChainLink }) {
  const t = useT();
  const notes: string[] = [];
  if (link.kind === "delegated") notes.push(t("chain.delegated", { n: String(link.steps) }));
  if (link.noise > 0) notes.push(t("chain.probes", { n: String(link.noise) }));
  if (notes.length === 0 && !link.guessed) return null;
  return (
    <div className="text-dim flex items-baseline gap-[0.5em] text-[0.78em]">
      <span className="min-w-0 truncate">{notes.join(" · ")}</span>
      {link.guessed ? (
        <Tooltip content={t("chain.guessed")}>
          <span className="text-dim shrink-0" aria-label={t("chain.guessed")}>
            ~
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** An expectation from this session's own edges. Drawn unmistakably differently from a plan. */
function Ahead({ round }: { round: Round }) {
  const t = useT();
  return (
    <div className="flex items-baseline gap-[0.5em] pb-[0.5em] opacity-70">
      <Node state="ahead" />
      <span className="text-dim tracking-wider">{round.act}</span>
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
}: {
  state: "done" | "failed" | "live" | "todo" | "ahead";
  cycle?: boolean;
}) {
  const shape = cycle
    ? "rounded-full border-[0.16em] bg-transparent"
    : state === "failed"
      ? "[clip-path:polygon(50%_0,100%_100%,0_100%)]"
      : "[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]";

  // A switch rather than an object lookup: the union already makes the lookup total, but an indexed
  // read is what `security/detect-object-injection` is there to catch and the exemption would have
  // to be argued at every future reader (rule:security — never silence a check to go green).
  const paint = ((): string => {
    switch (state) {
      case "done":
        return cycle ? "border-green" : "bg-green";
      case "failed":
        return cycle ? "border-danger bg-danger" : "bg-danger";
      case "live":
        return cycle ? "border-cyan" : "bg-cyan motion-safe:animate-pulse";
      case "todo":
        return "border border-dim bg-transparent";
      case "ahead":
        return "border border-dashed border-dim bg-transparent";
    }
  })();

  return (
    <span
      className={`mt-[0.3em] size-[0.75em] shrink-0 ${shape} ${paint}`}
      role="img"
      aria-label={state}
    />
  );
}

function NoPlan({ done }: { done: boolean }) {
  const t = useT();
  return (
    <div className="border-dim/25 text-dim mb-[0.8em] border border-dashed px-[0.5em] py-[0.45em] text-[0.9em]">
      <b className="text-fg mb-[0.15em] block font-medium">
        {done ? t("chain.planDone") : t("chain.noPlan")}
      </b>
      {done ? null : t("chain.noPlanHint")}
    </div>
  );
}

function Footer({ chain }: { chain: Chain }) {
  const t = useT();
  const unverified = chain.harness_version !== null && !VERIFIED.includes(chain.harness_version);
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
      {unverified ? (
        <Tooltip content={t("chain.unverifiedHarness", { version: chain.harness_version ?? "" })}>
          <span className="text-gold ml-auto">!</span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * Harness versions this reader has been checked against — mirrored from `agent::chain`.
 *
 * Duplicated deliberately and minimally: the alternative is another IPC round trip for a boolean.
 * If they drift, the tool warns when it need not, which is the harmless direction.
 */
const VERIFIED = ["2.1.220", "2.1.221", "2.1.223"];

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
