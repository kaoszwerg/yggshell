// Typed wrappers around the terminal command surface (ADR-PROJ-001). Like `api` in commands.ts, this
// is the only place these payload shapes exist (rule:frontend-architecture).
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TerminalExit } from "../bindings/TerminalExit";

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
   * There is deliberately no way to say *what* to run. The backend resolves the shell; a webview that
   * could name the program could run anything the user's account can (ADR-PROJ-001 §5).
   */
  open: (opts: {
    rows: number;
    cols: number;
    cwd?: string;
    onOutput: (bytes: Uint8Array) => void;
  }): Promise<SessionId> => {
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (buffer) => opts.onOutput(new Uint8Array(buffer));
    return invoke<SessionId>("terminal_open", {
      onOutput: channel,
      rows: opts.rows,
      cols: opts.cols,
      cwd: opts.cwd ?? null,
    });
  },

  /** Send input — keystrokes, a paste, a control sequence. */
  write: (id: SessionId, data: string) => invoke<void>("terminal_write", { id, data }),

  /** Tell a session its window changed, so the child gets its `SIGWINCH` and redraws. */
  resize: (id: SessionId, rows: number, cols: number) =>
    invoke<void>("terminal_resize", { id, rows, cols }),

  /**
   * Where this session's shell is, when the backend can answer it — inside tmux.
   *
   * `null` for an ordinary shell, where OSC 7 has already told the frontend instantly and no polling
   * is needed. Inside tmux the sequence never arrives (tmux consumes it), and a session that existed
   * before this app started could never have had a hook injected into it, so tmux is asked directly.
   */
  cwd: (id: SessionId) => invoke<string | null>("terminal_cwd", { id }),

  /** End a session because its tab was closed. Takes the foreground process group with it. */
  close: (id: SessionId) => invoke<void>("terminal_close", { id }),

  /** Subscribe to sessions ending on their own. Returns the unsubscribe function. */
  onExit: (handler: (exit: TerminalExit) => void): Promise<UnlistenFn> =>
    listen<TerminalExit>(EXIT_EVENT, (event) => handler(event.payload)),
};
