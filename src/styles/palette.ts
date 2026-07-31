// SSOT for colours used in JavaScript: the few places that can't resolve CSS `var()` (canvas,
// inline styles, level-coloured log lines). Mirrors the HUD palette in globals.css (:root + the
// @theme tokens). Change a colour here AND in globals.css :root — those are the only two places
// (className utilities use the @theme tokens, which reference :root, so they need no change).
export const PALETTE = {
  fg: "#e0e0e0",
  dim: "#9aa4b2",
  cyan: "#00e5ff",
  green: "#00ff88",
  gold: "#ffd700",
  purple: "#b44aff",
  danger: "#ff3366",
  deep: "#0a0a0f",
  surface: "#12121a",
  elevated: "#1a1a2e",
} as const;

/**
 * The sixteen ANSI slots a terminal renders with.
 *
 * **Separate from the HUD accents above, and that separation is the whole point.** The HUD's colours
 * are made to be *read on a dark surface* — neon cyan on near-black. A terminal uses the same slots as
 * **backgrounds**: a Powerline prompt fills a segment with `blue` and writes white on top of it. Using
 * the accents directly there gave 1.5:1 — white on bright cyan, effectively unreadable, which is
 * exactly what it looked like.
 *
 * So the split is the one every established terminal theme makes, and for this reason:
 *
 *  - **0–7 are surface colours.** Mid-tone, so a segment filled with one carries white (or black)
 *    text at 4.6:1 or better. They are *not* optimised for being read as text on the background —
 *    that is what the bright half is for.
 *  - **8–15 are text colours**, and these are the HUD accents: 5:1 or better against the background.
 *
 * `brightBlack` is the deliberate exception at 1.8:1. It is the conventional "dimmed" slot — comments,
 * box drawing, things meant to recede — and making it legible would defeat what it is for.
 *
 * The numbers above are measured, not asserted: `terminalTheme.test.ts` fails if any of them slips.
 */
export const TERMINAL_ANSI = {
  black: "#12121a",
  red: "#c1273f",
  green: "#127f52",
  yellow: "#956f0a",
  blue: "#0f6d8c",
  magenta: "#8339c4",
  cyan: "#0d7d85",
  white: "#b8c2cc",
  brightBlack: "#3a3a4e",
  brightRed: "#ff3366",
  brightGreen: "#00ff88",
  brightYellow: "#ffd700",
  brightBlue: "#00e5ff",
  brightMagenta: "#b44aff",
  brightCyan: "#5ce0eb",
  brightWhite: "#ffffff",
} as const;
