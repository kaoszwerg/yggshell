import { PALETTE, TERMINAL_ANSI } from "../styles/palette";
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
 * **Yggdrasil** — the app's own scheme, the default, and the base every imported one is laid over.
 *
 * It is built in rather than shipped as a file: a `.yggtheme` copy of it would be a second source for
 * the same colours, and the two would drift the first time one was adjusted. Choosing "Yggdrasil" in
 * Settings means *no* stored scheme, which is why the setting is empty for it.
 *
 * This is the one place the mapping to a terminal's sixteen slots is decided, so an imported scheme
 * that defines only half of them still looks deliberate rather than half-applied.
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
  // The sixteen slots come from TERMINAL_ANSI rather than from the HUD accents. See the comment
  // there: the accents are made to be read ON a dark surface, and a terminal uses these slots AS
  // surfaces — a prompt segment filled with `blue` and written on in white.
  ...TERMINAL_ANSI,
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

/**
 * The id that names the built-in scheme.
 *
 * It has one so it can be *chosen* like any other, and the distinction matters where both options
 * exist: a tab set to `""` follows whatever Settings says, while a tab set to this one stays on
 * Yggdrasil no matter what Settings changes to. Without an id there would be no way to say the second
 * thing.
 */
export const BUILTIN_THEME_ID = "yggdrasil";

/** The scheme a settings id names, or `null` for the built-in one. */
export function themeById(
  themes: readonly TerminalTheme[] | undefined,
  id: string,
): TerminalTheme | null {
  // Both mean the built-in scheme, and both resolve to `null` because that is what "no stored
  // document" is — see BUILTIN_THEME_ID for why the named form exists at all.
  if (id === "" || id === BUILTIN_THEME_ID) return null;
  // An id naming a theme that has since been deleted falls back to the HUD palette rather than
  // leaving the terminal unstyled — the setting is a file a user can edit, and themes can be removed.
  return themes?.find((theme) => theme.id === id) ?? null;
}

/**
 * Which scheme a detail view is drawn in.
 *
 * The chain, most specific first — and every step exists because somebody would reasonably want it:
 *
 * 1. the setting for **this kind of view** (`diff_theme`, `commit_theme`), for reading diffs in
 *    something other than what you type in;
 * 2. for a commit, the **diff** setting, so configuring one covers both unless you say otherwise;
 * 3. this **tab's** own terminal scheme, so a detail panel matches the terminal it sits over;
 * 4. the **default** terminal scheme.
 *
 * An empty string at any step means "not set here, ask the next one" — which is what makes the common
 * case, configuring nothing at all, look right.
 */
export function detailThemeId(
  kind: "diff" | "commit",
  settings:
    | {
        diff_theme?: string;
        commit_theme?: string;
        terminal_theme?: string;
      }
    | null
    | undefined,
  paneThemeId: string | null,
): string {
  const own = kind === "commit" ? (settings?.commit_theme ?? "") : "";
  const diff = settings?.diff_theme ?? "";
  return own !== ""
    ? own
    : diff !== ""
      ? diff
      : (paneThemeId ?? "") !== ""
        ? (paneThemeId ?? "")
        : (settings?.terminal_theme ?? "");
}
