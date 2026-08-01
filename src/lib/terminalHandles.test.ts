import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPasteTargets,
  pasteInto,
  registerPasteTarget,
  clearTerminal,
} from "./terminalHandles";

describe("paste targets", () => {
  beforeEach(clearPasteTargets);

  it("delivers to the terminal that was asked for, and to no other", () => {
    const first = { paste: vi.fn(), clear: vi.fn() };
    const second = { paste: vi.fn(), clear: vi.fn() };
    registerPasteTarget("term-0", first);
    registerPasteTarget("term-1", second);

    pasteInto("term-1", "cargo test");

    expect(second.paste).toHaveBeenCalledExactlyOnceWith("cargo test");
    expect(first.paste).not.toHaveBeenCalled();
  });

  it("does nothing for a terminal that is already gone", () => {
    // A tab can close between the middle-click and the paste. That is a race, not a failure.
    expect(() => pasteInto("term-does-not-exist", "text")).not.toThrow();
  });

  it("does nothing for an empty selection", () => {
    const target = { paste: vi.fn(), clear: vi.fn() };
    registerPasteTarget("term-0", target);

    pasteInto("term-0", "");

    // Middle-clicking with nothing selected must be a no-op, exactly as on X11 — not an empty write
    // that nudges the shell's line editor.
    expect(target.paste).not.toHaveBeenCalled();
  });

  it("forgets a terminal when it unregisters", () => {
    const target = { paste: vi.fn(), clear: vi.fn() };
    registerPasteTarget("term-0", target);
    registerPasteTarget("term-0", undefined);

    pasteInto("term-0", "text");

    expect(target.paste).not.toHaveBeenCalled();
  });

  it("replaces the target when a pane re-registers", () => {
    // A pane re-registers when its key is reused after a remount; the newest emulator must win.
    const stale = { paste: vi.fn(), clear: vi.fn() };
    const fresh = { paste: vi.fn(), clear: vi.fn() };
    registerPasteTarget("term-0", stale);
    registerPasteTarget("term-0", fresh);

    pasteInto("term-0", "text");

    expect(fresh.paste).toHaveBeenCalledExactlyOnceWith("text");
    expect(stale.paste).not.toHaveBeenCalled();
  });
});

describe("clearing a terminal", () => {
  it("reaches the registered pane", () => {
    const clear = vi.fn();
    registerPasteTarget("term-1", { paste: vi.fn(), clear });

    clearTerminal("term-1");
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a pane that has gone", () => {
    // A tab can close between the keypress and the handler; that is not a failure worth reporting.
    expect(() => clearTerminal("term-gone")).not.toThrow();
  });

  it("clears only the pane it was asked about", () => {
    const one = vi.fn();
    const two = vi.fn();
    registerPasteTarget("term-1", { paste: vi.fn(), clear: one });
    registerPasteTarget("term-2", { paste: vi.fn(), clear: two });

    clearTerminal("term-2");
    expect(one).not.toHaveBeenCalled();
    expect(two).toHaveBeenCalledTimes(1);
  });
});
