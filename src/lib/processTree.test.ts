import { describe, it, expect } from "vitest";
import { treeRows } from "./processTree";
import type { ProcessInfo } from "../bindings/ProcessInfo";

/**
 * The guides are what make an indented list a tree, so a WRONG guide is worse than none: a line
 * carried past the end of a branch visually connects processes that have nothing to do with each
 * other — which is precisely the question the panel exists to answer.
 */
function at(depth: number, pid: number): ProcessInfo {
  return { pid, parent: 0, depth, state: "S", elapsed: "00:00:01", command: `p${pid}` };
}

describe("treeRows", () => {
  it("closes a branch at its last child instead of running the line past it", () => {
    //   zsh              depth 0
    //   ├─ npm           depth 1, has a sibling below → its level's line CONTINUES past node
    //   │  └─ node       depth 2, last child
    //   └─ cargo         depth 1, last child of zsh
    const [zsh, npm, node, cargo] = treeRows([at(0, 1), at(1, 2), at(2, 3), at(1, 4)]);

    expect(zsh?.last).toBe(true);
    expect(npm?.last).toBe(false); // cargo follows it at the same depth
    expect(node?.last).toBe(true);
    expect(cargo?.last).toBe(true);

    // `node` sits under `npm`, and `npm` still has `cargo` below it — so the level-1 line has to pass
    // through `node`'s row, or the two branches read as one.
    expect(node?.open).toEqual([false, true]);
  });

  it("stops an ancestor's line once that ancestor has no more children", () => {
    //   zsh              depth 0
    //   └─ npm           depth 1, LAST child
    //      ├─ node       depth 2
    //      └─ esbuild    depth 2, last
    const [, , node, esbuild] = treeRows([at(0, 1), at(1, 2), at(2, 3), at(2, 4)]);

    // Nothing follows `npm` at depth 1, so no line may be drawn at level 1 beside its children.
    // Drawn unconditionally — the obvious version — it would hang below the tree connecting nothing.
    expect(node?.open).toEqual([false, false]);
    expect(esbuild?.open).toEqual([false, false]);
    expect(node?.last).toBe(false);
    expect(esbuild?.last).toBe(true);
  });

  it("gives every row exactly one guide per level of depth", () => {
    // What lets the renderer MAP over the guides instead of indexing into them — a computed index is
    // an object-injection sink and the gate runs at --max-warnings 0.
    const rows = treeRows([at(0, 1), at(1, 2), at(2, 3), at(3, 4)]);
    expect(rows.map((r) => r.open.length)).toEqual([0, 1, 2, 3]);
  });

  it("keeps the list in its original order", () => {
    // It is computed backwards; handing it back backwards would reverse the process tree on screen,
    // which reads as plausible and is wrong.
    expect(treeRows([at(0, 1), at(1, 2), at(1, 3)]).map((r) => r.process.pid)).toEqual([1, 2, 3]);
  });

  it("has nothing to say about an empty list", () => {
    expect(treeRows([])).toEqual([]);
  });
});
