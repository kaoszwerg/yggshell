// Terminal tabs as the UI sees them (Zustand — client state only, rule:frontend-architecture).
//
// The backend owns the sessions (ADR-PROJ-001 §4). What lives here is the *view* of them: which tabs
// exist, their order, their titles, which one is in front. Deliberately not persisted — restoring
// sessions across a restart is its own milestone, and a tab list that outlived the processes it names
// would be a lie.
import { create } from "zustand";
import type { GitDetail } from "./ui";

/** One tab. `key` is the frontend's identity for it and is stable for the pane's whole life; the
 * backend session id is private to the pane, because it does not exist until the PTY is open. */
export interface TerminalPane {
  key: string;
  title: string;
  /** Where the shell currently is, as it reported it (OSC 7). `null` until it says so — a shell
   *  without the hook never does, and guessing would point the Git tool at the wrong repository. */
  cwd: string | null;
  /**
   * The profile this tab was opened with, or `null` for the Settings defaults.
   *
   * Fixed for the tab's life, and only because of what a profile decides at START time: which shell
   * runs, and where. A tab whose profile changed under it would be claiming a shell it does not have.
   */
  profileId: string | null;
  /**
   * A colour scheme chosen for this tab alone, overriding both the profile's and the Settings one.
   *
   * Changeable at any time, unlike the profile — and the distinction is the point. A shell is decided
   * when the process starts; a colour scheme is decided every frame, and the emulator is repainted
   * live for exactly that reason. Treating the two the same was a mistake: it made "give this tab a
   * different scheme" mean "open a different tab".
   */
  themeId: string | null;
  /**
   * Start a plain shell for this tab, whatever the tmux setting says.
   *
   * Set when the user detaches from tmux: leaving tmux means going back to a terminal, not losing the
   * window. Without it the tab would immediately re-attach to the session just left.
   */
  plain: boolean;
  /**
   * Bumped to ask the pane for a fresh session in the same tab.
   *
   * A counter rather than a flag, because the same request can be made repeatedly — attach, detach,
   * attach, detach — and a flag would only ever be seen once.
   */
  generation: number;
  /**
   * What the Git detail panel shows for THIS tab, or `null` when it is closed.
   *
   * Per tab, not per window: tabs are usually in different repositories, and a single global panel
   * meant opening a diff in one tab and finding it laid over another.
   */
  detail: GitDetail | null;
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
  /** Open a tab and focus it, optionally with a profile. Returns its key. */
  openPane: (profileId?: string | null) => string;
  /** Remove a tab and choose a sensible neighbour to focus. */
  closePane: (key: string) => void;
  setActive: (key: string) => void;
  /** Rename a tab — the shell's own title sequence, or a fallback the pane supplies. */
  setTitle: (key: string, title: string) => void;
  /** Record where a pane's shell moved to. */
  setCwd: (key: string, cwd: string) => void;
  /** Give one tab its own colour scheme; `null` returns it to the profile's or the Settings one. */
  setPaneTheme: (key: string, themeId: string | null) => void;
  /** Put a tab back into a plain shell and ask it for a new session — what a tmux detach means. */
  detachToShell: (key: string) => void;
  /** Show something in this tab's detail panel; `null` closes it. */
  setPaneDetail: (key: string, detail: GitDetail | null) => void;
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

  openPane: (profileId = null) => {
    const key = `term-${nextKey++}`;
    set((s) => ({
      panes: [
        ...s.panes,
        {
          key,
          title: "Terminal",
          cwd: null,
          profileId,
          themeId: null,
          plain: false,
          generation: 0,
          detail: null,
        },
      ],
      activeKey: key,
    }));
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

  setCwd: (key, cwd) =>
    set((s) => ({
      panes: s.panes.map((p) => (p.key === key && p.cwd !== cwd ? { ...p, cwd } : p)),
    })),

  setPaneTheme: (key, themeId) =>
    set((s) => ({
      panes: s.panes.map((p) => (p.key === key && p.themeId !== themeId ? { ...p, themeId } : p)),
    })),

  detachToShell: (key) =>
    set((s) => ({
      panes: s.panes.map((p) =>
        p.key === key ? { ...p, plain: true, generation: p.generation + 1 } : p,
      ),
    })),

  setPaneDetail: (key, detail) =>
    set((s) => ({
      panes: s.panes.map((p) => (p.key === key ? { ...p, detail } : p)),
    })),
}));
