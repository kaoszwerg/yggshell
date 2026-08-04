/**
 * Keeping the source and its rendering pointed at the same place.
 *
 * **Anchored, never proportional.** The obvious implementation of a follow mode maps one pane's
 * `scrollTop / scrollHeight` onto the other's, and it is wrong for markdown in a way that shows up on
 * the very first note that has a picture in it: an image is one line of source and four hundred
 * pixels of preview, and a code fence is the reverse. A ratio drifts further apart the further down
 * you go, which is exactly where a long note is read.
 *
 * So the two panes are tied together at **anchors** — one per top-level block, where the source
 * position and the drawn position are both known — and everything between two anchors is
 * interpolated. Between them the mapping is a straight line; at them it is exact.
 *
 * **Both anchors already existed before this file did**, which is why there is no measurement code
 * here and no font metrics to reimplement:
 *
 * - the preview writes `data-md-start` on every block it draws (`components/ui/Markdown.tsx`);
 * - the editor's coloured mirror renders one `<span>` per source line, laid out pixel-identically to
 *   the textarea by construction (`components/ui/MarkdownEditor.tsx`), so a span's `offsetTop` *is*
 *   the pixel position of that line.
 *
 * Nothing in this module touches the DOM. It takes numbers that were measured and returns numbers to
 * assign, so the arithmetic that decides whether the two panes agree is testable without a browser —
 * which is the half of a scroll sync that is otherwise only ever verified by eye.
 */

/** A place where both panes know where they are. Coordinates are content pixels, not screen ones. */
export type Anchor = { editor: number; preview: number };

/**
 * The offset each line of `source` begins at, in UTF-16 code units.
 *
 * The same unit as everything else that crosses to the backend (`notes::offsets`) and the only one
 * the parser and `setSelectionRange` speak. A document ending in a newline opens one more line,
 * because the caret can sit there.
 */
export function lineStarts(source: string): number[] {
  const starts = [0];
  for (let at = source.indexOf("\n"); at !== -1; at = source.indexOf("\n", at + 1)) {
    starts.push(at + 1);
  }
  return starts;
}

/**
 * Which line an offset falls on.
 *
 * **Clamped rather than exact**, because the offset may be one frame stale — the parse and the
 * measurement do not happen in the same instant. An out-of-range index would read `undefined` off a
 * pixel array and silently switch the whole sync off, which looks identical to a follow mode nobody
 * implemented.
 */
export function lineIndexAt(offset: number, starts: number[]): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts.at(middle) ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, Math.min(low, starts.length - 1));
}

/**
 * Tie each drawn block to the editor line its source starts on.
 *
 * `blocks` comes from the preview (`data-md-start` plus the element's `offsetTop`), `lineTops` from
 * the editor's mirror spans.
 *
 * **An anchor that does not advance both panes is dropped.** Interpolation divides by the gap between
 * two anchors, so a repeated coordinate is a division by zero and a backwards one is a fold in the
 * mapping. Both occur in ordinary notes: several blocks of a list item can begin on one source line,
 * and a block can be drawn at the same height as the one before it when something collapsed to
 * nothing.
 */
export function anchorsFor(
  blocks: { start: number; top: number }[],
  starts: number[],
  lineTops: number[],
): Anchor[] {
  const anchors: Anchor[] = [];
  for (const block of blocks) {
    const editor = lineTops[lineIndexAt(block.start, starts)];
    if (editor === undefined) continue;
    const last = anchors[anchors.length - 1];
    if (last !== undefined && (editor <= last.editor || block.top <= last.preview)) continue;
    anchors.push({ editor, preview: block.top });
  }
  return anchors;
}

/**
 * Where the other pane should be, given where this one is.
 *
 * Outside the outermost anchors the two move one-for-one: above the first block and below the last
 * there is nothing to interpolate against, and a sync that simply stopped there would look like it
 * had jammed at the ends. With no anchors at all — an empty note, or the first frame before anything
 * has been measured — the position is handed back unchanged rather than guessed at.
 */
export function projectScroll(y: number, anchors: Anchor[], to: "preview" | "editor"): number {
  // Read through a pair of accessors rather than `anchor[key]`: the key is a literal union and is
  // perfectly safe, but a computed property lookup is a lint finding either way, and quietening one
  // by hand is how the next genuinely unsafe lookup gets waved through too.
  const source = to === "preview" ? coord.editor : coord.preview;
  const target = to === "preview" ? coord.preview : coord.editor;

  const first = anchors.at(0);
  const last = anchors.at(-1);
  if (first === undefined || last === undefined) return y;
  if (y <= source(first)) return target(first) + (y - source(first));
  if (y >= source(last)) return target(last) + (y - source(last));

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors.at(index);
    const end = anchors.at(index + 1);
    if (start === undefined || end === undefined) continue;
    if (y < source(start) || y > source(end)) continue;
    const share = (y - source(start)) / (source(end) - source(start));
    return target(start) + share * (target(end) - target(start));
  }
  return y;
}

/** The two ways to read an anchor, as functions — see the note inside `projectScroll`. */
const coord = {
  editor: (anchor: Anchor) => anchor.editor,
  preview: (anchor: Anchor) => anchor.preview,
};

/** How much of the viewport is kept clear above and below the position being followed. */
const MARGIN = 0.2;

/**
 * The scroll position that brings `y` back into view, or `null` when it is already there.
 *
 * Used for the caret rather than for scrolling: while a sentence is being typed the preview must not
 * twitch on every keystroke, so nothing moves until the line being written leaves a comfortable band.
 * When it does, the pane moves **just far enough** — putting the caret's line at the top of the
 * viewport instead would throw the reader most of a screen for one character typed at the edge.
 */
export function keepInView(y: number, scrollTop: number, height: number): number | null {
  const margin = height * MARGIN;
  if (y < scrollTop + margin) return Math.max(0, y - margin);
  if (y > scrollTop + height - margin) return Math.max(0, y - height + margin);
  return null;
}
