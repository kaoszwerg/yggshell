// Turning a list of commits into a drawable graph.
//
// A history view that lists shas says nothing about how the work came together — which branch a
// commit was on, where one split off, where two came back together. That shape is the information,
// and this is where it is computed. Pure and separate from the rendering, so it can be tested against
// histories that would be tedious to construct in a repository.
import type { GitCommit } from "../bindings/GitCommit";

/** One line in the graph. */
export interface GraphRow {
  commit: GitCommit;
  /** Which column this commit's dot sits in. */
  lane: number;
  /** Lanes with a line passing through this row — this commit's included. Without these the graph
   *  would show dots with gaps where a parallel branch is simply not involved in this row. */
  through: number[];
  /** Curves from this commit down to a parent continuing in a different lane: a merge (this commit
   *  has several parents) or a branch point (a parent is already claimed by another lane). */
  links: { from: number; to: number }[];
  /** True when this commit brings two histories together. */
  merge: boolean;
}

export interface Graph {
  rows: GraphRow[];
  /** How many lanes are in use, so a renderer can size the gutter once. */
  lanes: number;
}

/**
 * Lay out `commits` (newest first) into lanes.
 *
 * Each lane holds the sha it is waiting for. A commit takes the lane that was expecting it — that is
 * what keeps a branch in one column down the page — or the first free one if nothing was. Its first
 * parent then continues that lane, and every further parent claims a lane of its own, which is what
 * makes a merge visible as two lines becoming one.
 */
export function layoutHistory(commits: GitCommit[]): Graph {
  // Lane bookkeeping in a Map rather than an array: a computed array index is an object-injection
  // sink and the gate runs at --max-warnings 0. Only occupied lanes are present, so a lane whose
  // branch has ended is simply absent and can be reused.
  const waiting = new Map<number, string>();
  let laneCount = 0;

  const laneWaitingFor = (sha: string): number => {
    for (const [lane, expected] of waiting) {
      if (expected === sha) return lane;
    }
    return -1;
  };

  const firstFreeLane = (): number => {
    for (let lane = 0; lane < laneCount; lane++) {
      if (!waiting.has(lane)) return lane;
    }
    return laneCount++;
  };

  const claim = (sha: string): number => {
    const existing = laneWaitingFor(sha);
    if (existing >= 0) return existing;
    const lane = firstFreeLane();
    waiting.set(lane, sha);
    return lane;
  };

  const rows = commits.map((commit) => {
    const lane = claim(commit.sha);

    // Read *before* the lane is re-pointed at the parent: what passes through this row is what was
    // pending when we arrived at it.
    const through = [...new Set([...waiting.keys(), lane])].sort((a, b) => a - b);

    const links: { from: number; to: number }[] = [];
    const [first, ...rest] = commit.parents;

    // The first parent inherits this lane, so a straight line means "same branch".
    if (first === undefined) waiting.delete(lane);
    else waiting.set(lane, first);

    for (const parent of rest) {
      const target = claim(parent);
      if (target !== lane) links.push({ from: lane, to: target });
    }
    // A first parent already claimed elsewhere means this line rejoins that one — a branch point read
    // from the bottom up.
    if (first !== undefined) {
      const elsewhere = laneWaitingFor(first);
      if (elsewhere >= 0 && elsewhere !== lane) links.push({ from: lane, to: elsewhere });
    }

    return { commit, lane, through, links, merge: commit.parents.length > 1 };
  });

  return { rows, lanes: Math.max(laneCount, 1) };
}
