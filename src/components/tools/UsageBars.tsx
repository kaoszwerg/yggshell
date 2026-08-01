import { Meter } from "../ui/Meter";
import { useAgentUsage } from "../../hooks/useAgentUsage";
import { useT } from "../../hooks/useT";

/**
 * How full the subscription's limits are.
 *
 * **The one place in this tool where a bar is honest.** The context count has none, because the
 * transcript never records the size of the window it went into (`lib/tokens`); these figures arrive
 * as percentages from Claude Code itself, so the denominator is real and drawing it is simply using
 * what is known.
 *
 * The labels are Anthropic's own wording, verbatim and untranslated — they name their product's
 * concepts, and a translated "Current week (all models)" beside an untranslated one would read as a
 * bug (rule:i18n).
 */
export function UsageBars() {
  const t = useT();
  const { usage, isPending } = useAgentUsage();

  if (isPending)
    return <p className="text-dim px-2 py-1 font-mono text-[10px]">{t("usage.reading")}</p>;
  // Nothing to show is not a failure: an account on a plan that reports no limits, or no `claude` on
  // PATH at all.
  if (usage === null || usage.limits.length === 0) return null;

  return (
    <section className="border-cyan/15 flex flex-col gap-1.5 border-t px-2 py-2">
      <h3 className="text-dim font-mono text-[0.56rem] tracking-[0.12em]">
        {t("usage.title").toUpperCase()}
      </h3>
      {usage.limits.map((limit) => (
        <div key={limit.label} className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2 font-mono text-[10px]">
            <span className="text-dim min-w-0 flex-1 truncate">{limit.label}</span>
            <span className="text-fg shrink-0">{limit.percent}%</span>
          </div>
          <Meter percent={limit.percent} label={limit.label} />
          {limit.resets === null ? null : (
            <span className="text-dim/60 font-mono text-[9px]">
              {t("usage.resets", { when: limit.resets })}
            </span>
          )}
        </div>
      ))}
      {usage.requests_24h === null ? null : (
        <p className="text-dim/60 font-mono text-[9px]">
          {t("usage.last24h", {
            requests: String(usage.requests_24h),
            sessions: String(usage.sessions_24h ?? 0),
          })}
        </p>
      )}
    </section>
  );
}
