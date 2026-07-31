// Terminal tabs as the UI sees them (Zustand — client state only, rule:frontend-architecture).
//
// The backend owns the sessions (ADR-PROJ-001 §4). What lives here is the *view* of them: which tabs
// exist, their order, their titles, which one is in front. Deliberately not persisted — restoring
// sessions across a restart is its own milestone, and a tab list that outlived the processes it names
// would be a lie.
import { create } from "zustand";

/** One tab. `key` is the frontend's identity for it and is stable for the pane's whole life; the
 * backend session id is private to the pane, because it does not exist until the PTY is open. */
export interface TerminalPane {
  key: string;
  title: string;
}

export interface TerminalState {
  panes: TerminalPane[];
  /** The tab in front, or `null` when none is open. */
  activeKey: string | null;
  /** Whether the first terminal of this run has been opened yet. */
  bootstrapped: boolean;

  /**
   * Open the first terminal of this run, once.
   *
   * A terminal app that greets you with an empty pane and a button costs a click on every launch.
   * Guarded rather than driven off `panes.length`, so closing the last tab really does leave you at
   * zero instead of instantly reopening one.
   */
  bootstrap: () => void;
  /** Open a tab and focus it. Returns its key. */
  openPane: () => string;
  /** Remove a tab and choose a sensible neighbour to focus. */
  closePane: (key: string) => void;
  setActive: (key: string) => void;
  /** Rename a tab — the shell's own title sequence, or a fallback the pane supplies. */
  setTitle: (key: string, title: string) => void;
}

/** Monotonic, process-local. Never shown to the user; the title is. */
let nextKey = 0;

/** Which tab takes over when `closing` disappears: the one to its right, else the one to its left. */
function neighbourOf(panes: TerminalPane[], closing: string): string | null {
  const index = panes.findIndex((p) => p.key === closing);
  if (index < 0) return null;

  const right = panes.at(index + 1);
  if (right) return right.key;

  // The underflow is guarded explicitly: `at(-1)` wraps to the END of the list, which for the only
  // open tab is the very pane being closed — leaving `activeKey` pointing at something that no
  // longer exists.
  return index > 0 ? (panes.at(index - 1)?.key ?? null) : null;
}

export const useTerminalStore = create<TerminalState>()((set, get) => ({
  panes: [],
  activeKey: null,
  bootstrapped: false,

  bootstrap: () => {
    if (get().bootstrapped) return;
    set({ bootstrapped: true });
    get().openPane();
  },

  openPane: () => {
    const key = `term-${nextKey++}`;
    set((s) => ({ panes: [...s.panes, { key, title: "Terminal" }], activeKey: key }));
    return key;
  },

  closePane: (key) =>
    set((s) => ({
      panes: s.panes.filter((p) => p.key !== key),
      activeKey: s.activeKey === key ? neighbourOf(s.panes, key) : s.activeKey,
    })),

  setActive: (activeKey) => set({ activeKey }),

  setTitle: (key, title) =>
    set((s) => ({
      panes: s.panes.map((p) => (p.key === key ? { ...p, title } : p)),
    })),
}));
