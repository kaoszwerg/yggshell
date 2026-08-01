/**
 * Token counts, written the way a person reads them.
 *
 * **Deliberately no percentage.** The obvious status bar element would be "71% of the context used",
 * and it cannot be built honestly: the transcript records how many tokens a turn carried, and
 * nowhere does it record the size of the window they went into. A live session measured **529 709**
 * tokens on one turn — comfortable in a 1M window, impossible in a 200k one — and the model name in
 * the file (`claude-opus-5`) is identical in both cases.
 *
 * A percentage against a guessed maximum is a number that looks precise and is not, which is exactly
 * what ADR-CORE-004 forbids. So the count is shown as itself, and the reader — who knows which
 * window they are on — draws their own conclusion.
 */

/** `529709` → `530k`. Compact, monotonic, and never rounded to something that reads as a limit. */
export function formatTokens(tokens: number | bigint | null | undefined): string {
  if (tokens === null || tokens === undefined) return "";
  const n = Number(tokens);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  // One decimal past a million: the difference between 1.0M and 1.4M matters at that size.
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** How long ago an ISO timestamp was, in words. Empty when it cannot be read. */
export function sinceLabel(iso: string | null | undefined, now: number): string {
  if (iso === null || iso === undefined || iso === "") return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}
