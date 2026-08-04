import { describe, it, expect } from "vitest";
import { anchorsFor, keepInView, lineIndexAt, lineStarts, projectScroll } from "./followScroll";

describe("lineStarts", () => {
  it("gives the offset each line begins at", () => {
    expect(lineStarts("one\ntwo\nthree")).toEqual([0, 4, 8]);
  });

  it("counts a trailing newline as opening one more line", () => {
    // The editor shows a caret there, so it is a position, and a document that ends in a newline is
    // the normal case rather than the edge one.
    expect(lineStarts("one\n")).toEqual([0, 4]);
  });

  it("counts in UTF-16 code units, like everything else that crosses this boundary", () => {
    // `Grüße` is five code units and seven bytes. The whole offset contract is one unit or it is
    // nothing (`notes::offsets`).
    expect(lineStarts("Grüße\nzwei")).toEqual([0, 6]);
  });

  it("treats the empty document as one line", () => {
    expect(lineStarts("")).toEqual([0]);
  });
});

describe("lineIndexAt", () => {
  const starts = [0, 4, 8];

  it("finds the line an offset falls on", () => {
    expect(lineIndexAt(0, starts)).toBe(0);
    expect(lineIndexAt(3, starts)).toBe(0);
    expect(lineIndexAt(4, starts)).toBe(1);
    expect(lineIndexAt(9, starts)).toBe(2);
  });

  it("clamps rather than reporting a line that does not exist", () => {
    // A stale offset must not become an index into nothing — the caller reads a pixel position off
    // it, and `undefined` there would silently disable the whole sync.
    expect(lineIndexAt(-5, starts)).toBe(0);
    expect(lineIndexAt(9999, starts)).toBe(2);
  });
});

describe("anchorsFor", () => {
  const starts = [0, 10, 20, 30];
  const lineTops = [0, 16, 32, 48];

  it("pairs each block's first line with where that block was drawn", () => {
    const anchors = anchorsFor(
      [
        { start: 0, top: 0 },
        { start: 20, top: 300 },
      ],
      starts,
      lineTops,
    );

    expect(anchors).toEqual([
      { editor: 0, preview: 0 },
      { editor: 32, preview: 300 },
    ]);
  });

  it("drops an anchor that does not advance both panes", () => {
    // Interpolation divides by the gap between two anchors. A repeated or backwards coordinate is a
    // division by zero or a fold in the mapping — two source lines can share a rendered block, and
    // two blocks can share a line in a list.
    const anchors = anchorsFor(
      [
        { start: 0, top: 0 },
        { start: 0, top: 40 },
        { start: 20, top: 90 },
      ],
      starts,
      lineTops,
    );

    expect(anchors).toEqual([
      { editor: 0, preview: 0 },
      { editor: 32, preview: 90 },
    ]);
  });
});

describe("projectScroll", () => {
  const anchors = [
    { editor: 0, preview: 0 },
    { editor: 100, preview: 400 },
    { editor: 200, preview: 500 },
  ];

  it("maps an anchor onto its opposite exactly", () => {
    expect(projectScroll(100, anchors, "preview")).toBe(400);
    expect(projectScroll(400, anchors, "editor")).toBe(100);
  });

  it("interpolates between two anchors instead of scaling the whole document", () => {
    // The reason this is not a scrollTop ratio: an image is one line of source and 400px of preview.
    // Halfway between the first two anchors in the editor is halfway between them in the preview,
    // and NOT halfway down the document.
    expect(projectScroll(50, anchors, "preview")).toBe(200);
    expect(projectScroll(150, anchors, "preview")).toBe(450);
  });

  it("moves one-for-one outside the outermost anchors", () => {
    // Above the first block and below the last there is nothing to interpolate against. Scrolling
    // one pane must still move the other, or the sync appears to jam at the ends.
    expect(projectScroll(-30, anchors, "preview")).toBe(-30);
    expect(projectScroll(260, anchors, "preview")).toBe(560);
  });

  it("returns the position unchanged when there is nothing to anchor to", () => {
    // An empty note, or a first frame before anything has been measured.
    expect(projectScroll(42, [], "preview")).toBe(42);
  });
});

describe("keepInView", () => {
  it("leaves a position that is already comfortably visible alone", () => {
    // Scrolling the preview on every keystroke would make the pane twitch while a sentence is being
    // typed, which is the failure that makes people turn a follow mode off.
    expect(keepInView(300, 200, 400)).toBeNull();
  });

  it("scrolls up when the position is above the viewport", () => {
    expect(keepInView(100, 400, 400)).toBe(20);
  });

  it("scrolls down by just enough when the position has passed the bottom margin", () => {
    // To the bottom of the band, not to the top of it: putting the caret's line at the top would
    // throw the reader three quarters of a screen for one character typed at the edge.
    expect(keepInView(700, 200, 400)).toBe(380);
  });

  it("never scrolls above the top of the document", () => {
    expect(keepInView(10, 400, 400)).toBe(0);
  });
});
