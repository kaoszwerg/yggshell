import { PALETTE } from "../styles/palette";
import type { TerminalTheme } from "../bindings/TerminalTheme";

/**
 * The emulator's theme object, as `@xterm/xterm` wants it.
 *
 * Typed here rather than imported from xterm: this file is not the primitive layer, and only
 * `TerminalSurface` may name that package (ADR-PROJ-001). The shape is what it is because xterm
 * defines it — a change there is a compile error at the call site, which is where it belongs.
 */
export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground?: string;
  scrollbarSliderBackground: string;
  scrollbarSliderHoverBackground: string;
  scrollbarSliderActiveBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * The HUD's own terminal colours — the default, and the base every imported scheme is laid over.
 *
 * This is the one place the mapping from the HUD palette to a terminal's sixteen slots is decided, so
 * an imported scheme that defines only half of them still looks deliberate rather than half-applied.
 */
export const HUD_TERMINAL_THEME: XtermTheme = {
  background: PALETTE.deep,
  foreground: PALETTE.fg,
  cursor: PALETTE.cyan,
  cursorAccent: PALETTE.deep,
  selectionBackground: `${PALETTE.cyan}40`,
  // xterm draws its own scrollbar; these are the only way to colour it, and globals.css only gets to
  // say how wide the slider paints.
  scrollbarSliderBackground: `${PALETTE.cyan}4d`,
  scrollbarSliderHoverBackground: `${PALETTE.cyan}99`,
  scrollbarSliderActiveBackground: PALETTE.cyan,
  black: PALETTE.deep,
  red: PALETTE.danger,
  green: PALETTE.green,
  yellow: PALETTE.gold,
  blue: PALETTE.cyan,
  magenta: PALETTE.purple,
  cyan: PALETTE.cyan,
  white: PALETTE.fg,
  brightBlack: PALETTE.dim,
  brightRed: PALETTE.danger,
  brightGreen: PALETTE.green,
  brightYellow: PALETTE.gold,
  brightBlue: PALETTE.cyan,
  brightMagenta: PALETTE.purple,
  brightCyan: PALETTE.cyan,
  brightWhite: "#ffffff",
};

/** The sixteen ANSI slots in the order a scheme lists them. */
const ANSI_SLOTS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const satisfies readonly (keyof XtermTheme)[];

/** `#rrggbb` or `#rgb`. Anything else is refused — a stored theme is a file a user may edit. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const usable = (colour: string | null | undefined): colour is string =>
  typeof colour === "string" && HEX.test(colour.trim());

/**
 * Lay a scheme over the HUD theme.
 *
 * `null` means "this scheme did not say", and the HUD's colour stays — a scheme that never mentioned
 * a cursor must not leave a black caret on a dark background. A malformed colour is treated the same
 * way rather than passed through: a stored theme is an ordinary JSON file a user may edit by hand, and
 * xterm given nonsense silently renders a colour nobody chose.
 *
 * The scrollbar stays HUD in every scheme. It is app chrome, not terminal content (ADR-APP-026) — an
 * imported scheme has no opinion about it and should not be given one.
 */
export function resolveTheme(theme: TerminalTheme | null | undefined): XtermTheme {
  if (!theme) return HUD_TERMINAL_THEME;

  // Built up as overrides and merged once at the end: assigning through a computed key is an
  // object-injection sink, and the gate runs at --max-warnings 0. The keys are ours either way — the
  // rule cannot know that, and arguing with it costs more than avoiding it.
  const overrides = new Map<keyof XtermTheme, string>();
  const set = (key: keyof XtermTheme, colour: string | null | undefined) => {
    if (usable(colour)) overrides.set(key, colour.trim().toLowerCase());
  };

  set("background", theme.background);
  set("foreground", theme.foreground);
  set("cursor", theme.cursor);
  set("cursorAccent", theme.cursor_accent);
  set("selectionForeground", theme.selection_foreground);

  ANSI_SLOTS.forEach((slot, index) => set(slot, theme.ansi.at(index)));

  // A selection colour arrives opaque, which would hide the text under it. Alpha is applied here so
  // an imported scheme behaves like the HUD's own selection rather than a solid block.
  if (usable(theme.selection)) {
    overrides.set("selectionBackground", `${theme.selection.trim().toLowerCase()}59`);
  }

  return { ...HUD_TERMINAL_THEME, ...Object.fromEntries(overrides) };
}

/** The scheme a settings id names, or `null` for the built-in HUD palette. */
export function themeById(
  themes: readonly TerminalTheme[] | undefined,
  id: string,
): TerminalTheme | null {
  if (id === "") return null;
  // An id naming a theme that has since been deleted falls back to the HUD palette rather than
  // leaving the terminal unstyled — the setting is a file a user can edit, and themes can be removed.
  return themes?.find((theme) => theme.id === id) ?? null;
}
