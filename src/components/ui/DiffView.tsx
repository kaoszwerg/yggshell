import { useQuery } from "@tanstack/react-query";
import { languageFor, tokenize, type Token } from "../../lib/highlight";
import type { GitDiff } from "../../bindings/GitDiff";
import type { GitHunk } from "../../bindings/GitHunk";

/** A hunk's lines, already coloured — one token list per line, in the hunk's own order. */
type Coloured = Token[][];

/**
 * Colour every hunk of a diff, and re-colour when the diff changes.
 *
 * A hunk is highlighted **as one piece** rather than line by line: a grammar needs to see a whole
 * block to know it is inside a string or a comment. It still only sees the hunk, not the file — so a
 * hunk that begins in the middle of a block comment can be mis-coloured. That is the honest limit of
 * highlighting a diff at all, and it costs colour, never content.
 */
function useColoured(diff: GitDiff): Coloured[] {
  // Through the query layer rather than an effect that sets state: this is async work with a result
  // to cache, which is what TanStack Query owns here (rule:frontend-architecture) — and it means
  // scrolling back to a diff already read does not re-tokenise it.
  const query = useQuery({
    queryKey: ["highlight", diff.path, diff.staged, diff.hunks],
    queryFn: () => {
      const language = languageFor(diff.path);
      return Promise.all(
        diff.hunks.map((hunk) =>
          tokenize(hunk.lines.map((line) => line.text).join("\n"), language),
        ),
      );
    },
  });
  return query.data ?? [];
}

/** Background tint and gutter mark per line kind. */
function lineStyle(kind: string): { row: string; mark: string } {
  switch (kind) {
    case "added":
      return { row: "bg-green/8", mark: "+" };
    case "removed":
      return { row: "bg-danger/8", mark: "−" };
    default:
      return { row: "", mark: " " };
  }
}

/**
 * A file diff, drawn.
 *
 * Both line numbers are shown because a diff is read in both directions — "what line is this now" and
 * "what line was it before" are different questions, and a viewer that answers only one of them sends
 * the reader back to the editor to count.
 *
 * The code column does not wrap: a wrapped line of code stops lining up with its number and its
 * neighbours, which is precisely what makes a diff readable. It scrolls sideways instead.
 */
export function DiffView({ diff }: { diff: GitDiff }) {
  const coloured = useColoured(diff);

  if (diff.binary) {
    return (
      <p className="text-dim p-4 font-mono text-xs">
        Binary file — there is nothing to show line by line.
      </p>
    );
  }

  if (diff.hunks.length === 0) {
    return (
      <p className="text-dim p-4 font-mono text-xs">
        No changes in this file{diff.staged ? " between HEAD and the index" : ""}.
      </p>
    );
  }

  return (
    <div className="font-mono text-[0.7rem] leading-[1.5]">
      {diff.hunks.map((hunk, index) => (
        <Hunk
          key={`${hunk.old_start}:${hunk.new_start}`}
          hunk={hunk}
          coloured={coloured.at(index)}
        />
      ))}
    </div>
  );
}

function Hunk({ hunk, coloured }: { hunk: GitHunk; coloured: Coloured | undefined }) {
  return (
    <section>
      <div className="bg-elevated text-cyan/70 border-cyan/15 border-y px-2 py-0.5">
        {hunk.header}
      </div>
      {hunk.lines.map((line, index) => {
        const { row, mark } = lineStyle(line.kind);
        const tokens = coloured?.at(index);
        return (
          <div
            // A hunk can legitimately contain the same text twice, and both line numbers can be
            // absent, so the position within the hunk is the only stable identity here.
            key={`${hunk.old_start}:${index}`}
            className={`flex items-start ${row}`}
          >
            <span className="text-dim/50 w-10 shrink-0 pr-1 text-right select-none">
              {line.old_line ?? ""}
            </span>
            <span className="text-dim/50 w-10 shrink-0 pr-1 text-right select-none">
              {line.new_line ?? ""}
            </span>
            <span
              className={`w-4 shrink-0 text-center select-none ${
                line.kind === "added"
                  ? "text-green"
                  : line.kind === "removed"
                    ? "text-danger"
                    : "text-dim/30"
              }`}
              aria-hidden
            >
              {mark}
            </span>
            <code className="flex-1 whitespace-pre">
              {tokens === undefined
                ? line.text
                : tokens.map((token, at) => (
                    <span key={at} style={token.color ? { color: token.color } : undefined}>
                      {token.content}
                    </span>
                  ))}
            </code>
          </div>
        );
      })}
    </section>
  );
}
