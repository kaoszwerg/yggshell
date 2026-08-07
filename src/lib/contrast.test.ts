import { describe, it, expect } from "vitest";
import { contrast, mostReadableOn, blend, readable, AA, READABLE_DIM } from "./contrast";

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

/** Alien Blood, read out of its own `.yggtheme` — the scheme the defect was reported in. */
const ALIEN = {
  background: "#000e07",
  foreground: "#637d75",
  brightBlack: "#3c4812",
  green: "#2f7e25",
  red: "#e08009",
};
/** What `globals.css` paints under a changed row: the accent at 14 % over the surface. */
const added = blend(ALIEN.green, ALIEN.background, 0.14) ?? "";
const removed = blend(ALIEN.red, ALIEN.background, 0.14) ?? "";

describe("readable", () => {
  it("reproduces the reported defect before correcting it", () => {
    // Measured from the shipped theme, and these numbers are why the correction does not belong in
    // that file: the comment colour is already under the floor on the PLAIN background.
    expect(contrast(ALIEN.brightBlack, ALIEN.background) ?? 0).toBeLessThan(2.1);
    expect(contrast(ALIEN.brightBlack, added) ?? 0).toBeLessThan(1.8);
    expect(contrast(ALIEN.brightBlack, removed) ?? 0).toBeLessThan(1.8);
  });

  it("lifts it until it clears every background it can land on", () => {
    const fixed = readable(ALIEN.brightBlack, ALIEN.foreground, [ALIEN.background, added, removed]);

    for (const bg of [ALIEN.background, added, removed]) {
      expect(contrast(fixed, bg) ?? 0).toBeGreaterThanOrEqual(READABLE_DIM);
    }
  });

  it("keeps a comment dimmer than the body text it sits among", () => {
    // The whole point of a comment colour, and the reason the floor is 3 and not AA: this scheme's
    // own foreground only reaches 4.43.
    const fixed = readable(ALIEN.brightBlack, ALIEN.foreground, [ALIEN.background, added]);

    expect(contrast(fixed, ALIEN.background) ?? 0).toBeLessThan(
      contrast(ALIEN.foreground, ALIEN.background) ?? 0,
    );
  });

  it("keeps the scheme's hue instead of washing to grey", () => {
    const fixed = readable(ALIEN.brightBlack, ALIEN.foreground, [ALIEN.background, added]);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(fixed.slice(i, i + 2), 16));

    expect(g).toBeGreaterThan(r as number);
    expect(g).toBeGreaterThan(b as number);
  });

  it("leaves a scheme that already reads completely alone", () => {
    // Nearly all of them. A correction that fired on every scheme would be a second palette, which
    // is exactly what this module's opening paragraph refuses.
    const fine = "#8a9a8a";
    expect(readable(fine, "#ffffff", ["#0b0b0b"])).toBe(fine);
  });

  it("stops at the foreground rather than inventing a colour", () => {
    // A scheme whose own foreground cannot clear the floor is unreadable by its author's choice.
    expect(readable("#010101", "#020202", ["#000000"], 10)).toBe("#020202");
  });

  it("treats an unmeasurable background as a failure, not as a pass", () => {
    expect(readable("#3c4812", "#ffffff", ["nonsense"])).not.toBe("#3c4812");
  });
});

describe("blend", () => {
  it("performs the same arithmetic as color-mix", () => {
    expect(blend("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(blend("#ffffff", "#000000", 0)).toBe("#000000");
    expect(blend("#ffffff", "#000000", 1)).toBe("#ffffff");
  });

  it("has no answer for something it cannot read", () => {
    expect(blend("nonsense", "#000000", 0.5)).toBeNull();
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
