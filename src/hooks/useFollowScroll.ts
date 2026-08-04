import { useRef, type RefObject } from "react";
import {
  anchorsFor,
  keepInView,
  lineIndexAt,
  lineStarts,
  projectScroll,
  type Anchor,
} from "../lib/followScroll";

/**
 * Tie the source and its rendering together, so scrolling one moves the other to the same place.
 *
 * The arithmetic is in `lib/followScroll` and is tested without a browser; this is the part that has
 * to touch the DOM — reading where a line and a block were actually drawn, and assigning the result.
 *
 * **Nothing here measures text.** The two positions it needs are already in the DOM: the editor's
 * mirror marks every source line (`data-md-line`) and the preview marks every block
 * (`data-md-start`). That is the whole reason the sync can be exact rather than proportional.
 */
export function useFollowScroll({
  enabled,
  source,
  editor,
  mirror,
  preview,
}: {
  enabled: boolean;
  /** The text both panes are showing. Its identity is the cache key for the measurements. */
  source: string;
  editor: RefObject<HTMLTextAreaElement | null>;
  mirror: RefObject<HTMLPreElement | null>;
  preview: RefObject<HTMLDivElement | null>;
}) {
  /**
   * Which pane is about to receive a scroll event it did not cause.
   *
   * **The flag is only raised when the assignment actually moved something.** Setting `scrollTop` to
   * the value it already holds — or to one the browser clamps away at the end of a document — fires
   * no event at all, and a flag raised for an event that never arrives silently swallows the user's
   * next real scroll. Comparing before and after is exact: an event happens if and only if the value
   * changed.
   */
  const echo = useRef({ editor: false, preview: false });

  /** The last measurement, and what it was taken against. */
  const measured = useRef<{
    source: string;
    editorWidth: number;
    previewWidth: number;
    previewHeight: number;
    anchors: Anchor[];
  } | null>(null);

  /**
   * Where the two panes agree, measured at most once per layout.
   *
   * Re-measuring on every scroll event would read `offsetTop` off every line and every block sixty
   * times a second. It is cached against the things that can move a line: the text itself, and either
   * pane's width — a narrower pane wraps differently, and a wrapped line is taller.
   * `scrollHeight` catches the rest, including an image that has just finished loading and pushed
   * everything below it down.
   */
  const anchors = (): Anchor[] => {
    const pre = mirror.current;
    const view = preview.current;
    if (pre === null || view === null) return [];

    const last = measured.current;
    if (
      last !== null &&
      last.source === source &&
      last.editorWidth === pre.clientWidth &&
      last.previewWidth === view.clientWidth &&
      last.previewHeight === view.scrollHeight
    ) {
      return last.anchors;
    }

    const lineTops = [...pre.querySelectorAll<HTMLElement>("[data-md-line]")].map(
      (node) => node.offsetTop,
    );
    const blocks = [...view.querySelectorAll<HTMLElement>("[data-md-start]")].map((node) => ({
      start: Number(node.dataset.mdStart ?? "0"),
      top: node.offsetTop,
    }));

    const next = anchorsFor(blocks, lineStarts(source), lineTops);
    measured.current = {
      source,
      editorWidth: pre.clientWidth,
      previewWidth: view.clientWidth,
      previewHeight: view.scrollHeight,
      anchors: next,
    };
    return next;
  };

  /** Move `pane`, and say whether that will come back as a scroll event. */
  const moveTo = (pane: HTMLElement, to: number): boolean => {
    const before = pane.scrollTop;
    pane.scrollTop = to;
    return pane.scrollTop !== before;
  };

  const onEditorScroll = () => {
    if (!enabled) {
      echo.current = { editor: false, preview: false };
      return;
    }
    if (echo.current.editor) {
      echo.current.editor = false;
      return;
    }
    const area = editor.current;
    const view = preview.current;
    if (area === null || view === null) return;
    if (moveTo(view, projectScroll(area.scrollTop, anchors(), "preview"))) {
      echo.current.preview = true;
    }
  };

  const onPreviewScroll = () => {
    if (!enabled) {
      echo.current = { editor: false, preview: false };
      return;
    }
    if (echo.current.preview) {
      echo.current.preview = false;
      return;
    }
    const area = editor.current;
    const view = preview.current;
    if (area === null || view === null) return;
    // Moving the textarea also moves its own mirror, through the editor's own scroll handler — which
    // is the same event this one is about to be told to ignore.
    if (moveTo(area, projectScroll(view.scrollTop, anchors(), "editor"))) {
      echo.current.editor = true;
    }
  };

  /**
   * Point the preview at whatever is being written, without twitching.
   *
   * Typing near the bottom of the editor scrolls it, and that already drags the preview along. This
   * is for the case that moves the caret without moving anything: clicking into a paragraph, or
   * arriving from the preview's own "edit here". Nothing moves while the line is comfortably in view
   * (`keepInView`), or the preview would jump on every keystroke.
   */
  const followCaret = () => {
    if (!enabled) return;
    const area = editor.current;
    const pre = mirror.current;
    const view = preview.current;
    if (area === null || pre === null || view === null) return;

    const line = lineIndexAt(area.selectionStart, lineStarts(source));
    const span = [...pre.querySelectorAll<HTMLElement>("[data-md-line]")].at(line);
    if (span === undefined) return;

    const target = projectScroll(span.offsetTop, anchors(), "preview");
    const next = keepInView(target, view.scrollTop, view.clientHeight);
    if (next === null) return;
    if (moveTo(view, next)) echo.current.preview = true;
  };

  return { onEditorScroll, onPreviewScroll, followCaret };
}
