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
 * The size a **tool** draws its content at.
 *
 * **Its own setting, because it is its own question.** The tools borrowed the terminal's, and that
 * is wrong in both directions: a large terminal font chosen for readability does not mean the
 * sidebar should eat the window, and a small one chosen for density does not mean the panels beside
 * it should become unreadable. It starts equal to the terminal's, so introducing the control moves
 * nothing until somebody turns it.
 *
 * Not divided by `ui_scale`, for the same reason as above: this is ordinary DOM, and the WebView
 * zoom already applies to it.
 */
export function useToolFontSize(): number {
  const settings = useSettings();
  return settings.data?.tool_font_size ?? settings.data?.terminal_font_size ?? 13;
}
