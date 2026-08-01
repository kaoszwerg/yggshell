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
  // Which directories have already been rung for. The poll re-delivers the same state every three
  // seconds, so this rings on the TRANSITION into asking, never on the state itself — otherwise the
  // mark would come back the instant a visit cleared it.
  const rung = useRef(new Set<string>());

  useEffect(() => {
    const asking = new Set(
      waiting.filter((item) => item.event === "Notification").map((item) => item.cwd),
    );

    // Forgotten as soon as it stops asking — that is what lets the NEXT question ring. The backend
    // drops a directory from this list the moment its agent carries on (`hooks::waiting_now`), so
    // this is the answer arriving, not a timeout.
    for (const cwd of rung.current) {
      if (!asking.has(cwd)) rung.current.delete(cwd);
    }

    for (const cwd of asking) {
      if (rung.current.has(cwd)) continue;
      rung.current.add(cwd);
      for (const pane of panes) {
        if (pane.cwd === cwd) ringBell(pane.key);
      }
    }
  }, [waiting, panes, ringBell]);
}
