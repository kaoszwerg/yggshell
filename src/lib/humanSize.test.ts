import { describe, it, expect } from "vitest";
import { humanSize } from "./humanSize";

describe("humanSize", () => {
  it("reads at a glance", () => {
    expect(humanSize(0)).toBe("0 B");
    expect(humanSize(999)).toBe("999 B");
    expect(humanSize(2048)).toBe("2.0 kB");
    expect(humanSize(1_500_000)).toBe("1.5 MB");
    // One decimal below ten, none above: "148.3 MB" is noise.
    expect(humanSize(148_300_000)).toBe("148 MB");
  });

  it("says nothing rather than something wrong for a nonsense size", () => {
    expect(humanSize(-1)).toBe("");
    expect(humanSize(Number.NaN)).toBe("");
  });
});
