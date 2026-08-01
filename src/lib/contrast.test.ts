import { describe, it, expect } from "vitest";
import { contrast, mostReadableOn, AA } from "./contrast";

describe("contrast", () => {
  it("knows the two ends of the scale", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("does not care which way round the pair is given", () => {
    const a = contrast("#0a0a0f", "#e0e0e0");
    expect(contrast("#e0e0e0", "#0a0a0f")).toBe(a);
  });

  it("accepts the short form and ignores an alpha suffix", () => {
    // Schemes are written by hand and shared as hex; both spellings turn up.
    expect(contrast("#fff", "#000")).toBeCloseTo(21, 1);
    expect(contrast("#00e5ff40", "#0a0a0f")).toBe(contrast("#00e5ff", "#0a0a0f"));
  });

  it("returns null rather than a made-up number for something unparseable", () => {
    // A fabricated ratio would quietly rule an unreadable pairing acceptable, which is the one
    // failure mode this module exists to prevent.
    expect(contrast("not a colour", "#000000")).toBeNull();
    expect(contrast("#12345", "#000000")).toBeNull();
  });

  it("measures a scheme's selection as it is actually drawn, not as it is written", () => {
    // Worth pinning because measuring the wrong thing here produced a wrong answer once: Alien
    // Blood's selection is 2.57 against its foreground as SPECIFIED, which looks alarming — but
    // `resolveTheme` lays it over the background at 35% alpha, and the pairing the user actually
    // sees is 3.85. Still under AA, hence `selectionForeground`; nowhere near the panic.
    const asWritten = contrast("#637d75", "#1d4125") ?? 0;
    const asDrawn = contrast("#637d75", "#0a2011") ?? 0;

    expect(asWritten).toBeLessThan(3);
    expect(asDrawn).toBeGreaterThan(asWritten);
    expect(asDrawn).toBeLessThan(AA);
  });
});

describe("mostReadableOn", () => {
  it("picks the candidate that actually reads", () => {
    expect(mostReadableOn("#000e07", ["#111111", "#ffffff"])).toBe("#ffffff");
    expect(mostReadableOn("#f8f9fa", ["#111111", "#ffffff"])).toBe("#111111");
  });

  it("skips what it cannot measure instead of preferring it", () => {
    expect(mostReadableOn("#000000", ["nonsense", "#ffffff"])).toBe("#ffffff");
  });

  it("has no answer when nothing can be measured", () => {
    expect(mostReadableOn("#000000", ["nonsense"])).toBeNull();
  });
});
