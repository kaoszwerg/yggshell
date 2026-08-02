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

  it("carries the byte offset the backend rewrites", () => {
    // Ticking flips `- [ ]` to `- [x]` at this offset. It has to be the PARSER's number: a second
    // reader of the same format drifts from the first, and the drift lands on a file the user cares
    // about.
    const source = "- [ ] one\n- [ ] two\n";
    const items = taskItems(source);

    expect(source.slice(items[1]?.offset ?? 0).startsWith("- [ ] two")).toBe(true);
  });

  it("says nothing about a note with no tasks in it", () => {
    expect(taskItems("# A heading\n\nSome prose.\n")).toEqual([]);
  });
});
