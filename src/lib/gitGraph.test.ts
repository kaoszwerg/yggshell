import { describe, expect, it } from "vitest";
import { layoutHistory } from "./gitGraph";
import type { GitCommit } from "../bindings/GitCommit";

/** A commit is only its sha and its parents as far as the layout is concerned. */
const c = (sha: string, parents: string[] = []): GitCommit => ({
  sha,
  short_sha: sha.slice(0, 7),
  summary: sha,
  author: "",
  when: "",
  parents,
  refs: [],
});

describe("layoutHistory", () => {
  it("keeps a straight history in one lane", () => {
    const { rows, lanes } = layoutHistory([c("a", ["b"]), c("b", ["d"]), c("d")]);

    expect(lanes).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.links.length === 0)).toBe(true);
  });

  it("gives a second branch its own lane", () => {
    // Two tips over a shared root: `a` and `x` are unrelated heads, both reaching `root`.
    const { rows, lanes } = layoutHistory([c("a", ["root"]), c("x", ["root"]), c("root")]);

    expect(lanes).toBe(2);
    expect(rows[0]?.lane).toBe(0);
    // `x` was not expected by lane 0 — it is a separate line and must be drawn as one.
    expect(rows[1]?.lane).toBe(1);
  });

  it("marks a merge and links it to the lane its second parent lives in", () => {
    const { rows } = layoutHistory([
      c("m", ["main1", "feat1"]),
      c("main1", ["root"]),
      c("feat1", ["root"]),
      c("root"),
    ]);

    const merge = rows[0];
    expect(merge?.merge).toBe(true);
    // The first parent inherits the merge's lane; the second gets its own, and a curve says so.
    expect(merge?.links).toEqual([{ from: 0, to: 1 }]);
    expect(rows[1]?.lane).toBe(0);
    expect(rows[2]?.lane).toBe(1);
  });

  it("draws the lines that pass a row without touching it", () => {
    // While `feat1` is being drawn, `main`'s line still runs down the page beside it. Without the
    // through-lanes the graph would show a gap and read as two unrelated fragments.
    const { rows } = layoutHistory([
      c("m", ["main1", "feat1"]),
      c("main1", ["root"]),
      c("feat1", ["root"]),
      c("root"),
    ]);

    expect(rows[2]?.through).toContain(0);
    expect(rows[2]?.through).toContain(1);
  });

  it("frees a lane once its branch has ended", () => {
    // `x` is a root: nothing continues its lane, so a later unrelated tip may reuse it rather than
    // pushing the graph one column wider for no reason.
    const { lanes } = layoutHistory([c("a", ["b"]), c("x"), c("b")]);

    expect(lanes).toBe(2);
  });

  it("survives a parent that is not in the window", () => {
    // The history is capped, so the oldest commits routinely name parents that were never fetched.
    const { rows, lanes } = layoutHistory([c("a", ["missing"])]);

    expect(lanes).toBe(1);
    expect(rows[0]?.lane).toBe(0);
  });

  it("handles an empty history", () => {
    const { rows, lanes } = layoutHistory([]);

    expect(rows).toEqual([]);
    // One lane, so a renderer sizing its gutter from this never divides by zero.
    expect(lanes).toBe(1);
  });
});
