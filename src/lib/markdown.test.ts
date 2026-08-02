import { describe, it, expect } from "vitest";
import { parseMarkdown, type Block } from "./markdown";

function first<K extends Block["kind"]>(source: string, kind: K) {
  const block = parseMarkdown(source).find((b) => b.kind === kind);
  if (block === undefined) throw new Error(`no ${kind} in: ${source}`);
  return block as Extract<Block, { kind: K }>;
}

describe("parseMarkdown", () => {
  it("gives every block the bytes it came from", () => {
    // The reason this parser replaced the hand-written one. Ticking a checkbox rewrites `- [ ]` to
    // `- [x]` IN THE FILE, and clicking a block to edit it puts the caret at that block's source —
    // both are questions about which bytes, and neither can be answered without this.
    const source = "# Title\n\nA paragraph.\n";
    const [heading, paragraph] = parseMarkdown(source);

    expect(source.slice(heading?.at.start, heading?.at.end)).toBe("# Title");
    expect(source.slice(paragraph?.at.start, paragraph?.at.end)).toBe("A paragraph.");
  });

  it("tells a task item from a bullet, and ticked from not", () => {
    // The tool's whole interaction. A plain bullet must stay one: `done: null` is not `done: false`,
    // and drawing an empty checkbox beside every list item would be the renderer inventing tasks
    // nobody wrote.
    const list = first("- [ ] open\n- [x] done\n- plain\n", "list");

    expect(list.items.map((i) => i.done)).toEqual([false, true, null]);
  });

  it("keeps a fenced code block whole, with its language", () => {
    // Copying a code block is a feature; a fence parsed as three paragraphs cannot be copied as one.
    const fence = first("```bash\nnpm run app:build\n```\n", "fence");

    expect(fence.lang).toBe("bash");
    expect(fence.code).toBe("npm run app:build");
  });

  it("reads a GFM table", () => {
    const table = first("| a | b |\n| --- | --- |\n| 1 | 2 |\n", "table");

    expect(table.head.flat().map((run) => ("text" in run ? run.text : ""))).toEqual(["a", "b"]);
    expect(table.rows).toHaveLength(1);
  });

  it("keeps a link's target and an image's source apart from their text", () => {
    // Everything else may collapse to text; these two may not, because the target IS the content.
    const link = first("[label](https://example.com/x)\n", "paragraph");
    expect(link.content).toEqual([{ kind: "link", text: "label", href: "https://example.com/x" }]);

    const image = first("![a shot](assets/x.png)\n", "paragraph");
    expect(image.content).toEqual([{ kind: "image", alt: "a shot", src: "assets/x.png" }]);
  });

  it("treats raw HTML as TEXT, never as markup", () => {
    // The line that means there is no sanitiser to get wrong. A note arrives by paste from anywhere,
    // so this stopped being a nicety the moment notes existed (ADR-PROJ-004).
    const html = first("<script>alert(1)</script>\n", "html");

    expect(html.text).toContain("<script>");
    expect(html.kind).toBe("html");
  });

  it("keeps an inline tag as text too", () => {
    const paragraph = first("hello <b>there</b>\n", "paragraph");

    expect(paragraph.content.map((run) => ("text" in run ? run.text : "")).join("")).toContain(
      "<b>",
    );
  });

  it("does not drop what it does not model", () => {
    // The rule the hand-written parser was written around, and this one keeps: a renderer that
    // silently drops what it does not understand turns a licence notice into a shorter licence
    // notice, and nobody notices until the missing line is the one that mattered.
    const source = "> quoted\n\n***\n\n1. one\n2. two\n";
    const kinds = parseMarkdown(source).map((b) => b.kind);

    expect(kinds).toEqual(["quote", "rule", "list"]);
    expect(first(source, "list").ordered).toBe(true);
  });

  it("still reads what the two shipped documents use", () => {
    // CHANGELOG.md and CREDITS.md render through this. The parser changed under them; what they
    // contain must not have.
    const source = "## Heading\n\nA **bold** word and `code`.\n\n- one\n- two\n";
    expect(parseMarkdown(source).map((b) => b.kind)).toEqual(["heading", "paragraph", "list"]);
    expect(first(source, "heading").level).toBe(2);
  });

  it("has nothing to say about an empty document", () => {
    expect(parseMarkdown("")).toEqual([]);
  });
});
