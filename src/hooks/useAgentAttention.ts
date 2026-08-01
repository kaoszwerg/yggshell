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
 *
 * **It never switches itself off.** Two things used to do that, and both made the feature look
 * broken rather than absent: it was mounted inside a panel that only rendered when the front tab had
 * a session (an unmounted query polls nothing), and it was `enabled` only once that tab had reported
 * a directory. Neither condition has anything to do with what this answers — the events are about the
 * tabs you are *not* looking at. The directory is now passed for one purpose only, choosing which
 * account's settings to check, and a missing one costs exactly that and nothing else.
 */
export function useAgentAttention() {
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);

  const query = useQuery({
    queryKey: ["agent-attention", cwd],
    queryFn: () => environmentApi.attention(cwd),
    refetchInterval: REFRESH_MS,
    // **In the background too, and this one is not optional.** Query stops an interval refetch as
    // soon as the page is `hidden`, and macOS reports a window as hidden the moment another app
    // fully covers it — so without this the attention signal sleeps in precisely the situation it
    // exists for: you working in another window while an agent waits for you. Every other poll in
    // the app deliberately does NOT do this (a git status nobody is looking at is wasted work); this
    // is the one whose job is to reach a user who is looking somewhere else.
    refetchIntervalInBackground: true,
  });

  return {
    installed: query.data?.installed ?? false,
    waiting: query.data?.waiting ?? [],
    // "We have an answer" — not "the front tab has a directory". The panel hides itself until the
    // first read comes back, so it never flashes an install button at somebody who already has the
    // hook installed.
    ready: query.data != null,
  };
}
