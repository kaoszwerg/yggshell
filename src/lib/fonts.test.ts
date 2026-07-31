import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { availableFonts, fontStack, hasFont, FONT_CANDIDATES } from "./fonts";

/**
 * jsdom measures nothing, so the canvas is stubbed with metrics we control. What is under test is the
 * comparison — "does this font differ from the fallbacks" — not the browser's text engine.
 */
function stubCanvas(widths: Record<string, number>, fallbackWidth = 100) {
  // A Map rather than an object literal: indexing an object with a computed key is an
  // object-injection sink, and the gate runs at --max-warnings 0.
  const table = new Map(Object.entries(widths));
  const context = {
    font: "",
    measureText: () => {
      const match = /"([^"]+)"/.exec(context.font);
      const family = match?.[1];
      if (family === undefined) return { width: fallbackWidth };
      return { width: table.get(family) ?? fallbackWidth };
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  return context;
}

afterEach(() => vi.restoreAllMocks());

describe("hasFont", () => {
  beforeEach(() => stubCanvas({ "MesloLGS NF": 140 }));

  it("finds a font whose metrics differ from the fallbacks", () => {
    expect(hasFont("MesloLGS NF")).toBe(true);
  });

  it("reports a font the browser substituted as missing", () => {
    // Identical width against every fallback means the browser drew the fallback each time.
    expect(hasFont("Definitely Not Installed")).toBe(false);
  });

  it("says yes to everything when there is no canvas to measure with", () => {
    // An old WebView or a locked-down context. An empty picker is the worse failure — the text field
    // still works, so claiming availability keeps the feature usable.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(hasFont("Anything At All")).toBe(true);
  });
});

describe("availableFonts", () => {
  it("keeps only what is installed, in the order given", () => {
    stubCanvas({ Hack: 120, Menlo: 130 });
    expect(availableFonts(["Menlo", "Nope", "Hack"])).toEqual(["Menlo", "Hack"]);
  });

  it("can come back empty rather than inventing a font", () => {
    stubCanvas({});
    expect(availableFonts(["Nope", "Also Nope"])).toEqual([]);
  });

  it("offers the two fonts the app ships before anything else", () => {
    // They are always present, and they are why someone opens this setting: a Powerline prompt.
    expect(FONT_CANDIDATES[0]).toBe("MesloLGS NF");
    expect(FONT_CANDIDATES[1]).toBe("JetBrainsMono Nerd Font");
  });
});

describe("fontStack", () => {
  it("puts the chosen font first and keeps a generic behind it", () => {
    // A stored name can be a font that has since been uninstalled. Rendering in the browser's
    // last-resort face because of a settings string is far worse than falling back to monospace.
    expect(fontStack("MesloLGS NF")).toBe(
      '"MesloLGS NF", "JetBrains Mono", ui-monospace, monospace',
    );
  });

  it("is the default stack when nothing is chosen", () => {
    expect(fontStack("")).toBe('"JetBrains Mono", ui-monospace, monospace');
    expect(fontStack("   ")).toBe('"JetBrains Mono", ui-monospace, monospace');
  });

  it("quotes a name with spaces so it cannot break the stack", () => {
    expect(fontStack("Courier New")).toContain('"Courier New"');
  });
});
