import { describe, it, expect } from "vitest";
import { taskItems } from "./noteTasks";

describe("taskItems", () => {
  it("takes only the tasks, and only their first line", () => {
    // The tool is a list you read at a glance. A body in a 280px column is what stops it being one —
    // that is what the view is for.
    const items = taskItems(
      "- [ ] ask about the frame\n      it flickers after a resize\n- [x] shipped\n- a plain bullet\n",
    );

    expect(items.map((i) => i.title)).toEqual(["ask about the frame", "shipped"]);
    expect(items.map((i) => i.done)).toEqual([false, true]);
  });

  it("reads the priority off the front and takes it out of the title", () => {
    // A sort order, never a schedule: this app declines due dates on purpose — "ich will das nicht zu
    // einer Arbeitsquelle machen die ich auch noch managen muss".
    const items = taskItems("- [ ] plain\n- [ ] ! soon\n- [ ] !! now\n");

    expect(items.map((i) => i.priority)).toEqual([2, 1, 0]);
    expect(items.map((i) => i.title)).toEqual(["now", "soon", "plain"]);
  });

  it("carries the offset the backend rewrites", () => {
    // Ticking flips `- [ ]` to `- [x]` at this offset. It has to be the PARSER's number: a second
    // reader of the same format drifts from the first, and the drift lands on a file the user cares
    // about.
    const source = "- [ ] one\n- [ ] two\n";
    const items = taskItems(source);

    expect(source.slice(items[1]?.offset ?? 0).startsWith("- [ ] two")).toBe(true);
  });

  it("counts that offset in UTF-16 code units, which is the unit the boundary carries", () => {
    // This side of the contract pinned in `notes::offsets` (`rule:testing` — a contract is pinned on
    // both sides). `Grüße` is five code units and seven bytes; the backend converts, and it read this
    // as a byte offset until 2026-08-04, which made every task below a German word untickable.
    const source = "- [ ] Grüße\n- [ ] zwei\n";
    const items = taskItems(source);

    expect(items[1]?.offset).toBe(12);
    expect(source.slice(items[1]?.offset ?? 0).startsWith("- [ ] zwei")).toBe(true);
  });

  it("says nothing about a note with no tasks in it", () => {
    expect(taskItems("# A heading\n\nSome prose.\n")).toEqual([]);
  });
});
