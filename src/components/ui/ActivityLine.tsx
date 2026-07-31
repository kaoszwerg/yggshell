import type { ActivityState } from "../../lib/osc133";

export interface ActivityLineProps {
  /** What to show. Purely a rendering decision — the timing behind it belongs to the caller. */
  state: ActivityState;
  className?: string;
}

/**
 * The line along the top edge of a terminal that says whether something is running.
 *
 * The idea is iTerm2's; the treatment is ours — the window frame's own travelling gradient, so the two
 * read as one system rather than as a borrowed indicator. Four states and nothing more:
 *
 *  - **at rest**, a quiet cyan hairline that could be mistaken for a border, which is the point;
 *  - **running**, the gradient sweeping;
 *  - **ok** / **failed**, held for a moment after a command ends.
 *
 * That last pair is the part worth having: the exit status of a command you looked away from is
 * information you otherwise simply lose.
 *
 * **It renders and nothing else.** How long a result is held, and what counts as one, is the
 * caller's — a primitive that runs its own timers is a primitive that behaves differently depending
 * on where you put it.
 *
 * Deliberately not a spinner: a spinner turns forever and says only "something, somewhere". This says
 * *this terminal*, and it says how it ended.
 */
export function ActivityLine({ state, className = "" }: ActivityLineProps) {
  const variant =
    state === "running"
      ? "hud-activity-running"
      : state === "ok"
        ? "hud-activity-ok"
        : state === "failed"
          ? "hud-activity-failed"
          : "";

  return (
    <div
      // Not `role="status"`: this is an ambient hint, and a screen reader announcing "running" for
      // every command in every tab would be noise rather than help. What a command did is in the
      // terminal's own output, where it belongs.
      aria-hidden
      data-activity={state}
      className={`hud-activity shrink-0 ${variant} ${className}`.trim()}
    />
  );
}
