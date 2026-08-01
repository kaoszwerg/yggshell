import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Markdown } from "./Markdown";
import { api } from "../../api/commands";

vi.mock("../../api/commands", () => ({ api: { openExternal: vi.fn() } }));

describe("Markdown", () => {
  beforeEach(() => vi.mocked(api.openExternal).mockReset().mockResolvedValue(undefined));

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
});
