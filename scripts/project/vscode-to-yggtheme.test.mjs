import { describe, it, expect } from "vitest";
import { convert, parseHex } from "./vscode-to-yggtheme.mjs";

describe("parseHex", () => {
  it("splits a colour into the fractions the plist stores", () => {
    expect(parseHex("#ffffff")).toEqual({ red: 1, green: 1, blue: 1 });
    expect(parseHex("#000000")).toEqual({ red: 0, green: 0, blue: 0 });
  });

  it("is exact, not rounded", () => {
    // A rounded channel is a different colour. `#000e07` is the Alien Blood background, and it has
    // to come out the other side as exactly that.
    const parsed = parseHex("#000e07");
    expect(Math.round((parsed?.red ?? 0) * 255)).toBe(0);
    expect(Math.round((parsed?.green ?? 0) * 255)).toBe(14);
    expect(Math.round((parsed?.blue ?? 0) * 255)).toBe(7);
  });

  it("expands the three-digit form", () => {
    expect(parseHex("#0f0")).toEqual(parseHex("#00ff00"));
  });

  it("refuses an eight-digit colour rather than dropping its alpha", () => {
    // `#rrggbbaa` carries transparency this format has nowhere to put. Silently keeping the RGB
    // would ship a colour the theme's author never chose.
    expect(parseHex("#11223344")).toBeNull();
  });

  it("refuses anything that is not a colour", () => {
    expect(parseHex("red")).toBeNull();
    expect(parseHex("")).toBeNull();
    expect(parseHex(undefined)).toBeNull();
    expect(parseHex("#12345")).toBeNull();
  });
});

describe("convert", () => {
  const colors = {
    "terminal.background": "#000e07",
    "terminal.foreground": "#637d75",
    "terminal.ansiRed": "#e08009",
    "terminalCursor.foreground": "#73fa91",
  };

  it("writes a plist a reader can parse", () => {
    const { plist } = convert(colors);
    expect(plist.startsWith('<?xml version="1.0"')).toBe(true);
    expect(plist).toContain("<key>Background Color</key>");
    expect(plist).toContain("<key>Ansi 1 Color</key>");
    expect(plist.trimEnd().endsWith("</plist>")).toBe(true);
  });

  it("maps VS Code's names onto iTerm2's slots", () => {
    const { plist } = convert({ "terminal.ansiBrightCyan": "#00e0c4" });
    expect(plist).toContain("<key>Ansi 14 Color</key>");
  });

  it("leaves an undefined colour out rather than inventing one", () => {
    // A slot the source does not define falls back to the HUD's own value, which is what "this theme
    // does not define it" is supposed to mean. Lightening the base to fake a bright variant is how
    // an imported theme stops looking like the theme it came from.
    const { plist, missing } = convert(colors);
    expect(plist).not.toContain("<key>Ansi 9 Color</key>");
    expect(missing).toContain("terminal.ansiBrightRed");
  });

  it("reports every colour it could not take", () => {
    const { missing } = convert({});
    expect(missing).toHaveLength(20);
  });

  it("writes the channels exactly, so a colour survives the round trip", () => {
    const { plist } = convert({ "terminal.background": "#000e07" });
    // 14/255 and 7/255, written in full rather than rounded to two decimals.
    expect(plist).toContain(String(14 / 255));
    expect(plist).toContain(String(7 / 255));
  });
});
