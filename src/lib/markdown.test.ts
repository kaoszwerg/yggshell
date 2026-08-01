import { describe, it, expect } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("finds code, bold and links in one pass", () => {
    const runs = parseInline("Use `ygg` for **speed**, see [docs](https://example.com/x).");
    expect(runs.map((r) => r.kind)).toEqual([
      "text",
      "code",
      "text",
      "strong",
      "text",
      "link",
      "text",
    ]);
  });

  it("handles a link whose label is itself code", () => {
    // Both of our documents write repository names that way, and a two-pass parser mangles them.
    const runs = parseInline("[`kaoszwerg/yggshell`](https://github.com/kaoszwerg/yggshell)");
    expect(runs).toEqual([
      { kind: "link", text: "kaoszwerg/yggshell", href: "https://github.com/kaoszwerg/yggshell" },
    ]);
  });

  it("keeps plain text as it is", () => {
    expect(parseInline("nothing special here")).toEqual([
      { kind: "text", text: "nothing special here" },
    ]);
  });

  it("leaves an unclosed marker alone rather than eating the rest of the line", () => {
    expect(parseInline("a ** dangling marker")).toEqual([
      { kind: "text", text: "a ** dangling marker" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings at their level", () => {
    const blocks = parseMarkdown("# One\n## Two\n### Three");
    expect(blocks.map((b) => (b.kind === "heading" ? b.level : b.kind))).toEqual([1, 2, 3]);
  });

  it("joins a wrapped paragraph into one", () => {
    const blocks = parseMarkdown("a line\nthat wraps\n\nand another");
    expect(blocks).toHaveLength(2);
  });

  it("reads a table with its head and rows", () => {
    const blocks = parseMarkdown(
      "| Scheme | Licence |\n| --- | --- |\n| Nord | MIT |\n| Dracula | MIT |",
    );
    const table = blocks[0];
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") return;
    expect(table.head).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
  });

  it("does not turn a paragraph containing a pipe into a table", () => {
    // A lopsided grid is worse than the prose it came from.
    const blocks = parseMarkdown("press | to split the pane");
    expect(blocks[0]?.kind).toBe("paragraph");
  });

  it("reads a bullet list, including items that wrap", () => {
    // Every bullet in the changelog spans several lines; treating the continuation as a new
    // paragraph would break each entry in half.
    const blocks = parseMarkdown("- first item\n  continued here\n- second item");
    const list = blocks[0];
    expect(list?.kind).toBe("list");
    if (list?.kind !== "list") return;
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.map((r) => ("text" in r ? r.text : "")).join("")).toContain(
      "continued here",
    );
  });

  it("keeps emphasis that spans a wrapped bullet", () => {
    const blocks = parseMarkdown("- **bold across\n  two lines** and more");
    const list = blocks[0];
    if (list?.kind !== "list") throw new Error("expected a list");
    expect(list.items[0]?.some((r) => r.kind === "strong")).toBe(true);
  });

  it("keeps a line it does not understand rather than dropping it", () => {
    // A licence notice that quietly loses a line is the defect this exists to prevent.
    const blocks = parseMarkdown("> a block quote nobody taught it about");
    expect(blocks[0]?.kind).toBe("paragraph");
  });

  it("reads a horizontal rule", () => {
    expect(parseMarkdown("---")[0]?.kind).toBe("rule");
  });

  it("survives an empty document", () => {
    expect(parseMarkdown("")).toEqual([]);
  });
});
