import { useQuery } from "@tanstack/react-query";
import { terminalApi } from "../api/terminal";
import { useTerminalStore } from "../store/terminal";

/**
 * How often the chain is re-read, in ms.
 *
 * Slower than the agent summary's five seconds: a chain link is minutes long, and nothing in it
 * changes between two heartbeats. The cost is a bounded incremental read either way.
 */
const REFRESH_MS = 8_000;

/**
 * The chain of work the agent in the active tab has been through.
 *
 * **This must NOT poll in the background**, and that is a rule rather than an economy
 * (`mem:surfaces`): *"a tool's job is … read by somebody looking at it, so it must stop when they
 * are not. The exception is the signal, not the tool."* The halt signal keeps its background
 * refetching switched on because its whole purpose is reaching someone looking elsewhere
 * (rule:attention-signals); the chain is the opposite kind of surface. A plain `refetchInterval` is
 * what gets that for free — TanStack stops it on unmount and while the window is hidden, so a
 * closed tool and a hidden window both cost nothing.
 *
 * **Nothing is lost by not looking.** The backend keeps a byte offset per transcript, so reopening
 * resumes where it stopped rather than starting blind.
 *
 * **Keyed on the directory AND the tab**, because a directory does not identify an agent:
 * two agents working in one repository report the same `cwd`, and the backend would answer with
 * whichever of them typed last. The session names the tab, whose process tree contains its own
 * harness. Sharing a key across two tabs on one repository was fine while the answer depended only
 * on the directory; it is now a different answer per tab, so it is a different key.
 */
export function useChain() {
  const pane = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey));
  const cwd = pane?.cwd ?? null;
  const sessionId = pane?.sessionId ?? null;

  const query = useQuery({
    queryKey: ["chain", cwd, sessionId],
    queryFn: () => (cwd === null ? null : terminalApi.agentChain(cwd, sessionId)),
    enabled: cwd !== null,
    refetchInterval: REFRESH_MS,
  });

  return {
    chain: query.data ?? null,
    isPending: query.isPending,
    isError: query.isError,
    ready: cwd !== null,
  };
}
