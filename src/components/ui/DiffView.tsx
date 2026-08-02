import { useQuery } from "@tanstack/react-query";
import { languageFor, tokenize, type SyntaxScheme, type Token } from "../../lib/highlight";
import { surfaceStyle } from "../../lib/schemeSurface";
import { sideBySide } from "../../lib/diffLayout";
import { useT } from "../../hooks/useT";
import type { GitDiff } from "../../bindings/GitDiff";
import type { GitDiffLine } from "../../bindings/GitDiffLine";
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
function useColoured(diff: GitDiff, scheme: SyntaxScheme | null): Coloured[] {
  // Through the query layer rather than an effect that sets state: this is async work with a result
  // to cache, which is what TanStack Query owns here (rule:frontend-architecture) — and it means
  // scrolling back to a diff already read does not re-tokenise it.
  const query = useQuery({
    queryKey: ["highlight", diff.path, diff.staged, diff.hunks, scheme?.id ?? "hud"],
    queryFn: () => {
      const language = languageFor(diff.path);
      return Promise.all(
        diff.hunks.map((hunk) =>
          tokenize(hunk.lines.map((line) => line.text).join("\n"), language, scheme),
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
      return { row: "scheme-add", mark: "+" };
    case "removed":
      return { row: "scheme-del", mark: "−" };
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
export function DiffView({
  diff,
  split,
  scheme,
  fontSize,
}: {
  diff: GitDiff;
  split: boolean;
  /** The colour scheme to draw in, or `null`/absent for the HUD palette. */
  scheme?: SyntaxScheme | null;
  /**
   * Text size in CSS pixels — the terminal's own setting.
   *
   * Not divided by the UI scale, unlike the emulator's: this is ordinary DOM, so the WebView zoom
   * already applies to it. Dividing would make a diff shrink as the rest of the interface grew.
   */
  fontSize: number;
}) {
  const coloured = useColoured(diff, scheme ?? null);
  const t = useT();

  if (diff.binary) {
    return <p className="text-dim p-4 font-mono text-xs">{t("diff.binary")}</p>;
  }

  // A file that is new has nothing on the left, and one that was deleted has nothing on the right —
  // so side-by-side draws a column of gaps beside the content and halves the width available to read
  // it. There is no comparison to make: show it as one column, whatever the setting says.
  const added = diff.hunks.some((hunk) => hunk.lines.some((line) => line.kind === "added"));
  const removed = diff.hunks.some((hunk) => hunk.lines.some((line) => line.kind === "removed"));
  const oneSided = !added || !removed;

  if (diff.hunks.length === 0) {
    return (
      <p className="text-dim p-4 font-mono text-xs">
        {t(diff.staged ? "diff.noChangesStaged" : "diff.noChanges")}
      </p>
    );
  }

  return (
    // Keeps the surface class even though its scroll container also has one: nested is harmless
    // (identical colour), and this component is used on its own elsewhere. What the container adds
    // is the REST of the height — a diff shorter than the panel used to leave the panel's own
    // `bg-elevated` showing below the last line, which is two backgrounds meeting mid-view.
    <div className="scheme-surface font-mono leading-[1.5]" style={surfaceStyle(scheme, fontSize)}>
      {diff.hunks.map((hunk, index) => {
        const key = `${hunk.old_start}:${hunk.new_start}`;
        return split && !oneSided ? (
          <SplitHunk key={key} hunk={hunk} coloured={coloured.at(index)} />
        ) : (
          // The gutter for a side that does not exist is dropped with it: a column of blanks beside
          // every line is width spent saying nothing.
          <Hunk
            key={key}
            hunk={hunk}
            coloured={coloured.at(index)}
            showOld={removed}
            showNew={added}
          />
        );
      })}
    </div>
  );
}

/** The tokens for one line of a hunk, or its plain text when highlighting has not arrived. */
function Code({ line, tokens }: { line: GitDiffLine; tokens: Token[] | undefined }) {
  if (tokens === undefined) return <>{line.text}</>;
  return (
    <>
      {tokens.map((token, at) => (
        <span key={at} style={token.color ? { color: token.color } : undefined}>
          {token.content}
        </span>
      ))}
    </>
  );
}

/**
 * The same hunk, side by side.
 *
 * Old on the left with its numbers, new on the right with its own — which is what makes a rename or a
 * reindent readable at all, because the eye compares two columns rather than reconstructing them from
 * a single interleaved one. A row where one side is missing renders as a **gap**, deliberately
 * unlike an empty line: a blank line is a line that exists.
 */
function SplitHunk({ hunk, coloured }: { hunk: GitHunk; coloured: Coloured | undefined }) {
  // The colouring is indexed by position in the UNIFIED line list, which is what was tokenised.
  const indexOf = new Map(hunk.lines.map((line, at) => [line, at]));
  const rows = sideBySide(hunk);

  return (
    <section>
      <div className="scheme-meta border-y px-2 py-0.5">{hunk.header}</div>
      {rows.map((row, index) => (
        <div key={`${hunk.old_start}:${index}`} className="flex items-start">
          <Side
            line={row.left}
            side="left"
            tokens={row.left ? coloured?.at(indexOf.get(row.left) ?? -1) : undefined}
          />
          <span aria-hidden className="scheme-divider w-px shrink-0 self-stretch" />
          <Side
            line={row.right}
            side="right"
            tokens={row.right ? coloured?.at(indexOf.get(row.right) ?? -1) : undefined}
          />
        </div>
      ))}
    </section>
  );
}

/** One half of a side-by-side row. `null` is a gap, and it is drawn as one. */
function Side({
  line,
  side,
  tokens,
}: {
  line: GitDiffLine | null;
  side: "left" | "right";
  tokens: Token[] | undefined;
}) {
  if (line === null) {
    return (
      <span aria-hidden className="scheme-gap min-w-0 flex-1 basis-0 px-1">
        &nbsp;
      </span>
    );
  }
  const changed = line.kind !== "context";
  const tint = changed ? (side === "left" ? "scheme-del" : "scheme-add") : "";
  const number = side === "left" ? line.old_line : line.new_line;

  return (
    <span className={`flex min-w-0 flex-1 basis-0 items-start ${tint}`}>
      <span className="scheme-num w-10 shrink-0 pr-1 text-right select-none">{number ?? ""}</span>
      {/* WRAPS. It used to be `whitespace-pre` inside `overflow-x-auto`, which gave every line its
          own horizontal scrollbar: to read one long line you dragged it, and the line above stayed
          where it was. A diff you cannot read without a mouse is not showing you the change.
          `wrap-anywhere` rather than `break-all`: a break only where one is needed, so ordinary code
          still breaks at spaces and only an unbroken path or a minified line is cut mid-token. */}
      <code className="min-w-0 flex-1 wrap-anywhere whitespace-pre-wrap">
        <Code line={line} tokens={tokens} />
      </code>
    </span>
  );
}

function Hunk({
  hunk,
  coloured,
  showOld = true,
  showNew = true,
}: {
  hunk: GitHunk;
  coloured: Coloured | undefined;
  /** Draw the old-line gutter. `false` for a file that is new — every number in it would be blank. */
  showOld?: boolean;
  /** Draw the new-line gutter. `false` for a file that was deleted. */
  showNew?: boolean;
}) {
  return (
    <section>
      <div className="scheme-meta border-y px-2 py-0.5">{hunk.header}</div>
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
            {showOld ? (
              <span className="scheme-num w-10 shrink-0 pr-1 text-right select-none">
                {line.old_line ?? ""}
              </span>
            ) : null}
            {showNew ? (
              <span className="scheme-num w-10 shrink-0 pr-1 text-right select-none">
                {line.new_line ?? ""}
              </span>
            ) : null}
            <span
              className={`w-4 shrink-0 text-center select-none ${
                line.kind === "added"
                  ? "scheme-mark-add"
                  : line.kind === "removed"
                    ? "scheme-mark-del"
                    : "scheme-mark-none"
              }`}
              aria-hidden
            >
              {mark}
            </span>
            {/* Wraps, and `min-w-0` is what lets it: a flex child defaults to `min-width: auto`,
                so without it the text sets the row's width and the wrap never happens. */}
            <code className="min-w-0 flex-1 wrap-anywhere whitespace-pre-wrap">
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
