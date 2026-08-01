// Typed wrappers around the terminal command surface (ADR-PROJ-001). Like `api` in commands.ts, this
// is the only place these payload shapes exist (rule:frontend-architecture).
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TerminalExit } from "../bindings/TerminalExit";
import type { TerminalOpened } from "../bindings/TerminalOpened";
import type { AgentSession } from "../bindings/AgentSession";
import type { UsageSummary } from "../bindings/UsageSummary";
import type { TerminalActivity } from "../bindings/TerminalActivity";
import type { TerminalStatus } from "../bindings/TerminalStatus";

/** Backend session id. Allocated by the registry; meaningless outside this process. */
export type SessionId = number;

/** The event a session emits when it ends by itself — `exit`, or the shell dying. */
const EXIT_EVENT = "terminal://exit";

export const terminalApi = {
  /**
   * Start a session and stream its output into `onOutput`.
   *
   * Output arrives as raw `ArrayBuffer` batches, already coalesced in the backend: bytes rather than
   * text, so the emulator does its own UTF-8 decoding and a character split across two reads still
   * renders.
   *
   * There is deliberately no way to say *what* to run. `profile` names a stored profile and the
   * backend resolves it into a program; a webview that could name the program itself could run
   * anything the user's account can, and those are not the same thing (ADR-PROJ-001 §5).
   */
  open: (opts: {
    rows: number;
    cols: number;
    cwd?: string;
    /** A stored profile's id — a REFERENCE, never a command line (ADR-PROJ-001 §5). */
    profile?: string | null;
    /**
     * Start a plain shell whatever the tmux setting says.
     *
     * What a tab uses after the user detaches out of tmux: leaving tmux means going back to a
     * terminal, not losing the window — and without this the tab would re-attach to the session it
     * just left. A switch, not a program: it selects between things the backend already decides.
     */
    plain?: boolean;
    /**
     * The tmux session a RESTORED tab was in when the app last stopped.
     *
     * A restore, not a choice — the backend refuses any name outside the series the settings define
     * (`tmux::in_series`), so this can only hand back a name the backend itself minted for this tab.
     * Without it a tab returning after a crash is numbered by position rather than identity, and
     * lands in the wrong session as soon as the tab count has changed (ADR-PROJ-001 §5).
     */
    tmuxSession?: string;
    onOutput: (bytes: Uint8Array) => void;
  }): Promise<TerminalOpened> => {
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (buffer) => opts.onOutput(new Uint8Array(buffer));
    return invoke<TerminalOpened>("terminal_open", {
      onOutput: channel,
      rows: opts.rows,
      cols: opts.cols,
      cwd: opts.cwd ?? null,
      profile: opts.profile ?? null,
      plain: opts.plain ?? false,
      tmuxSession: opts.tmuxSession ?? null,
    });
  },

  /**
   * Every tmux session running on this machine, for the attach picker.
   *
   * An empty list is the ordinary answer — no tmux, no server, nothing started — not a failure.
   */
  sessions: () => invoke<string[]>("tmux_sessions"),

  /** Send input — keystrokes, a paste, a control sequence. */
  write: (id: SessionId, data: string) => invoke<void>("terminal_write", { id, data }),

  /** Tell a session its window changed, so the child gets its `SIGWINCH` and redraws. */
  resize: (id: SessionId, rows: number, cols: number) =>
    invoke<void>("terminal_resize", { id, rows, cols }),

  /**
   * What a session is doing, for the things the frontend cannot see for itself.
   *
   * Everything is empty for an ordinary shell, and deliberately so: there OSC 7 and OSC 133 reach the
   * emulator directly — instantly, and with an exit status a poll could never give. Inside tmux both
   * are swallowed (measured), so the working directory and whether a command is running are asked of
   * tmux instead.
   */
  status: (id: SessionId) => invoke<TerminalStatus>("terminal_status", { id }),

  /**
   * What this tab is running, and what it is listening on.
   *
   * On demand only — it spawns `ps` and `lsof`, which have no business on the status timer. The id
   * names a *session*; no command line crosses this boundary (ADR-PROJ-001 §5).
   */
  activity: (id: SessionId) => invoke<TerminalActivity>("terminal_activity", { id }),

  /**
   * What the AI harness in this tab is doing, as far as its transcript says.
   *
   * The Claude home is decided by the BACKEND from the tab's own process environment — never passed
   * in from here, and never assumed to be `~/.claude`: several accounts can be in use on one
   * machine, one per project.
   *
   * `null` when no agent has run in that directory, which is the ordinary case for most tabs.
   */
  agentSession: (id: SessionId, cwd: string) =>
    invoke<AgentSession | null>("agent_session", { id, cwd }),

  /**
   * How much of the subscription this tab's account has used.
   *
   * Free to ask — the slash command is handled inside Claude Code and never reaches a model — but
   * it does spawn a process, so it is polled slowly and never on every render.
   */
  agentUsage: (cwd: string) => invoke<UsageSummary | null>("agent_usage", { cwd }),

  /** End a session because its tab was closed. Takes the foreground process group with it. */
  close: (id: SessionId) => invoke<void>("terminal_close", { id }),

  /** Subscribe to sessions ending on their own. Returns the unsubscribe function. */
  onExit: (handler: (exit: TerminalExit) => void): Promise<UnlistenFn> =>
    listen<TerminalExit>(EXIT_EVENT, (event) => handler(event.payload)),
};
