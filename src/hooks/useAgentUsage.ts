import { useQuery } from "@tanstack/react-query";
import { terminalApi } from "../api/terminal";
import { useTerminalStore } from "../store/terminal";

/**
 * How full this account's usage limits are.
 *
 * **Slowly.** The figures themselves are free — the slash command never reaches a model — but asking
 * spawns a `claude` process, so this runs on a two-minute timer rather than with the session poll.
 * Limits move over hours; a faster poll would buy nothing and cost a process each time.
 */
const REFRESH_MS = 120_000;

export function useAgentUsage() {
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);

  const query = useQuery({
    queryKey: ["agent-usage", cwd],
    queryFn: () => (cwd === null ? null : terminalApi.agentUsage(cwd)),
    enabled: cwd !== null,
    refetchInterval: REFRESH_MS,
    // A limit read a minute ago is still true; re-asking because a window regained focus is a
    // process spawned for nothing.
    refetchOnWindowFocus: false,
  });

  return { usage: query.data ?? null, isPending: query.isPending };
}
