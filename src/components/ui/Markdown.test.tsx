import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Markdown } from "./Markdown";
import { api } from "../../api/commands";
import { tokenize } from "../../lib/highlight";

vi.mock("../../api/commands", () => ({ api: { openExternal: vi.fn() } }));
// The real one loads a grammar over the network of modules; what matters here is WHICH language the
// renderer asks for, which is the part it used to get wrong by not asking at all.
vi.mock("../../lib/highlight", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/highlight")>()),
  tokenize: vi.fn((code: string) => Promise.resolve([[{ content: code }]])),
}));

describe("Markdown", () => {
  beforeEach(() => {
    vi.mocked(api.openExternal).mockReset().mockResolvedValue(undefined);
    vi.mocked(tokenize).mockClear();
  });

  it("makes each heading level larger than the one below it, relative to the text", () => {
    // They were fixed pixels — 14, 13 and 11 — so a note drawn at the terminal's own size
    // (rule:content-size) had headings SMALLER than its body the moment anybody turned that up, and
    // one pixel between a level 1 and a level 2 was not a hierarchy anyone could see.
    render(<Markdown source={"# One\n\n## Two\n\n### Three\n\n#### Four\n"} />);

    const size = (name: string) =>
      Number(
        /text-\[([\d.]+)em\]/.exec(screen.getByRole("heading", { name }).className)?.[1] ?? "0",
      );

    expect(size("One")).toBeGreaterThan(size("Two"));
    expect(size("Two")).toBeGreaterThan(size("Three"));
    expect(size("Three")).toBeGreaterThan(size("Four"));
    // Relative, so they follow whatever they are inside rather than fixing their own pixels.
    expect(size("Four")).toBeGreaterThanOrEqual(1);
  });

  it("draws a hard line break, instead of parsing one and dropping it", () => {
    // Two trailing spaces (or a backslash) is markdown's line break inside a paragraph. It was
    // parsed and turned into a text run holding "\n" — and HTML collapses a newline inside a
    // paragraph to a space, so it did nothing whatsoever on screen.
    const { container } = render(<Markdown source={"first line  \nsecond line\n"} />);

    expect(container.querySelectorAll("br")).toHaveLength(1);
    expect(container.textContent).toContain("first line");
    expect(container.textContent).toContain("second line");
  });

  it("keeps a bullet and its text on one line", () => {
    // Reported from a real note: the bullet sat alone on its line with the text underneath. The
    // item's paragraph rendered as a `<p>`, which is a block, so it broke the line and added its
    // own margin — and the hanging indent had nothing inline left to hang. The task items looked
    // right only because their flex row happened to keep the paragraph beside the checkbox.
    const { container } = render(<Markdown source={"- DMS Grundfunktionen\n- DMS Workflows\n"} />);

    const items = [...container.querySelectorAll("li")];
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.querySelector("p"), "a block element broke the line").toBeNull();
      expect(item.textContent).toContain("•");
    }
    expect(items[0]?.textContent).toContain("DMS Grundfunktionen");
  });

  it("still separates an item that really does have two paragraphs", () => {
    // The fix must not flatten a loose item into one run of text: the second paragraph keeps its
    // block, because an item with two of them needs the separation.
    const { container } = render(<Markdown source={"- first\n\n  second\n"} />);

    const item = container.querySelector("li");
    expect(item?.textContent).toContain("first");
    expect(item?.textContent).toContain("second");
    expect(item?.querySelectorAll("p")).toHaveLength(1);
  });

  it("renders headings as headings", () => {
    render(<Markdown source="## Bundled colour schemes" />);
    expect(screen.getByRole("heading", { name: "Bundled colour schemes" })).toBeInTheDocument();
  });

  it("renders a table as a table", () => {
    // The licence notice is mostly a table; as raw text it is a wall of pipes.
    render(<Markdown source={"| Scheme | Licence |\n| --- | --- |\n| Nord | MIT |"} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Scheme" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "MIT" })).toBeInTheDocument();
  });

  it("opens a link through the backend, never in the window", () => {
    // An <a href> in a Tauri window NAVIGATES THE WINDOW — the interface would be replaced by a web
    // page, with the terminals behind it gone and no way back.
    render(<Markdown source="see [the repo](https://github.com/kaoszwerg/yggshell)" />);

    fireEvent.click(screen.getByRole("button", { name: "the repo" }));
    expect(api.openExternal).toHaveBeenCalledWith("https://github.com/kaoszwerg/yggshell");
  });

  it("uses no anchor elements at all", () => {
    const { container } = render(<Markdown source="[x](https://example.com)" />);
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders a list as a list", () => {
    render(<Markdown source={"- one\n- two"} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  describe("fenced code", () => {
    it("colours a fence by the language it names", async () => {
      // ```bash and ```python are two different things to read. The parser carried the tag all along
      // and the renderer dropped it, so every fence looked the same.
      render(<Markdown source={"```python\nprint(1)\n```"} />);

      await waitFor(() => {
        expect(vi.mocked(tokenize)).toHaveBeenCalledWith("print(1)", "python", null);
      });
    });

    it("resolves the short tags people actually type", async () => {
      render(<Markdown source={"```sh\nls\n```"} />);

      await waitFor(() => {
        expect(vi.mocked(tokenize)).toHaveBeenCalledWith("ls", "shellscript", null);
      });
    });

    it("shows a fence we have no grammar for, uncoloured, rather than not at all", () => {
      // `perl` is not among the bundled grammars. Nothing is asked for, and the code still renders.
      render(<Markdown source={"```perl\nprint 1;\n```"} />);

      expect(screen.getByText("print 1;")).toBeInTheDocument();
      expect(vi.mocked(tokenize)).not.toHaveBeenCalled();
    });

    it("asks for nothing at all when the fence has no tag", () => {
      render(<Markdown source={"```\nplain\n```"} />);

      expect(screen.getByText("plain")).toBeInTheDocument();
      expect(vi.mocked(tokenize)).not.toHaveBeenCalled();
    });
  });
});
