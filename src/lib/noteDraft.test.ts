import { describe, it, expect, beforeEach, vi } from "vitest";
import { setNoteFlush, hasPendingDraft, flushNote, resetNoteDrafts } from "./noteDraft";

describe("noteDraft", () => {
  beforeEach(() => {
    resetNoteDrafts();
  });

  it("flushes the editor before another writer touches the same note", async () => {
    // The defect: the tool toggles a checkbox by byte offset while the editor still has keystrokes on
    // a 600 ms debounce. The debounced write lands afterwards with the old checkbox in it and the
    // tick is silently undone. One writer in flight at a time is what stops that.
    const order: string[] = [];
    setNoteFlush("p", "t", async () => {
      order.push("editor wrote");
      await Promise.resolve();
    });

    await flushNote("p", "t");
    order.push("tool wrote");

    expect(order).toEqual(["editor wrote", "tool wrote"]);
  });

  it("costs nothing when nothing is pending", async () => {
    // The common case by far: no editor open, or open with everything already saved.
    await expect(flushNote("p", "t")).resolves.toBeUndefined();
    expect(hasPendingDraft("p", "t")).toBe(false);
  });

  it("keeps notes apart", async () => {
    const other = vi.fn();
    setNoteFlush("p", "other", other);

    await flushNote("p", "t");

    expect(other).not.toHaveBeenCalled();
    expect(hasPendingDraft("p", "other")).toBe(true);
  });

  it("forgets a note once its draft has landed", () => {
    setNoteFlush("p", "t", vi.fn());
    expect(hasPendingDraft("p", "t")).toBe(true);

    setNoteFlush("p", "t", null);

    expect(hasPendingDraft("p", "t")).toBe(false);
  });

  it("does not let a failed save block the other writer", async () => {
    // The editor reports its own save failures to the user. Refusing the toggle as well would tell
    // them the same thing twice and leave them unable to act on the note at all.
    setNoteFlush("p", "t", () => Promise.reject(new Error("disk full")));

    await expect(flushNote("p", "t")).resolves.toBeUndefined();
  });

  it("waits for a slow save rather than racing it", async () => {
    vi.useFakeTimers();
    let landed = false;
    setNoteFlush(
      "p",
      "t",
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            landed = true;
            resolve();
          }, 50);
        }),
    );

    const flushed = flushNote("p", "t");
    await vi.advanceTimersByTimeAsync(50);
    await flushed;

    expect(landed).toBe(true);
    vi.useRealTimers();
  });
});
