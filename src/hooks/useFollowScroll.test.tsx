import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useRef } from "react";
import { useFollowScroll } from "./useFollowScroll";

/** jsdom lays nothing out, so every position a real browser would measure is stated here. */
function place(node: HTMLElement, top: number) {
  Object.defineProperty(node, "offsetTop", { value: top, configurable: true });
}

const SOURCE = "# one\n\nsecond block\n";
// Line starts: 0 ("# one"), 6 (""), 7 ("second block"), 20 (the position after the final newline).
// The two blocks the parser would report begin at 0 and 7.

function Harness({ enabled = true }: { enabled?: boolean }) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLPreElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const follow = useFollowScroll({ enabled, source: SOURCE, editor, mirror, preview });

  return (
    <div>
      <textarea
        ref={editor}
        aria-label="editor"
        defaultValue={SOURCE}
        onScroll={follow.onEditorScroll}
        onKeyUp={follow.followCaret}
      />
      <pre ref={mirror} data-testid="mirror" aria-hidden>
        <span data-md-line="0">{"# one\n"}</span>
        <span data-md-line="1">{"\n"}</span>
        <span data-md-line="2">{"second block\n"}</span>
        <span data-md-line="3">{"\n"}</span>
      </pre>
      <div ref={preview} data-testid="preview" onScroll={follow.onPreviewScroll}>
        <div data-md-start="0" data-md-end="5">
          one
        </div>
        <div data-md-start="7" data-md-end="19">
          second block
        </div>
      </div>
    </div>
  );
}

function mount(enabled = true) {
  const view = render(<Harness enabled={enabled} />);
  const editor = view.getByLabelText("editor") as HTMLTextAreaElement;
  const mirror = view.getByTestId("mirror");
  const preview = view.getByTestId("preview");

  // The editor's four lines at 16px apart; the preview's two blocks far apart, because the first one
  // is a heading followed by an image-sized gap. That difference is the whole point of anchoring.
  const lines = [...mirror.querySelectorAll<HTMLElement>("[data-md-line]")];
  lines.forEach((line, at) => {
    place(line, at * 16);
  });
  const blocks = [...preview.querySelectorAll<HTMLElement>("[data-md-start]")];
  place(blocks[0] as HTMLElement, 0);
  place(blocks[1] as HTMLElement, 300);
  Object.defineProperty(preview, "clientHeight", { value: 200, configurable: true });

  return { editor, preview };
}

describe("useFollowScroll", () => {
  it("moves the preview to the place the editor is looking at", () => {
    // Anchors: source offset 0 sits on editor line 0 (top 0) and preview top 0; offset 7 sits on
    // editor line 2 (top 32) and preview top 300. Scrolling the editor to 32 must land on 300 — NOT
    // on the 32 a proportional mapping would produce.
    const { editor, preview } = mount();

    editor.scrollTop = 32;
    fireEvent.scroll(editor);

    expect(preview.scrollTop).toBe(300);
  });

  it("interpolates between the two anchors rather than jumping block to block", () => {
    const { editor, preview } = mount();

    editor.scrollTop = 16;
    fireEvent.scroll(editor);

    expect(preview.scrollTop).toBe(150);
  });

  it("works the other way round", () => {
    const { editor, preview } = mount();

    preview.scrollTop = 300;
    fireEvent.scroll(preview);

    expect(editor.scrollTop).toBe(32);
  });

  it("does not let the two panes chase each other", () => {
    // The echo: moving the preview fires ITS scroll event, which would move the editor, which would
    // move the preview. The flag is consumed by exactly one event, so a second real scroll still
    // works — the failure mode of getting this wrong is a sync that dies after one use.
    const { editor, preview } = mount();

    editor.scrollTop = 32;
    fireEvent.scroll(editor);
    fireEvent.scroll(preview); // the echo, ignored
    expect(editor.scrollTop).toBe(32);

    preview.scrollTop = 0;
    fireEvent.scroll(preview); // a real one, honoured
    expect(editor.scrollTop).toBe(0);
  });

  it("leaves both panes alone when following is switched off", () => {
    // Comparing two distant parts of one note means deliberately breaking the tie.
    const { editor, preview } = mount(false);

    editor.scrollTop = 32;
    fireEvent.scroll(editor);

    expect(preview.scrollTop).toBe(0);
  });

  it("brings the caret's block into view without moving for every keystroke", () => {
    const { editor, preview } = mount();

    // The caret in the second block, while the preview is at the top: 300 is past the bottom of a
    // 200px viewport, so it moves.
    editor.setSelectionRange(8, 8);
    fireEvent.keyUp(editor);
    expect(preview.scrollTop).toBe(140);

    // The caret back in the first block, which is now above the viewport.
    editor.setSelectionRange(1, 1);
    fireEvent.keyUp(editor);
    expect(preview.scrollTop).toBe(0);
  });

  it("stays still while the caret is comfortably in view", () => {
    const { editor, preview } = mount();

    preview.scrollTop = 250;
    fireEvent.scroll(preview); // a real scroll, which also drags the editor along
    const settled = preview.scrollTop;

    editor.setSelectionRange(8, 8); // maps to preview 300, inside the band of [290, 410]
    fireEvent.keyUp(editor);

    expect(preview.scrollTop).toBe(settled);
  });
});
