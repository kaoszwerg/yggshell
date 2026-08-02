import type { ProcessInfo } from "../bindings/ProcessInfo";

/** One process, with everything a row needs to draw the rules that connect it to its parent. */
export type ProcessRow = {
  process: ProcessInfo;
  /**
   * One entry per ancestor level, in order: does that level's line continue past this row?
   *
   * Exactly `process.depth` long, so a renderer maps over it instead of indexing into it — which is
   * also why this is an array of resolved booleans rather than the raw bookkeeping.
   */
  open: boolean[];
  /** Whether this row is the last child of its parent, so its elbow closes the branch. */
  last: boolean;
};

/**
 * Turn a flat, pre-ordered process list into rows that know how to draw themselves as a tree.
 *
 * **Why guides at all.** Indentation does not say who started whom: at the depths this list reaches,
 * two rows one step apart could be parent and child or cousins, and the eye cannot tell them apart.
 *
 * **Why they have to be right.** A line drawn at every level, unconditionally, is the obvious version
 * and it is wrong: it runs past the end of a branch and visually connects processes that have nothing
 * to do with each other. That is worse than no line, because it answers the panel's own question
 * incorrectly and confidently.
 *
 * Computed right to left in one pass. The set holds the levels that are still "open" — a level is open
 * when a node at that level follows, with nothing shallower in between, which is exactly what a further
 * sibling is. Reaching a node at depth `d` closes every level from `d` down and opens `d`, because a
 * node cannot have siblings below something shallower than itself; that closing is what makes the
 * shallower entries trustworthy without a second scan.
 *
 * A `Set` rather than an array indexed by level, deliberately: a computed index is an object-injection
 * sink and the gate runs at `--max-warnings 0` (the same reason `toolLabelKey` is a switch).
 */
export function treeRows(processes: ProcessInfo[]): ProcessRow[] {
  const rows: ProcessRow[] = [];
  const open = new Set<number>();

  for (const process of [...processes].reverse()) {
    const depth = process.depth;
    rows.push({
      process,
      open: Array.from({ length: depth }, (_, level) => open.has(level)),
      last: !open.has(depth),
    });
    for (const level of [...open]) if (level >= depth) open.delete(level);
    open.add(depth);
  }

  return rows.reverse();
}
