import { useEffect, useRef } from "react";
import { useAgentAttention } from "./useAgentAttention";
import { useTerminalStore } from "../store/terminal";

/**
 * Turn a harness's attention event into a mark on the tab it came from.
 *
 * **This is what makes the hook signal reachable at all.** The event carries the directory it was
 * raised in, which is the whole reason it beats the terminal bell — it can speak about a tab you are
 * *not* looking at. Until this existed it was rendered only inside the Agent tool, so seeing it
 * required already having that panel open and looking at it: the exact opposite of what an attention
 * signal has to do. Reported, correctly, as "how am I supposed to see that another tab wants
 * something from me?".
 *
 * **It reuses the bell rather than inventing a second mark.** `ringBell` already skips the tab in
 * front, already clears on a visit, and is already counted in the status bar — a parallel channel
 * would have to reimplement all three and would then disagree with the first one it drifted from
 * (ADR-CORE-005). One mark, two sources.
 *
 * **Only `Notification`.** `Stop` fires at the end of every turn; marking on it would light every tab
 * up within minutes, and a mark that is always on has stopped being a signal.
 */
export function useAttentionBell() {
  const { waiting } = useAgentAttention();
  const panes = useTerminalStore((s) => s.panes);
  const ringBell = useTerminalStore((s) => s.ringBell);
  const clearBell = useTerminalStore((s) => s.clearBell);
  // The tabs THIS hook has marked, per directory. Two jobs: the poll re-delivers the same state every
  // three seconds, so ringing happens on the TRANSITION into asking rather than on the state (or the
  // mark would return the instant a visit cleared it); and when the question resolves, only a mark
  // this hook set may be taken off again — a terminal bell is somebody else's signal.
  const marked = useRef(new Map<string, string[]>());

  useEffect(() => {
    const asking = new Set(
      waiting.filter((item) => item.event === "Notification").map((item) => item.cwd),
    );

    // Resolved: the backend drops a directory the moment its agent carries on
    // (`hooks::waiting_now`), so this is the answer arriving, not a timeout. Unlike a `\a`, this
    // signal knows it is over — so it clears up after itself instead of waiting to be visited.
    for (const [cwd, keys] of marked.current) {
      if (asking.has(cwd)) continue;
      for (const key of keys) clearBell(key);
      marked.current.delete(cwd);
    }

    for (const cwd of asking) {
      if (marked.current.has(cwd)) continue;
      const keys = panes.filter((pane) => pane.cwd === cwd).map((pane) => pane.key);
      marked.current.set(cwd, keys);
      for (const key of keys) ringBell(key);
    }
  }, [waiting, panes, ringBell, clearBell]);
}
