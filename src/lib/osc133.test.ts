import { describe, it, expect } from "vitest";
import { parseOsc133 } from "./osc133";

describe("parseOsc133", () => {
  it("reads a command starting", () => {
    expect(parseOsc133("C")).toEqual({ state: "running" });
  });

  it("reads a command finishing, with its exit status", () => {
    expect(parseOsc133("D;0")).toEqual({ state: "finished", exit: 0 });
    expect(parseOsc133("D;1")).toEqual({ state: "finished", exit: 1 });
    expect(parseOsc133("D;130")).toEqual({ state: "finished", exit: 130 });
  });

  it("reads a command finishing without one", () => {
    // Legitimate: not every shell says. The command is still over, which is the part that matters.
    expect(parseOsc133("D")).toEqual({ state: "finished", exit: null });
    expect(parseOsc133("D;")).toEqual({ state: "finished", exit: null });
  });

  it("does not guess at a status that is not a number", () => {
    expect(parseOsc133("D;oops")).toEqual({ state: "finished", exit: null });
    expect(parseOsc133("D;-1")).toEqual({ state: "finished", exit: null });
  });

  it("ignores the sequences that say nothing about activity", () => {
    // A prompt being drawn is not work happening.
    expect(parseOsc133("A")).toBeNull();
    expect(parseOsc133("B")).toBeNull();
  });

  it("ignores anything it does not know, rather than reacting to it", () => {
    expect(parseOsc133("")).toBeNull();
    expect(parseOsc133("P;k=v")).toBeNull();
    expect(parseOsc133("nonsense")).toBeNull();
  });

  it("tolerates the whitespace a shell may leave in", () => {
    expect(parseOsc133(" C ")).toEqual({ state: "running" });
    expect(parseOsc133("D; 7 ")).toEqual({ state: "finished", exit: 7 });
  });
});
