import type { ShellInfo } from "../bindings/ShellInfo";

/** A shell as the UI shows it: what to write on the control, and the path it stands for. */
export interface ShellChoice {
  path: string;
  label: string;
}

/**
 * Name the shells so no two controls read the same.
 *
 * A file name is what people call a shell (`zsh`, `fish`), and it is what the button should say —
 * right up until a machine offers two of them. `/bin/zsh` and `/opt/homebrew/bin/zsh` are a genuinely
 * common pair on macOS, and two buttons both labelled `zsh` are not a choice, they are a coin toss.
 * Only the ambiguous ones fall back to their full path, so the common case stays short.
 */
export function labelShells(shells: readonly ShellInfo[]): ShellChoice[] {
  const counts = new Map<string, number>();
  for (const shell of shells) counts.set(shell.name, (counts.get(shell.name) ?? 0) + 1);
  return shells.map((shell) => ({
    path: shell.path,
    label: (counts.get(shell.name) ?? 0) > 1 ? shell.path : shell.name,
  }));
}
