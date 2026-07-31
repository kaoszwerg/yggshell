import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPrimarySelection,
  readPrimarySelection,
  setPrimarySelection,
} from "./primarySelection";

describe("primary selection", () => {
  beforeEach(clearPrimarySelection);

  it("is empty before anything has been selected", () => {
    expect(readPrimarySelection()).toBe("");
  });

  it("holds what was selected, because on Unix selecting IS the copy", () => {
    setPrimarySelection("cargo test --locked");

    expect(readPrimarySelection()).toBe("cargo test --locked");
  });

  it("keeps the newest selection", () => {
    setPrimarySelection("first");
    setPrimarySelection("second");

    expect(readPrimarySelection()).toBe("second");
  });

  it("ignores an empty selection instead of wiping the last one", () => {
    // A stray click deselects. If that overwrote PRIMARY, the line the user selected a moment ago —
    // and is reaching for the middle mouse button to paste — would be gone.
    setPrimarySelection("still wanted");
    setPrimarySelection("");
    setPrimarySelection("   \n\t ");

    expect(readPrimarySelection()).toBe("still wanted");
  });

  it("keeps leading and trailing whitespace of a real selection", () => {
    // Indentation is part of what was selected — pasting a shell line without it changes the command.
    setPrimarySelection("  indented  ");

    expect(readPrimarySelection()).toBe("  indented  ");
  });
});
