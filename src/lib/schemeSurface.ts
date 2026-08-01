/**
 * Drawing a view in a terminal colour scheme instead of in the HUD's palette.
 *
 * **What this is for.** The theme setting says, in the maintainer's own words, "the colours a
 * terminal, a diff and a commit are drawn in". That was half true: the scheme reached the syntax
 * highlighter and nothing else, so a diff configured as Alien Blood showed Alien Blood keywords on
 * the HUD's background, with HUD line numbers and HUD tints — a third theme nobody had chosen. The
 * commit view had the opposite half: it set the surface colours and then filled them with `text-fg`
 * and `text-dim`, which on a LIGHT scheme is pale grey on near-white.
 *
 * **The mechanism: custom properties, once, on the root of the view.** A scheme is data — one of the
 * bundled fifteen, or one the user wrote — so its colours can be neither Tailwind classes nor a
 * per-element inline style, because the tints have to be mixed against the scheme's *own* background
 * (`color-mix`, in `globals.css` under `.scheme-*`). Nine properties at the top is the one place
 * both halves can meet.
 *
 * **Always set, scheme or not.** With nothing configured these resolve to the terminal's own default
 * palette rather than to nothing. "Not configured" means *the terminal's colours* — that is what the
 * setting promises — and leaving them unset is what let a view inherit the panel behind it.
 */
import type { CSSProperties } from "react";
import { HUD_TERMINAL_THEME, type XtermTheme } from "./terminalTheme";

/** A colour scheme with the id it was chosen by. */
export interface SchemeChoice {
  id: string;
  colours: XtermTheme;
}

/**
 * The custom properties a `.scheme-*` view draws from.
 *
 * `fontSize` rides along because every caller sets it on the same element anyway, and a second style
 * object merged in at each call site is one more place to forget one.
 */
export function surfaceStyle(
  scheme: SchemeChoice | null | undefined,
  fontSize?: number,
): CSSProperties {
  const c = scheme?.colours ?? HUD_TERMINAL_THEME;
  return {
    ...(fontSize === undefined ? {} : { fontSize: `${fontSize}px` }),
    "--scheme-bg": c.background,
    "--scheme-fg": c.foreground,
    // The scheme's own "quiet" colour for comments, line numbers and metadata. Never a HUD grey:
    // that is chosen to sit on a dark surface and is unreadable on a light scheme.
    "--scheme-dim": c.brightBlack,
    "--scheme-add": c.green,
    "--scheme-del": c.red,
    "--scheme-meta": c.cyan,
    // Renames and modifications in a commit's file list. Two more slots rather than reusing add and
    // del, because "renamed" reading as "added" is a wrong answer, not a duller one.
    "--scheme-alt": c.magenta,
    "--scheme-warn": c.yellow,
  } as CSSProperties;
}
