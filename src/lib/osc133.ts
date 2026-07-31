// Reading OSC 133 — the "semantic prompt" sequences a shell uses to say what it is doing.
//
// `ESC ] 133 ; <letter> [; <payload>] ST`, the same vocabulary iTerm2, VS Code and WezTerm use:
//
//   A  a prompt is about to be drawn
//   B  the prompt has been drawn; the user is typing
//   C  a command has STARTED running
//   D[;exit]  that command has finished, with its exit status when the shell provides one
//
// Its own module rather than living in the terminal component, for the same reason as `osc7`: it is
// pure string handling and deserves to be tested as such.
//
// **Measured, not assumed:** these sequences reach the emulator from a plain shell and are swallowed
// entirely by tmux — a probe emitted `133;C` and `133;D` from inside a tmux session and counted zero
// of each outside it. Inside tmux the activity state is polled from `#{pane_current_command}` instead.

/**
 * What the activity line shows. Wider than what OSC 133 reports, because "a command just failed" is a
 * state the UI holds for a moment while the shell only ever announces it once.
 */
export type ActivityState = "idle" | "running" | "ok" | "failed";

/**
 * What OSC 133 actually reports: a command started, or a command ended.
 *
 * There is no `idle` here on purpose — a shell never announces "nothing is happening". Idle is a state
 * the UI arrives at (see `ActivityState`), not an event anyone sends.
 */
export type Activity =
  | { state: "running" }
  /** A command has just finished. `exit` is `null` when the shell did not say. */
  | { state: "finished"; exit: number | null };

/**
 * Read one OSC 133 payload — everything after `133;`.
 *
 * Returns `null` for a sequence we have no use for (`A`, `B`, an unknown letter), which the caller
 * treats as "nothing changed". That is the honest answer: a prompt being drawn says nothing about
 * whether work is happening.
 */
export function parseOsc133(data: string): Activity | null {
  const [letter = "", ...rest] = data.split(";");
  switch (letter.trim()) {
    case "C":
      return { state: "running" };
    case "D": {
      // `D` with no status is legitimate — the shell simply did not say. `D;` with something that is
      // not a number is treated the same way rather than guessed at.
      const raw = rest.at(0)?.trim() ?? "";
      const exit = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : null;
      return { state: "finished", exit };
    }
    default:
      return null;
  }
}
