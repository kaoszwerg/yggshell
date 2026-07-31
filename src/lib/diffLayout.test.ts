import { describe, it, expect } from "vitest";
import { sideBySide } from "./diffLayout";
import type { GitHunk } from "../bindings/GitHunk";

const line = (kind: string, text: string, oldNo: number | null, newNo: number | null) => ({
  kind,
  text,
  old_line: oldNo,
  new_line: newNo,
});

const hunk = (lines: ReturnType<typeof line>[]): GitHunk => ({
  header: "@@ -1,1 +1,1 @@",
  old_start: 1,
  new_start: 1,
  lines,
});

describe("sideBySide", () => {
  it("puts context on both sides of the same row", () => {
    const rows = sideBySide(hunk([line("context", "same", 1, 1)]));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.left?.text).toBe("same");
    expect(rows[0]?.right?.text).toBe("same");
  });

  it("pairs a removal with the addition that replaced it", () => {
    // The point of the view: one change on one row, not a deletion followed by an unrelated insert.
    const rows = sideBySide(
      hunk([
        line("context", "a", 1, 1),
        line("removed", "old", 2, null),
        line("added", "new", null, 2),
        line("context", "b", 3, 3),
      ]),
    );
    expect(rows).toHaveLength(3);
    expect(rows[1]?.left?.text).toBe("old");
    expect(rows[1]?.right?.text).toBe("new");
  });

  it("zips a run of removals against a run of additions", () => {
    const rows = sideBySide(
      hunk([
        line("removed", "1", 1, null),
        line("removed", "2", 2, null),
        line("added", "one", null, 1),
        line("added", "two", null, 2),
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.left?.text, r.right?.text])).toEqual([
      ["1", "one"],
      ["2", "two"],
    ]);
  });

  it("leaves a gap, not a blank line, where one side runs out", () => {
    // A blank line looks like a line that exists and is empty. A gap is the absence of one.
    const rows = sideBySide(
      hunk([
        line("removed", "1", 1, null),
        line("removed", "2", 2, null),
        line("removed", "3", 3, null),
        line("added", "one", null, 1),
      ]),
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]?.right?.text).toBe("one");
    expect(rows[1]?.right).toBeNull();
    expect(rows[2]?.right).toBeNull();
    expect(rows[2]?.left?.text).toBe("3");
  });

  it("handles a pure addition and a pure deletion", () => {
    const added = sideBySide(hunk([line("added", "new", null, 1)]));
    expect(added[0]?.left).toBeNull();
    expect(added[0]?.right?.text).toBe("new");

    const removed = sideBySide(hunk([line("removed", "gone", 1, null)]));
    expect(removed[0]?.left?.text).toBe("gone");
    expect(removed[0]?.right).toBeNull();
  });

  it("keeps both line numbers, which is what the gutters show", () => {
    const rows = sideBySide(
      hunk([line("removed", "old", 42, null), line("added", "new", null, 43)]),
    );
    expect(rows[0]?.left?.old_line).toBe(42);
    expect(rows[0]?.right?.new_line).toBe(43);
  });

  it("has nothing to show for an empty hunk", () => {
    expect(sideBySide(hunk([]))).toEqual([]);
  });
});
