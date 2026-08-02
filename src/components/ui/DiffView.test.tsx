import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DiffView } from "./DiffView";
import { HUD_TERMINAL_THEME } from "../../lib/terminalTheme";
import type { GitDiff } from "../../bindings/GitDiff";

vi.mock("../../hooks/useT", () => ({ useT: () => (key: string) => key }));
// Highlighting is asynchronous and irrelevant here: what is under test is the SURFACE a diff is
// drawn on, which is exactly the half the tokeniser never touched.
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));

const DIFF: GitDiff = {
  path: "src/main.rs",
  old_path: null,
  status: "modified",
  staged: false,
  binary: false,
  added: 1,
  removed: 1,
  hunks: [
    {
      header: "@@ -1,3 +1,3 @@",
      old_start: 1,
      new_start: 1,
      lines: [
        { kind: "context", old_line: 1, new_line: 1, text: "fn main() {" },
        { kind: "removed", old_line: 2, new_line: null, text: "  old();" },
        { kind: "added", old_line: null, new_line: 2, text: "  new();" },
      ],
    },
  ],
};

/** A diff of a file that is NEW: every line added, nothing on the left to compare against. */
function newFile(): GitDiff {
  return {
    ...DIFF,
    status: "added",
    old_path: null,
    removed: 0,
    added: 2,
    hunks: [
      {
        header: "@@ -0,0 +1,2 @@",
        old_start: 0,
        new_start: 1,
        lines: [
          { kind: "added", old_line: null, new_line: 1, text: "fn main() {}" },
          { kind: "added", old_line: null, new_line: 2, text: "// new" },
        ],
      },
    ],
  };
}

/** A diff with both sides — the case side-by-side exists for. */
function bothSides(): GitDiff {
  return DIFF;
}

/** A line far wider than any panel, which is what used to need a mouse to read. */
function longLine(): GitDiff {
  return {
    ...DIFF,
    hunks: [
      {
        header: "@@ -1 +1 @@",
        old_start: 1,
        new_start: 1,
        lines: [
          {
            kind: "added",
            old_line: null,
            new_line: 1,
            text: `const path = "${"/very/long/segment".repeat(20)}";`,
          },
        ],
      },
    ],
  };
}

/** A scheme with colours nothing else in the app uses, so a match cannot be a coincidence. */
const SCHEME = {
  id: "alien-blood",
  colours: { ...HUD_TERMINAL_THEME, background: "#0c1f0c", foreground: "#c3f0c3" },
};

function surface(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".scheme-surface");
  if (el === null) throw new Error("the diff has no surface element");
  return el;
}

describe("DiffView", () => {
  // The defect this pins: the scheme reached the tokeniser and NOTHING else. A diff configured as
  // Alien Blood showed Alien Blood keywords on the HUD's own background, with HUD line numbers and
  // HUD tints — "it just uses a different theme", and correctly so.
  it("draws its whole surface in the configured scheme, not just the syntax", () => {
    const { container } = render(
      <DiffView diff={DIFF} split={false} scheme={SCHEME} fontSize={13} />,
    );
    const style = surface(container).style;

    expect(style.getPropertyValue("--scheme-bg")).toBe("#0c1f0c");
    expect(style.getPropertyValue("--scheme-fg")).toBe("#c3f0c3");
  });

  it("still has a defined surface with no scheme at all", () => {
    // "Not configured" means the terminal's own default, not "inherit whatever is behind me" — a
    // diff that borrows the panel's background is the case that made the two views disagree.
    const { container } = render(<DiffView diff={DIFF} split={false} fontSize={13} />);
    const style = surface(container).style;

    expect(style.getPropertyValue("--scheme-bg")).toBe(HUD_TERMINAL_THEME.background);
    expect(style.getPropertyValue("--scheme-fg")).toBe(HUD_TERMINAL_THEME.foreground);
  });

  it("tints added and removed lines from the scheme, never from the HUD palette", () => {
    const { container } = render(
      <DiffView diff={DIFF} split={false} scheme={SCHEME} fontSize={13} />,
    );

    expect(container.querySelector(".scheme-add")).not.toBeNull();
    expect(container.querySelector(".scheme-del")).not.toBeNull();
    // The HUD classes are what they replaced. Their return is the regression.
    expect(container.innerHTML).not.toContain("bg-green/8");
    expect(container.innerHTML).not.toContain("bg-danger/8");
  });

  it("colours the hunk header and the line numbers from the scheme too", () => {
    const { container } = render(
      <DiffView diff={DIFF} split={false} scheme={SCHEME} fontSize={13} />,
    );

    expect(screen.getByText("@@ -1,3 +1,3 @@").className).toContain("scheme-meta");
    expect(container.querySelector(".scheme-num")).not.toBeNull();
    expect(container.innerHTML).not.toContain("text-dim/50");
  });

  it("does the same side by side", () => {
    // Two renderers, one surface: the split view had its own copy of every HUD class.
    const { container } = render(
      <DiffView diff={DIFF} split={true} scheme={SCHEME} fontSize={13} />,
    );

    expect(surface(container).style.getPropertyValue("--scheme-bg")).toBe("#0c1f0c");
    expect(container.querySelector(".scheme-num")).not.toBeNull();
    expect(container.innerHTML).not.toContain("bg-danger/8");
  });
});
describe("reading a diff without a mouse", () => {
  it("wraps a long line instead of scrolling it", () => {
    // Every line used to be its own `overflow-x-auto` box: to read one you dragged it sideways, and
    // the line above stayed where it was. A diff you cannot read without a mouse is not showing you
    // the change (reported).
    const { container } = render(
      <DiffView diff={longLine()} split={false} scheme={null} fontSize={13} />,
    );

    const code = container.querySelector("code");
    expect(code?.className).toContain("whitespace-pre-wrap");
    expect(code?.className).toContain("wrap-anywhere");
    expect(code?.className).not.toContain("overflow-x-auto");
    // `min-w-0`, or the flex child's `min-width: auto` lets the text set the row width and nothing
    // ever wraps.
    expect(code?.className).toContain("min-w-0");
  });
});

describe("a file that has only one side", () => {
  it("shows a new file in one column, whatever the split setting says", () => {
    // Nothing to compare: side by side draws a column of gaps beside the content and halves the
    // width available to read it (reported).
    const { container } = render(
      <DiffView diff={newFile()} split={true} scheme={null} fontSize={13} />,
    );

    // The split renderer draws a divider between its two halves; the unified one does not.
    expect(container.querySelector(".scheme-divider")).toBeNull();
  });

  it("drops the gutter for the side that does not exist", () => {
    // Every number in it would be blank — width spent saying nothing.
    const { container } = render(
      <DiffView diff={newFile()} split={false} scheme={null} fontSize={13} />,
    );

    const row = container.querySelector(".scheme-num")?.parentElement;
    expect(row?.querySelectorAll(".scheme-num")).toHaveLength(1);
  });

  it("still shows both sides when both exist", () => {
    const { container } = render(
      <DiffView diff={bothSides()} split={true} scheme={null} fontSize={13} />,
    );
    expect(container.querySelector(".scheme-divider")).not.toBeNull();
  });
});
