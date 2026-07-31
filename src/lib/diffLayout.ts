import type { GitDiffLine } from "../bindings/GitDiffLine";
import type { GitHunk } from "../bindings/GitHunk";

/** One row of a side-by-side diff: what stands on the left, what stands on the right. */
export interface SideBySideRow {
  left: GitDiffLine | null;
  right: GitDiffLine | null;
}

/**
 * Turn a hunk's unified lines into side-by-side rows.
 *
 * A unified diff lists removals and then additions; side by side they belong on the SAME row, so a
 * changed line reads as one change rather than as a deletion followed by an unrelated insertion. That
 * pairing is the whole value of the view, and it is the only thing this function does.
 *
 * Where the counts differ — three lines removed, one added — the shorter side runs out and the rest
 * of the rows have `null` there. A `null` is a gap, not an empty line, and the caller must render it
 * as such: an empty line looks like a line that exists and is blank.
 */
export function sideBySide(hunk: GitHunk): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let at = 0;

  while (at < hunk.lines.length) {
    const line = hunk.lines.at(at);
    if (line === undefined) break;

    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      at += 1;
      continue;
    }

    // A run of removals followed by a run of additions is one change. Collected together so the two
    // sides can be zipped rather than stacked.
    const removed: GitDiffLine[] = [];
    while (hunk.lines.at(at)?.kind === "removed") {
      const entry = hunk.lines.at(at);
      if (entry) removed.push(entry);
      at += 1;
    }
    const added: GitDiffLine[] = [];
    while (hunk.lines.at(at)?.kind === "added") {
      const entry = hunk.lines.at(at);
      if (entry) added.push(entry);
      at += 1;
    }

    const pairs = Math.max(removed.length, added.length);
    for (let i = 0; i < pairs; i += 1) {
      rows.push({ left: removed.at(i) ?? null, right: added.at(i) ?? null });
    }

    // Neither branch matched — a kind we do not know. Advance rather than spin forever.
    if (removed.length === 0 && added.length === 0) {
      rows.push({ left: line, right: line });
      at += 1;
    }
  }

  return rows;
}
