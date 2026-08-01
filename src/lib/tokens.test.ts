import { describe, it, expect } from "vitest";
import { formatTokens, sinceLabel } from "./tokens";

describe("formatTokens", () => {
  it("keeps small counts exact and large ones readable", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_500)).toBe("2k");
    // The number measured on a live session.
    expect(formatTokens(529_709)).toBe("530k");
    expect(formatTokens(1_400_000)).toBe("1.4M");
  });

  it("says nothing rather than something wrong", () => {
    expect(formatTokens(null)).toBe("");
    expect(formatTokens(undefined)).toBe("");
    expect(formatTokens(Number.NaN)).toBe("");
    expect(formatTokens(-5)).toBe("");
  });
});

describe("sinceLabel", () => {
  const now = Date.parse("2026-08-01T12:00:00.000Z");

  it("shrinks the unit as the gap grows", () => {
    expect(sinceLabel("2026-08-01T11:59:30.000Z", now)).toBe("30s");
    expect(sinceLabel("2026-08-01T11:45:00.000Z", now)).toBe("15m");
    expect(sinceLabel("2026-08-01T09:00:00.000Z", now)).toBe("3h");
    expect(sinceLabel("2026-07-30T12:00:00.000Z", now)).toBe("2d");
  });

  it("never reports a negative age", () => {
    // Clocks disagree, and "-3s ago" reads as a bug in the app rather than in the clock.
    expect(sinceLabel("2026-08-01T12:00:05.000Z", now)).toBe("0s");
  });

  it("says nothing for a timestamp it cannot read", () => {
    expect(sinceLabel(null, now)).toBe("");
    expect(sinceLabel("not a date", now)).toBe("");
  });
});
