import { useSettings } from "./useSettings";

/**
 * The size the tools' monospace content is drawn at.
 *
 * **The same setting the terminal uses, for the reason the diff already used it:** code is code. A
 * file tree, a process list and a container's log are the same kind of reading as a terminal, and
 * somebody who turned the terminal up did so because that size is comfortable for them — leaving
 * the panels beside it at a hard-coded 11px is the app deciding it knows better.
 *
 * **Not divided by the UI scale**, unlike the emulator's: this is ordinary DOM and the WebView zoom
 * already applies to it. Dividing would shrink the panels as the rest of the interface grew.
 *
 * Chrome — section headings, hints, the small print — stays fixed. It is interface, not content, and
 * a heading that grew with the code would compete with it.
 */
export function useContentFontSize(): number {
  const settings = useSettings();
  return settings.data?.terminal_font_size ?? 13;
}

/**
 * The size a **tool** draws its content at — the markdown editor and preview, a git diff, a commit
 * message, a file tree, a container list.
 *
 * **Its own setting, because it is its own question.** The tools borrowed the terminal's, and that
 * is wrong in both directions: a large terminal font chosen for readability does not mean the
 * sidebar should eat the window, and a small one chosen for density does not mean the panels beside
 * it should become unreadable. It starts equal to the terminal's, so introducing the control moved
 * nothing until somebody turned it.
 *
 * **Divided by `ui_scale`, and this is the correction that matters.** That setting is native WebView
 * zoom (ADR-APP-021): it multiplies every DOM pixel, so a tool that merely *reads* `tool_font_size`
 * still grows when the chrome does — and the size the user chose for its content is overridden by an
 * unrelated setting. Reported from the running app: *"aktuell ändert sich diff und commit mit der ui
 * size und das ist schlecht."*
 *
 * The emulator has divided since the day it was built, for exactly this reason. **There are three
 * questions and they are separate: how big the chrome is, how big the terminal is, how big
 * everything else is.** UI is UI, terminal is terminal, all the rest is tool — and each surface
 * follows exactly one of them.
 *
 * A zero or missing scale is treated as 1 rather than divided by: a hand-edited settings file would
 * otherwise render every tool at `Infinity`, which is a blank panel with no error anywhere.
 */
export function useToolFontSize(): number {
  const settings = useSettings();
  const size = settings.data?.tool_font_size ?? settings.data?.terminal_font_size ?? 13;
  const scale = settings.data?.ui_scale ?? 1;
  return size / (scale > 0 ? scale : 1);
}
