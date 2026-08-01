import { useQuery } from "@tanstack/react-query";
import { terminalApi } from "../api/terminal";
import { useTerminalStore } from "../store/terminal";

/** How often the transcript is re-read, in ms. */
const REFRESH_MS = 5_000;

/**
 * What the harness in the active tab is doing.
 *
 * **One reader, two renderings** (mem:surfaces, ADR-CORE-005): the sidebar tool and the status bar
 * element both draw from this hook. A second, cheaper parse for the status bar would eventually
 * disagree with the tool in front of the user, which is worse than either being absent.
 *
 * Polled rather than watched: the transcript is somebody else's working file, a filesystem watch on
 * it would fire on every token, and five seconds is well inside the time it takes to look at a
 * panel. It reads the tail of a file — nothing is spawned.
 */
export function useAgentSession() {
  const pane = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey) ?? null);
  const sessionId = pane?.sessionId ?? null;
  const cwd = pane?.cwd ?? null;

  const query = useQuery({
    queryKey: ["agent", sessionId, cwd],
    queryFn: () =>
      sessionId === null || cwd === null ? null : terminalApi.agentSession(sessionId, cwd),
    enabled: sessionId !== null && cwd !== null,
    refetchInterval: REFRESH_MS,
  });

  return { session: query.data ?? null, isPending: query.isPending, ready: sessionId !== null };
}
