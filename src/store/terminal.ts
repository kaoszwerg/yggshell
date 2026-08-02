// Terminal tabs as the UI sees them (Zustand — client state only, rule:frontend-architecture).
//
// The backend owns the sessions (ADR-PROJ-001 §4). What lives here is the *view* of them: which tabs
// exist, their order, their titles, which one is in front.
//
// **What "restore" honestly means here.** A PTY does not survive the app: when the process ends the
// shell gets its SIGHUP and dies, and no amount of bookkeeping brings it back. So two different things
// are restored, and conflating them would be the lie this file used to avoid by persisting nothing:
//
//  - the WORKSPACE — which tabs were open, where each one was, which profile and scheme it had. Those
//    come back as fresh shells in the same places. This is what every terminal calls "restore", and
//    it is what the persisted state below carries.
//  - the PROCESS — only ever through tmux, which is a session that outlives us by design. A tab that
//    was attached to one attaches to it again and finds its work exactly where it was.
//
// Anything that would be false after a restart is deliberately NOT persisted: a title the shell set
// (`cargo watch` is not running any more), a backend session id, an open diff.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BellKind } from "../lib/bells";
import type { ActivityState } from "../lib/osc133";
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
   * A program in this tab rang the bell and the tab has not been looked at since.
   *
   * The classic terminal signal, and the only one that survives tmux — measured: tmux registers a
   * bell and forwards it, while it swallows OSC sequences whole. It says "something happened here"
   * and nothing more, which is why it marks a tab rather than raising a notification: a bell is also
   * rung by an ambiguous completion, and a system notification that cries wolf gets turned off.
   */
  bell: BellKind | null;
  /**
   * The backend session this tab is talking to, once the PTY is open.
   *
   * It used to live only inside the pane component, which was right while nothing outside needed
   * it. A sidebar tool does: "what is this tab running" is a question asked from outside the
   * terminal view entirely, and a ref in a component is not reachable from there. `null` until the
   * PTY opens, and back to `null` when it goes — a stale id would have a tool reading another
   * tab's processes.
   */
  sessionId: number | null;
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
  /**
   * The tmux session this tab was attached to, when it was.
   *
   * The one piece of state that restores a *process* rather than a place: tmux outlives the app, so a
   * tab that names its session finds its work still running. `null` for a plain shell, where there is
   * nothing to come back to.
   */
  tmuxSession: string | null;
  /**
   * Whether this tab is running something, and how the last thing ended.
   *
   * Per tab, like everything else here: two tabs are two shells, and "the terminal is busy" is not a
   * fact about the window. Never persisted — a tab restored tomorrow is not running what it ran today.
   */
  activity: ActivityState;
  /**
   * What is running, when that can be known.
   *
   * Only inside tmux, which reports `#{pane_current_command}`. A plain shell's OSC 133 says a command
   * started and how it ended, never its name — so this stays `null` there rather than inventing one.
   */
  command: string | null;
  /** When the current command started, for the elapsed time. `null` when nothing is running. */
  activitySince: number | null;
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
  /** Open a tab and focus it, optionally with a profile and a starting directory. Returns its key. */
  /**
   * Open a tab.
   *
   * `tmuxSession` is what separates **attaching** from **opening**: without it the backend gives the
   * tab a session no one is using, so a new terminal is genuinely new. Naming one is how the user
   * reaches a session that outlived its tab — the picker in the title bar, and the only way back into
   * tmux after a detach.
   */
  openPane: (profileId?: string | null, cwd?: string | null, tmuxSession?: string | null) => string;
  /**
   * Open a tab that starts in a named directory — `ygg <dir>`, Finder's "Open With".
   *
   * A second tab every time, never a reused one: two invocations are two pieces of work, and taking
   * the user away from whatever is running in an existing tab is not what they asked for.
   */
  openPaneIn: (cwd: string) => string;
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
  /**
   * Carry every tab that named `from` across to `to`.
   *
   * **Called in the same gesture as the rename, and it is not optional.** A tab remembers its session
   * by name; left pointing at one nobody has, it would create an empty session under the dead name on
   * the next start while the renamed one sat orphaned — precisely the defect the restore exists to
   * prevent (ADR-PROJ-001 §5).
   */
  renamePaneSession: (from: string, to: string) => void;
  /**
   * The tab whose close is waiting on an answer, or `null`.
   *
   * **Only a close the USER asked for ever lands here.** A session that ended on its own goes
   * straight through `closePane` — asking "end its tmux session?" about a session that is already
   * gone would be nonsense. And quitting the app never touches this at all: it does not close tabs,
   * it detaches every client and ends (`RunEvent::Exit`), so a quit is never N questions.
   */
  closing: string | null;
  /**
   * Close a tab the user asked to close.
   *
   * Closes it outright when there is nothing to decide. A tab holding a tmux session has something to
   * decide: closing DETACHES, so the session keeps running — which is right for a build and wrong for
   * the tenth leftover nobody will ever return to. Since a new tab no longer reuses an old session,
   * that decision is the only thing standing between the user and an unbounded pile of them.
   */
  requestClosePane: (key: string) => void;
  /** Answer the question with "leave it alone" — the tab stays open. */
  cancelClose: () => void;
  /** Record which tmux session a tab ended up attached to, so a restart can return to it. */
  setPaneTmuxSession: (key: string, session: string | null) => void;
  /** Record (or clear) the backend session this tab is talking to. */
  setPaneSession: (key: string, sessionId: number | null) => void;
  /**
   * Mark this tab. Ignored for the tab that is already in front.
   *
   * `kind` says what the mark MEANS, and therefore what colour it is. It defaults to `"action"`
   * because that is what a bare terminal `\a` is: something happened and nothing says what, so
   * claiming "finished" would be a guess. A caller that KNOWS — the harness hook, which is told
   * whether an agent is blocked or merely idle — passes it.
   */
  ringBell: (key: string, kind?: BellKind) => void;
  /**
   * Take the mark off a tab without visiting it, because what caused it has resolved.
   *
   * **Only the agent signal may use this, and only for a mark it set itself** (`useAttentionBell`).
   * A terminal bell has no resolution — a `\a` carries nothing that could later say "never mind", so
   * it stays until it has been looked at. An agent's question does: the harness's next event is the
   * proof that it carried on. Leaving the dot up then means pointing at a tab where nothing is
   * waiting, which is the busywork this signal exists to avoid.
   */
  clearBell: (key: string) => void;
  /**
   * Record what this tab is doing.
   *
   * `command` is only ever known inside tmux (`#{pane_current_command}`); outside it OSC 133 says
   * that something is running and how it ended, never what it was. Passing `null` there is the
   * honest answer, not a gap to fill in.
   */
  setPaneActivity: (key: string, activity: ActivityState, command: string | null) => void;
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

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      panes: [],
      activeKey: null,
      bootstrapped: false,

      bootstrap: () => {
        if (get().bootstrapped) return;
        set({ bootstrapped: true });
        get().openPane();
      },

      openPane: (profileId = null, cwd = null, tmuxSession = null) => {
        const key = `term-${nextKey++}`;
        set((s) => ({
          panes: [
            ...s.panes,
            {
              key,
              title: "Terminal",
              sessionId: null,
              bell: null,
              cwd,
              profileId,
              themeId: null,
              plain: false,
              generation: 0,
              detail: null,
              // Picked up once when the pane mounts, by exactly the path a restored tab uses — the
              // two are the same request ("open me in THIS session"), so they are one mechanism.
              tmuxSession,
              activity: "idle",
              command: null,
              activitySince: null,
            },
          ],
          activeKey: key,
        }));
        return key;
      },

      openPaneIn: (cwd) => get().openPane(null, cwd),

      closePane: (key) =>
        set((s) => ({
          panes: s.panes.filter((p) => p.key !== key),
          activeKey: s.activeKey === key ? neighbourOf(s.panes, key) : s.activeKey,
          // Whatever question was open about this tab is answered by it being gone.
          closing: s.closing === key ? null : s.closing,
        })),

      setActive: (activeKey) =>
        // Visiting a tab clears its bell: the mark exists to say "look here", and it has served its
        // purpose the moment you do. Anything else would need a second gesture to dismiss.
        set((s) => ({
          activeKey,
          panes: s.panes.map((p) => (p.key === activeKey && p.bell ? { ...p, bell: null } : p)),
        })),

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
          panes: s.panes.map((p) =>
            p.key === key && p.themeId !== themeId ? { ...p, themeId } : p,
          ),
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

      setPaneActivity: (key, activity, command) =>
        set((s) => ({
          panes: s.panes.map((p) => {
            if (p.key !== key) return p;
            const running = activity === "running";
            // Stamped only when something NEW starts. tmux is polled on a timer and answers "still
            // running" every time; restamping on each of those would hold the elapsed time at zero.
            const started =
              running && (p.activity !== "running" || p.command !== command)
                ? Date.now()
                : running
                  ? p.activitySince
                  : null;
            return {
              ...p,
              activity,
              command: running ? command : null,
              activitySince: started,
            };
          }),
        })),

      closing: null,

      requestClosePane: (key) => {
        const pane = get().panes.find((p) => p.key === key);
        if (pane?.tmuxSession == null) {
          get().closePane(key);
          return;
        }
        set({ closing: key });
      },

      cancelClose: () => set({ closing: null }),

      renamePaneSession: (from, to) =>
        set((s) => ({
          panes: s.panes.map((p) => (p.tmuxSession === from ? { ...p, tmuxSession: to } : p)),
        })),

      setPaneTmuxSession: (key, tmuxSession) =>
        set((s) => ({
          panes: s.panes.map((p) =>
            p.key === key && p.tmuxSession !== tmuxSession ? { ...p, tmuxSession } : p,
          ),
        })),

      ringBell: (key, kind = "action") =>
        set((s) => ({
          // Never the active tab: you are looking at it, so a mark you would clear in the same
          // breath is noise. Everything else keeps its mark until it is visited.
          //
          // A newer kind REPLACES an older one rather than being dropped as "already marked": an
          // agent that finishes and then asks for a permission has changed what it wants from you,
          // and a tab still showing the old colour would be answering last minute's question.
          panes:
            s.activeKey === key
              ? s.panes
              : s.panes.map((p) => (p.key === key && p.bell !== kind ? { ...p, bell: kind } : p)),
        })),

      clearBell: (key) =>
        set((s) => ({
          panes: s.panes.map((p) => (p.key === key && p.bell ? { ...p, bell: null } : p)),
        })),

      setPaneSession: (key, sessionId) =>
        set((s) => ({
          panes: s.panes.map((p) =>
            p.key === key && p.sessionId !== sessionId ? { ...p, sessionId } : p,
          ),
        })),
    }),
    {
      name: "app-terminals",
      // Schema version for the persist middleware, NOT the app version. Bump when the stored shape
      // changes incompatibly, so an old payload is discarded rather than half-read.
      // 1: { panes: [key, title, cwd, profileId, themeId, tmuxSession], activeKey }
      version: 1,
      // Only what is still TRUE after a restart. A title the shell set names a process that is gone;
      // a session id names a PTY that is gone; an open diff is a view of a moment that has passed.
      // Persisting any of them would be the lie this store used to avoid by persisting nothing.
      partialize: (s) => ({
        panes: s.panes.map((p) => ({
          key: p.key,
          cwd: p.cwd,
          profileId: p.profileId,
          themeId: p.themeId,
          tmuxSession: p.tmuxSession,
          plain: p.plain,
        })),
        activeKey: s.activeKey,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Rebuild each tab from what survived, with everything else at its starting value.
        //
        // `plain` survives, and it used to be reset here on the reasoning that a detached tab "is
        // starting over". That was wrong, and became visibly wrong once a tmux tab started returning
        // to its exact session: the two halves then disagreed. A tab you deliberately left tmux in
        // came back inside tmux — the app undoing a decision the user had made, in the one place they
        // would not think to look. Which multiplexer a tab is in is part of what the tab IS, like its
        // directory and its profile, and all of those survive.
        //
        // The way back is closing the tab and opening a new one; there is no re-attach action.
        state.panes = (state.panes ?? [])
          .filter((p): p is TerminalPane => typeof p?.key === "string")
          .map((p) => ({
            key: p.key,
            title: "Terminal",
            sessionId: null,
            bell: null,
            cwd: typeof p.cwd === "string" ? p.cwd : null,
            profileId: typeof p.profileId === "string" ? p.profileId : null,
            themeId: typeof p.themeId === "string" ? p.themeId : null,
            tmuxSession: typeof p.tmuxSession === "string" ? p.tmuxSession : null,
            plain: p.plain === true,
            generation: 0,
            detail: null,
            // Never restored: a tab reopened tomorrow is a fresh shell that is running nothing.
            activity: "idle" as const,
            command: null,
            activitySince: null,
          }));

        // Keys come from a counter that restarts at zero every run, so restored keys are renumbered
        // rather than trusted. Without it a restored `term-0` and a newly opened one would be the same
        // tab to everything else — including the map that decides which session to close.
        const wasActiveAt = state.panes.findIndex((p) => p.key === state.activeKey);
        state.panes = state.panes.map((p, at) => ({ ...p, key: `term-${at}` }));
        nextKey = state.panes.length;
        // The tab that was in front stays in front; if that record is gone, the first one is.
        state.activeKey =
          (wasActiveAt >= 0 ? state.panes.at(wasActiveAt)?.key : undefined) ??
          state.panes.at(0)?.key ??
          null;

        // Restored tabs ARE the bootstrap: opening another on top of them would greet the user with a
        // terminal they did not ask for, every time.
        state.bootstrapped = state.panes.length > 0;
      },
    },
  ),
);
