/**
 * Keys the emulator encodes wrongly for the programs this terminal exists to run.
 *
 * **The problem this solves.** A terminal speaks to its program in bytes, and the classic encoding
 * has no room for a modifier on Enter: `Enter` and `Shift+Enter` both arrive as a single `CR`, so a
 * program cannot tell them apart no matter how much it would like to. That is not a bug in the
 * emulator — it is the protocol, and it dates from a time when nothing needed the distinction.
 *
 * An AI harness needs it constantly: `Enter` submits, `Shift+Enter` continues on a new line. Claude
 * Code's own `/terminal-setup` therefore installs exactly one binding wherever it can, and this is
 * it, verbatim from its bundle:
 *
 * ```json
 * { "key": "shift+enter", "command": "workbench.action.terminal.sendSequence",
 *   "args": { "text": "\r" }, "when": "terminalFocus" }
 * ```
 *
 * **Why not the modern answer.** The Kitty keyboard protocol was built for precisely this and would
 * let a program *ask* for modifier-aware keys, leaving every other program untouched. It is the
 * better mechanism and it does not apply here twice over: `@xterm/xterm` does not implement it, and
 * the harness does not speak it — measured, `0` occurrences in the CLI binary. So the escape prefix
 * is not a shortcut taken over a cleaner design; it is the only encoding that reaches the program.
 *
 * **This is a key, not a command.** The webview never chooses what runs (ADR-PROJ-001 §5). What
 * changes here is how one keystroke is spelled on the wire — the same category as `clear()` sending
 * `Ctrl+L` (rule:shortcuts), and deliberately not a general "send this string" channel.
 */

/** The parts of a key event this decision depends on. Narrow, so a test needs no DOM. */
export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** `ESC` + `CR` — Enter, marked as "not the plain one". */
const ESC_CR = "\x1b\r";

/**
 * What to send instead of the emulator's own encoding, or `null` to leave the key alone.
 *
 * Returning `null` for everything else is the point: a terminal that rewrites keys is a terminal
 * that takes them away from the programs running in it, and those keys have no other route back.
 */
export function encodeKey(event: KeyLike): string | null {
  // Shift ALONE. With Ctrl, Alt or Meta held this is a different key altogether, and some of those
  // combinations already mean something to a program — overwriting them would be the very theft
  // this function exists to avoid.
  if (
    event.key === "Enter" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    return ESC_CR;
  }
  return null;
}
