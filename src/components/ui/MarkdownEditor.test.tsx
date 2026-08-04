import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

vi.mock("../../lib/highlight", () => ({
  // Two tokens per line, so a test can tell "coloured" from "plain text" without a real grammar.
  tokenize: vi.fn((code: string) =>
    Promise.resolve(code.split("\n").map((line) => [{ content: line, color: "#ff0000" }])),
  ),
}));

import { tokenize } from "../../lib/highlight";

function mount(over: Partial<Parameters<typeof MarkdownEditor>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <MarkdownEditor
      value="# hello"
      onChange={onChange}
      scheme={null}
      fontSize={13}
      label="Note text"
      {...over}
    />,
  );
  return { onChange, ...view };
}

describe("MarkdownEditor", () => {
  it("is still a real textarea the user types into", async () => {
    const { onChange } = mount();

    const area = await screen.findByLabelText<HTMLTextAreaElement>("Note text");
    fireEvent.change(area, { target: { value: "typed" } });

    expect(onChange).toHaveBeenCalledWith("typed");
  });

  it("colours the markdown as markdown", async () => {
    mount({ value: "# hello" });

    await waitFor(() => {
      expect(vi.mocked(tokenize)).toHaveBeenCalledWith("# hello", "markdown", null);
    });
  });

  it("shows the text immediately, before any colouring has arrived", () => {
    // The mechanism makes the textarea's own text transparent, so if the mirror waited for tokens
    // the line just typed would be invisible until they came back. It renders the raw value until
    // the colouring catches up.
    const { container } = mount({ value: "brand new line" });

    expect(container.querySelector("pre")?.textContent).toContain("brand new line");
  });

  it("keeps the caret visible while the text itself is transparent", async () => {
    // The whole trick in two properties. Lose either and the editor is unusable: no caret to aim
    // with, or the text drawn twice and slightly offset.
    mount();

    const area = await screen.findByLabelText<HTMLTextAreaElement>("Note text");
    expect(area.style.color).toBe("transparent");
    expect(area.style.caretColor).toBe("var(--scheme-fg)");
    expect(area.style.background).toBe("transparent");
  });

  it("lays both layers out identically, or the caret drifts from the letters", async () => {
    const { container } = mount({ fontSize: 17 });

    const area = await screen.findByLabelText<HTMLTextAreaElement>("Note text");
    const mirror = container.querySelector("pre");

    expect(area.style.fontSize).toBe("17px");
    expect(mirror?.style.fontSize).toBe("17px");
    expect(area.style.lineHeight).toBe(mirror?.style.lineHeight);
    expect(area.style.padding).toBe(mirror?.style.padding);
  });

  it("marks one element per source line, which is what a follow mode measures", async () => {
    // The mirror is laid out pixel-identically to the textarea by construction, so a line's element
    // IS that line's pixel position. `lib/followScroll` reads `offsetTop` off these and needs no font
    // metrics of its own because of it.
    const { container } = mount({ value: "one\ntwo\nthree" });

    await waitFor(() => {
      expect(container.querySelectorAll("[data-md-line]")).toHaveLength(3);
    });
    expect([...container.querySelectorAll("[data-md-line]")].map((n) => n.textContent)).toEqual([
      "one\n",
      "two\n",
      "three\n",
    ]);
  });

  it("marks them before the colouring has arrived, too", () => {
    // The trap this exists for: the uncoloured fallback used to render the raw value as one text
    // node, so every anchor vanished for a frame on EVERY keystroke — precisely while typing, which
    // is when a follow mode is watched.
    const { container } = mount({ value: "one\ntwo" });

    expect(container.querySelectorAll("[data-md-line]")).toHaveLength(2);
  });

  it("hands the mirror out, because only the caller knows what it wants to measure", async () => {
    // A callback, not a ref to write into: a component may not assign to a ref it was given.
    const seen: (HTMLPreElement | null)[] = [];
    mount({
      onMirror: (node) => {
        seen.push(node);
      },
    });
    await screen.findByLabelText("Note text");

    expect(seen[0]?.tagName).toBe("PRE");
  });

  it("hides the coloured copy from screen readers", async () => {
    // The textarea above it is the real control; announcing both reads the note twice.
    const { container } = mount();
    await screen.findByLabelText("Note text");

    expect(container.querySelector("pre")?.getAttribute("aria-hidden")).toBe("true");
  });
});
