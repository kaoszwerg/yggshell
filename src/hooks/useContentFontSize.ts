import { useSettings } from "./useSettings";

/**
 * The size a **reading surface** is drawn at: a diff, a commit message, the markdown editor and its
 * preview.
 *
 * **The terminal's own setting, because these are the same act as reading a terminal.** Code is
 * code: somebody who turned the terminal up did so because that size is comfortable to *read*, and a
 * diff beside it is the same reading. Reported when they had been moved onto the tool size and came
 * out too small — *"und das ist bei git commit, git diff, markdown edit und markdown view/render
 * ebenfalls so"*.
 *
 * **This is the line between the two hooks, and it is not "tool versus view".** It is *reading*
 * versus *scanning*:
 *
 * | | Follows |
 * | - | ------- |
 * | A diff, a commit, a note being written or read | **this hook** — `terminal_font_size` |
 * | The tool column: file trees, process lists, containers, history rows | `useToolFontSize` |
 * | Chrome — headings, hints, the small print | neither; it is interface |
 *
 * That is why the two settings differ in practice: a dense column of paths wants to be smaller than
 * the thing you are actually reading. Setting them equal is the default and costs nothing.
 *
 * **Divided by `ui_scale`** — see `useToolFontSize` for the whole argument. Three questions, three
 * answers, and each surface follows exactly one.
 */
export function useContentFontSize(): number {
  const settings = useSettings();
  const size = settings.data?.terminal_font_size ?? 13;
  const scale = settings.data?.ui_scale ?? 1;
  return size / (scale > 0 ? scale : 1);
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
