import { describe, it, expect } from "vitest";
import { HUD_TERMINAL_THEME, resolveTheme, themeById } from "./terminalTheme";
import { PALETTE } from "../styles/palette";
import type { TerminalTheme } from "../bindings/TerminalTheme";

const empty = (over: Partial<TerminalTheme> = {}): TerminalTheme => ({
  id: "x",
  name: "X",
  ansi: Array.from({ length: 16 }, () => null),
  background: null,
  foreground: null,
  cursor: null,
  cursor_accent: null,
  selection: null,
  selection_foreground: null,
  ...over,
});

describe("resolveTheme", () => {
  it("is the HUD palette when there is no scheme", () => {
    expect(resolveTheme(null)).toEqual(HUD_TERMINAL_THEME);
    expect(resolveTheme(undefined)).toEqual(HUD_TERMINAL_THEME);
  });

  it("keeps every HUD colour a scheme did not define", () => {
    // A scheme with no cursor colour must not leave a black caret on a dark background.
    const resolved = resolveTheme(empty({ background: "#101010" }));
    expect(resolved.background).toBe("#101010");
    expect(resolved.cursor).toBe(PALETTE.cyan);
    expect(resolved.foreground).toBe(PALETTE.fg);
  });

  it("maps the sixteen ANSI slots in order", () => {
    const ansi = [
      "#000000",
      "#110000",
      "#220000",
      "#330000",
      "#440000",
      "#550000",
      "#660000",
      "#770000",
      "#880000",
      "#990000",
      "#aa0000",
      "#bb0000",
      "#cc0000",
      "#dd0000",
      "#ee0000",
      "#ff0000",
    ];
    const resolved = resolveTheme(empty({ ansi }));
    expect(resolved.black).toBe("#000000");
    expect(resolved.red).toBe("#110000");
    expect(resolved.white).toBe("#770000");
    expect(resolved.brightBlack).toBe("#880000");
    expect(resolved.brightWhite).toBe("#ff0000");
  });

  it("gives an imported selection colour the HUD's transparency", () => {
    // Opaque, it would hide the text underneath — which is what a scheme's raw value would do.
    const resolved = resolveTheme(empty({ selection: "#3366FF" }));
    expect(resolved.selectionBackground).toBe("#3366ff59");
  });

  it("refuses a malformed colour instead of handing it to the emulator", () => {
    // A stored theme is an ordinary JSON file a user may edit; xterm given nonsense silently renders
    // a colour nobody chose.
    const resolved = resolveTheme(
      empty({
        background: "not a colour",
        foreground: "rgb(1,2,3)",
        cursor: "#12345",
        ansi: ["javascript:alert(1)", ...Array.from({ length: 15 }, () => null)],
      }),
    );
    expect(resolved.background).toBe(HUD_TERMINAL_THEME.background);
    expect(resolved.foreground).toBe(HUD_TERMINAL_THEME.foreground);
    expect(resolved.cursor).toBe(HUD_TERMINAL_THEME.cursor);
    expect(resolved.black).toBe(HUD_TERMINAL_THEME.black);
  });

  it("accepts the three-digit form and normalises case", () => {
    const resolved = resolveTheme(empty({ background: "#ABC", foreground: "#FFEEDD" }));
    expect(resolved.background).toBe("#abc");
    expect(resolved.foreground).toBe("#ffeedd");
  });

  it("leaves the scrollbar HUD in every scheme", () => {
    // App chrome, not terminal content (ADR-APP-026) — an imported scheme has no opinion about it.
    const resolved = resolveTheme(empty({ background: "#101010", selection: "#ff0000" }));
    expect(resolved.scrollbarSliderBackground).toBe(HUD_TERMINAL_THEME.scrollbarSliderBackground);
    expect(resolved.scrollbarSliderActiveBackground).toBe(
      HUD_TERMINAL_THEME.scrollbarSliderActiveBackground,
    );
  });

  it("survives a scheme with fewer ANSI entries than it should have", () => {
    // The backend pads to 16, but the file on disk is editable.
    const resolved = resolveTheme(empty({ ansi: ["#010203"] }));
    expect(resolved.black).toBe("#010203");
    expect(resolved.brightWhite).toBe(HUD_TERMINAL_THEME.brightWhite);
  });

  it("does not mutate the HUD theme it starts from", () => {
    resolveTheme(empty({ background: "#101010" }));
    expect(HUD_TERMINAL_THEME.background).toBe(PALETTE.deep);
  });
});

describe("themeById", () => {
  const themes = [empty({ id: "nord", name: "Nord" }), empty({ id: "ayu", name: "Ayu" })];

  it("finds the theme a setting names", () => {
    expect(themeById(themes, "ayu")?.name).toBe("Ayu");
  });

  it("means the HUD palette when nothing is chosen", () => {
    expect(themeById(themes, "")).toBeNull();
  });

  it("falls back to the HUD palette when the theme has since been deleted", () => {
    expect(themeById(themes, "gone")).toBeNull();
    expect(themeById(undefined, "nord")).toBeNull();
  });
});
