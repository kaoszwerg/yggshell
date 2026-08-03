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
