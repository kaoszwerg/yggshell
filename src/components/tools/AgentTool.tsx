import { Bot, Clock, GitBranch, Hash, Home } from "lucide-react";
import { useAgentSession } from "../../hooks/useAgentSession";
import { useNow } from "../../hooks/useNow";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { UsageBars } from "./UsageBars";
import { useT } from "../../hooks/useT";
import { formatTokens, sinceLabel } from "../../lib/tokens";

/**
 * What the AI harness in this tab is doing.
 *
 * **The tool this product exists for** (mem:project-scope). The terminal shows a *flow*; what is
 * missing is the *state*. Coming back after twenty minutes should not mean scrolling back three
 * hundred lines to find out where the session got to.
 *
 * **Which account this is** is shown, not assumed: several Claude homes can be in use on one
 * machine, one per project, and "which account am I signed in as here" is a question a shared
 * machine makes genuinely hard to answer.
 *
 * **No percentage of the context window**, deliberately — see `lib/tokens`. The transcript records
 * how many tokens a turn carried and never the size of the window they went into; a percentage
 * against a guessed maximum looks precise and is not.
 */
export function AgentTool() {
  const t = useT();
  const { session, isPending, ready } = useAgentSession();
  // Ticked rather than read in the render body: two calls in one render would disagree, and a
  // static value would leave "2m ago" saying that forever.
  const now = useNow(30_000);

  if (!ready) return <Empty>{t("agent.noSession")}</Empty>;
  if (isPending) return <Empty>{t("agent.reading")}</Empty>;
  if (session === null) {
    // Not a failure: most tabs have never had an agent in them — and this is precisely the moment
    // somebody wants to decide which account this project should use, so the panel comes along.
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <Empty>{t("agent.none")}</Empty>
        <EnvironmentPanel />
      </div>
    );
  }

  const home = session.home.split("/").pop() ?? session.home;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <header className="border-cyan/15 flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <Bot size={13} className="text-cyan shrink-0" aria-hidden />
        <span className="text-fg min-w-0 flex-1 truncate font-mono text-[11px]">
          {session.model ?? t("agent.unknownModel")}
        </span>
      </header>

      <dl className="flex flex-col gap-px p-2">
        <Fact Icon={Home} label={t("agent.account")} value={home} hint={session.home} />
        <Fact
          Icon={Hash}
          label={t("agent.context")}
          value={formatTokens(session.context_tokens) || "—"}
        />
        <Fact Icon={Hash} label={t("agent.written")} value={formatTokens(session.output_tokens)} />
        <Fact Icon={Bot} label={t("agent.turns")} value={String(session.turns)} />
        {session.branch === null ? null : (
          <Fact Icon={GitBranch} label={t("agent.branch")} value={session.branch} />
        )}
        <Fact
          Icon={Clock}
          label={t("agent.lastTurn")}
          value={sinceLabel(session.last_at, now) || "—"}
        />
      </dl>

      <UsageBars />

      <p className="text-dim/60 px-2 pb-2 font-mono text-[9px] leading-relaxed">
        {t("agent.disclaimer")}
      </p>

      {/* The account is part of "what is the agent here", so switching it lives with the reading of
          it rather than in Settings — a preference page is where you go to decide something once,
          and this is decided per project. */}
      <details className="border-cyan/15 border-t">
        <summary className="text-dim cursor-pointer px-2 py-1 font-mono text-[10px] select-none">
          {t("env.title")}
        </summary>
        <EnvironmentPanel />
      </details>
    </div>
  );
}

function Fact({
  Icon,
  label,
  value,
  hint,
}: {
  Icon: typeof Bot;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 font-mono text-[11px]">
      <Icon size={11} className="text-dim shrink-0" aria-hidden />
      <dt className="text-dim min-w-0 flex-1 truncate">{label}</dt>
      <dd className="text-fg shrink-0 truncate" aria-label={hint}>
        {value}
      </dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-dim p-3 text-center font-mono text-[11px]">{children}</p>;
}
