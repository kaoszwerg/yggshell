import { useQuery } from "@tanstack/react-query";
import { environmentApi } from "../api/environment";
import { useTerminalStore } from "../store/terminal";

/** How often the events file is re-read. Cheap — one file read. */
const REFRESH_MS = 3_000;

/**
 * Which tabs' agents are asking for something.
 *
 * **The precise half of the attention signal.** The terminal bell says *something happened
 * somewhere*; this says which directory, and why. `cwd` is what matches an event to a tab, which is
 * the whole reason a hook beats a bell — and it works whether or not the app was open when the
 * event happened, because the hook appends to a file rather than shouting into a socket.
 */
export function useAgentAttention() {
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);

  const query = useQuery({
    queryKey: ["agent-attention", cwd],
    queryFn: () => (cwd === null ? null : environmentApi.attention(cwd)),
    enabled: cwd !== null,
    refetchInterval: REFRESH_MS,
  });

  return {
    installed: query.data?.installed ?? false,
    waiting: query.data?.waiting ?? [],
    ready: cwd !== null,
  };
}
