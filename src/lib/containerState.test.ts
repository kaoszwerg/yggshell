import { describe, it, expect } from "vitest";
import { stateColour } from "./containerState";

describe("stateColour", () => {
  it("does not paint a finished container as a failure", () => {
    // A container that did its job and exited is not a problem; colouring it red would train the
    // eye to ignore red.
    expect(stateColour("exited")).toBe("text-gold");
    expect(stateColour("dead")).toBe("text-danger");
    expect(stateColour("running")).toBe("text-green");
    expect(stateColour("something-new")).toBe("text-dim");
  });
});
