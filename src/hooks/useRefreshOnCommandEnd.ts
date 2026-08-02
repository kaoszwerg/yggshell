import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTerminalStore } from "../store/terminal";
import type { ActivityState } from "../lib/osc133";

/**
 * The query keys whose answer a finished command can change.
 *
 * All three describe **state the terminal produces**, which is why a command ending is the honest
 * moment to re-read them — and why a timer was the wrong instrument in the first place: it asks
 * constantly while nothing happens and is late exactly when something does.
 *
 * `docker-stats` is deliberately absent: it samples over time and already polls, and its own read
 * costs ~2 s. `git` and the agent session poll too — those change without a command ending (a fetch,
 * a token count), so a trigger would be a second mechanism rather than a better one (ADR-CORE-005).
 */
const AFFECTED = [
  // What this tab is running and what it has open — `ps` + `lsof`.
  ["activity"],
  // The directory tree, which a build, a `git checkout` or an `rm` has just rewritten.
  ["files"],
  // The container LIST, not its stats: `docker compose up` finishing is precisely when a container
  // appears, and nothing else was ever going to notice.
  ["docker"],
] as const;

/**
 * Re-read the panels a finished command invalidates.
 *
 * **The problem this solves, in the maintainer's words: a panel that is on screen and does not
 * update is pointless.** Three of them were read once and then never again — Activity behind a
 * refresh button, Files with no interval at all, and Docker's container list pinned at
 * `staleTime: Infinity`. So a build that opened a port, a file the shell had just written and a
 * container that had just started were all invisible until the user did something about it.
 *
 * **A timer was not the answer**, which is why they did not have one: Activity costs a `ps` and an
 * `lsof` per read, and asking every few seconds behind a panel nobody is watching is the kind of
 * permanent background cost this app has already measured twice and removed. The signal was there
 * the whole time — the shell reports its command boundaries over OSC 133, and the store already
 * carries them per pane.
 *
 * **Any pane, not just the front one.** A build finishing in another tab creates the file you are
 * looking at in this one, and a `docker compose up` two tabs over is exactly the case the container
 * list was missing.
 *
 * Invalidation rather than a refetch: a query nobody has mounted is simply marked stale and re-reads
 * when its panel opens, which costs nothing while the panel is closed — including for Activity,
 * whose `staleTime: Infinity` would otherwise serve a cached answer forever.
 */
export function useRefreshOnCommandEnd() {
  const qc = useQueryClient();
  const panes = useTerminalStore((s) => s.panes);
  /** What each pane was doing last time, so a TRANSITION is what fires rather than a state. */
  const previous = useRef(new Map<string, ActivityState>());

  useEffect(() => {
    let ended = false;
    const seen = new Set<string>();
    for (const pane of panes) {
      seen.add(pane.key);
      // Only the edge out of `running`. The store re-renders for a title, a directory, a bell — a
      // state check would re-read everything on each of them.
      if (previous.current.get(pane.key) === "running" && pane.activity !== "running") ended = true;
      previous.current.set(pane.key, pane.activity);
    }
    // A closed tab must not keep its last state around; reopening a key would then look like a
    // transition that never happened.
    for (const key of previous.current.keys()) if (!seen.has(key)) previous.current.delete(key);

    if (!ended) return;
    for (const queryKey of AFFECTED) void qc.invalidateQueries({ queryKey });
  }, [panes, qc]);
}
