import { describe, it, expect } from "vitest";
import { encodeKey } from "./terminalKeys";

/** A key event with nothing held, overridden per test. */
function key(over: Partial<Parameters<typeof encodeKey>[0]> = {}) {
  return { key: "Enter", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...over };
}

describe("encodeKey", () => {
  it("marks Shift+Enter so a program can tell it from Enter", () => {
    // The whole reason this exists: without it both arrive as a bare CR and an AI harness cannot
    // offer "submit" and "new line" as two different keys.
    expect(encodeKey(key({ shiftKey: true }))).toBe("\x1b\r");
  });

  it("leaves plain Enter to the emulator", () => {
    expect(encodeKey(key())).toBeNull();
  });

  it("leaves Enter with any other modifier alone", () => {
    // Ctrl+Enter, Alt+Enter and ⌘+Enter already mean things in real programs. A terminal that
    // rewrote them would take them away, and there is no other route back to the program.
    expect(encodeKey(key({ ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(encodeKey(key({ altKey: true, shiftKey: true }))).toBeNull();
    expect(encodeKey(key({ metaKey: true, shiftKey: true }))).toBeNull();
    expect(encodeKey(key({ ctrlKey: true }))).toBeNull();
  });

  it("leaves every other key alone, Shift or not", () => {
    // A rewrite list that grows silently is how a terminal stops being one.
    for (const name of ["a", "Tab", "Escape", "ArrowUp", "Backspace", " "]) {
      expect(encodeKey(key({ key: name }))).toBeNull();
      expect(encodeKey(key({ key: name, shiftKey: true }))).toBeNull();
    }
  });
});
