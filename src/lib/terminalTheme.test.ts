import { describe, it, expect } from "vitest";
import {
  BUILTIN_THEME_ID,
  detailThemeId,
  HUD_TERMINAL_THEME,
  resolveTheme,
  themeById,
} from "./terminalTheme";
import { PALETTE } from "../styles/palette";
import type { TerminalTheme } from "../bindings/TerminalTheme";

const empty = (over: Partial<TerminalTheme> = {}): TerminalTheme => ({
  id: "x",
  name: "X",
  ansi: Array.from({ length: 16 }, () => null),
  builtin: false,
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

  it("means the built-in scheme when nothing is chosen", () => {
    expect(themeById(themes, "")).toBeNull();
  });

  it("means the built-in scheme when it is chosen by name", () => {
    // `""` and `"yggdrasil"` resolve the same because both are "no stored document" — the named form
    // exists so a tab can pin the built-in scheme rather than follow the setting.
    expect(themeById(themes, BUILTIN_THEME_ID)).toBeNull();
    expect(BUILTIN_THEME_ID).toBe("yggdrasil");
  });

  it("falls back to the HUD palette when the theme has since been deleted", () => {
    expect(themeById(themes, "gone")).toBeNull();
    expect(themeById(undefined, "nord")).toBeNull();
  });
});

describe("detailThemeId", () => {
  const settings = (over: Partial<Record<string, string>> = {}) => ({
    terminal_theme: "",
    diff_theme: "",
    commit_theme: "",
    ...over,
  });

  it("follows the tab's terminal scheme when nothing else is set", () => {
    // The common case: configure nothing, and a diff matches the terminal it sits over.
    expect(detailThemeId("diff", settings(), "nord")).toBe("nord");
    expect(detailThemeId("commit", settings(), "nord")).toBe("nord");
  });

  it("falls back to the default terminal scheme when the tab has none", () => {
    expect(detailThemeId("diff", settings({ terminal_theme: "ayu" }), null)).toBe("ayu");
  });

  it("lets a diff be read in something other than what you type in", () => {
    expect(detailThemeId("diff", settings({ diff_theme: "solarized-light" }), "nord")).toBe(
      "solarized-light",
    );
  });

  it("covers commits with the diff setting unless they have their own", () => {
    expect(detailThemeId("commit", settings({ diff_theme: "solarized-light" }), "nord")).toBe(
      "solarized-light",
    );
    expect(
      detailThemeId(
        "commit",
        settings({ diff_theme: "solarized-light", commit_theme: "ayu" }),
        "nord",
      ),
    ).toBe("ayu");
  });

  it("does not let a commit setting reach a diff", () => {
    expect(detailThemeId("diff", settings({ commit_theme: "ayu" }), "nord")).toBe("nord");
  });

  it("answers the HUD palette when nothing anywhere is set", () => {
    expect(detailThemeId("diff", settings(), null)).toBe("");
    expect(detailThemeId("commit", null, null)).toBe("");
    expect(detailThemeId("diff", undefined, null)).toBe("");
  });
});

/**
 * The defect this section exists for: a Powerline prompt fills a segment with an ANSI colour and
 * writes white on top of it. The HUD's accents were used directly for those slots, which gave white
 * on bright cyan at 1.5:1 — visible in a screenshot as a prompt nobody could read.
 *
 * So the numbers are measured here rather than trusted, and a colour that slips fails the build.
 */
describe("the default scheme as a terminal palette", () => {
  /** WCAG relative luminance. */
  function luminance(hex: string): number {
    // `slice` rather than an index, and the parts named: the lint reads a computed call argument as
    // an injection sink, and arguing with it costs more than being explicit.
    const [r, g, b] = [1, 3, 5].map((at) => {
      const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  }

  const theme = HUD_TERMINAL_THEME;

  it("sanity-checks its own measurement against the known extremes", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  // Against WHITE specifically, not "white or black, whichever is better". That weaker check was
  // written first and passed on the very colour that was reported as unreadable: bright cyan is
  // excellent against black, and a prompt does not put black on it. What powerlevel10k actually does
  // is fill a segment and write white — so that is what is measured.
  const surfaceCases: [string, string][] = [
    ["red", theme.red],
    ["green", theme.green],
    ["yellow", theme.yellow],
    ["blue", theme.blue],
    ["magenta", theme.magenta],
    ["cyan", theme.cyan],
  ];

  it.each(surfaceCases)(
    "carries WHITE text when %s is used as a segment background",
    (_slot, colour) => {
      expect(contrast(colour, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("carries black text on the light slot, which is the one that gets it", () => {
    // Slot 7 is the pale one; a prompt filling a segment with it writes dark on top.
    expect(contrast(theme.white, "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  const textCases: [string, string][] = [
    ["brightRed", theme.brightRed],
    ["brightGreen", theme.brightGreen],
    ["brightYellow", theme.brightYellow],
    ["brightBlue", theme.brightBlue],
    ["brightMagenta", theme.brightMagenta],
    ["brightCyan", theme.brightCyan],
    ["brightWhite", theme.brightWhite],
  ];

  it.each(textCases)("is readable as text when %s is drawn on the background", (_slot, colour) => {
    expect(contrast(colour, theme.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps brightBlack dim on purpose", () => {
    // The conventional "dimmed" slot — comments, box drawing, things meant to recede. Making it
    // legible would defeat what it is for, so it is excluded above rather than quietly passing.
    expect(contrast(theme.brightBlack, theme.background)).toBeLessThan(4.5);
  });

  it("keeps the foreground itself comfortably readable", () => {
    expect(contrast(theme.foreground, theme.background)).toBeGreaterThanOrEqual(7);
  });
});
