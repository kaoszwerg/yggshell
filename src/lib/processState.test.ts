import { describe, it, expect } from "vitest";
import { stateColour } from "./processState";

describe("stateColour", () => {
  it("calls out a zombie, because it is the state that means something is wrong", () => {
    // Everything else is a process being quiet; a zombie is one nobody reaped.
    expect(stateColour("Z")).toBe("text-danger");
    expect(stateColour("Z+")).toBe("text-danger");
  });

  it("marks what is actually running", () => {
    expect(stateColour("R")).toBe("text-green");
    expect(stateColour("R+")).toBe("text-green");
  });

  it("marks a stopped process apart from a sleeping one", () => {
    // `T` is suspended — ^Z and forgotten about, which is exactly what this tool is for.
    expect(stateColour("T")).toBe("text-gold");
    expect(stateColour("S")).toBe("text-dim");
    expect(stateColour("Ss")).toBe("text-dim");
  });

  it("has an answer for a letter it does not know", () => {
    expect(stateColour("")).toBe("text-dim");
    expect(stateColour("?")).toBe("text-dim");
  });
});
