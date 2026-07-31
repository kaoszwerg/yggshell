import { describe, it, expect } from "vitest";
import { smallCaps } from "./smallCaps";
import { APP_NAME } from "./app";

const shape = (name: string) => smallCaps(name).map((r) => `${r.text}${r.full ? "!" : ""}`);

describe("smallCaps", () => {
  it("keeps the name's own capitals full height and lowers the rest", () => {
    expect(shape("YggShell")).toEqual(["Y!", "GG", "S!", "HELL"]);
  });

  it("does this to the actual app name, whatever it is renamed to", () => {
    // The name has one source (app.identity.json) and a fork changes it. Nothing here may assume
    // which letters are capitals.
    const runs = smallCaps(APP_NAME);
    expect(runs.map((r) => r.text).join("")).toBe(APP_NAME.toUpperCase());
    expect(runs.some((r) => r.full)).toBe(true);
  });

  it("reproduces the name exactly, in capitals", () => {
    for (const name of ["YggShell", "ACME", "lowercase", "My App 2", "Ygg-Shell"]) {
      expect(
        smallCaps(name)
          .map((r) => r.text)
          .join(""),
      ).toBe(name.toUpperCase());
    }
  });

  it("treats an all-capitals name as one full run", () => {
    expect(shape("ACME")).toEqual(["ACME!"]);
  });

  it("treats an all-lowercase name as one small run", () => {
    expect(shape("shell")).toEqual(["SHELL"]);
  });

  it("does not start a new run for a character that has no case", () => {
    // A space or a dash belongs to the run it lands in, not to one of its own — the two capitals in
    // "My App" are both real capitals and both stay full height, which is the point.
    expect(shape("My App")).toEqual(["M!", "Y ", "A!", "PP"]);
    expect(shape("Ygg-Shell")).toEqual(["Y!", "GG-", "S!", "HELL"]);
  });

  it("has nothing to say about an empty name", () => {
    expect(smallCaps("")).toEqual([]);
  });
});
