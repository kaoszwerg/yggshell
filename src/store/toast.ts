import { create } from "zustand";
import type { MessageKey } from "../i18n";

/** How long a message stays before it fades, in milliseconds. */
export const TOAST_MS = 1_800;

type Toast = {
  /** Changes on every message, so an identical message shown twice still restarts the timer. */
  id: number;
  key: MessageKey;
  /** `error` is held a little longer and drawn in the danger accent. */
  tone: "ok" | "error";
};

type ToastState = {
  toast: Toast | null;
  /** Show a message, replacing whatever is on screen. */
  notify: (key: MessageKey, tone?: Toast["tone"]) => void;
  /** Called by the primitive when the timer runs out, or when a newer message has taken over. */
  dismiss: (id: number) => void;
};

/**
 * The one place a short, self-clearing message to the user lives.
 *
 * **Why it exists.** Copying is invisible: the selection looks the same before and after, and until
 * now a copy that *failed* wrote a line to a console nobody has open — a swallowed error by any other
 * name (`rule:logging`: every caught error is logged **and** surfaced). One message covers both
 * halves, so a copy that worked and a copy that did not are equally impossible to miss.
 *
 * **Deliberately not a queue.** A newer message replaces the older one rather than lining up behind
 * it: these are confirmations of something the user just did, and a backlog of them would describe a
 * past they have already moved on from. Same reasoning as the attention signal being state rather than
 * a log (`rule:attention-signals`).
 *
 * **Deliberately not the tab's bell either.** That mark exists to reach somebody looking elsewhere;
 * this is feedback for the thing under their hands. Two marks that mean different things must not be
 * the same mark, and one that means both is what makes the user open a tab to find out which.
 *
 * Not persisted — a message that survived a restart would be a message about something that happened
 * to a different session.
 */
export const useToastStore = create<ToastState>()((set) => ({
  toast: null,
  notify: (key, tone = "ok") => set((s) => ({ toast: { id: (s.toast?.id ?? 0) + 1, key, tone } })),
  dismiss: (id) => set((s) => (s.toast?.id === id ? { toast: null } : s)),
}));
