import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Changelog } from "./Changelog";
import { parseChangelog } from "../../lib/changelog";
import { useUiStore } from "../../store/ui";
import { api } from "../../api/commands";

vi.mock("../../api/commands", () => ({ api: { changelog: vi.fn() } }));

describe("parseChangelog", () => {
  it("recognises the three things the file is actually written with", () => {
    const lines = parseChangelog("## [0.2.0]\n### Added\n- a thing\nplain words");
    expect(lines.map((l) => l.kind)).toEqual(["release", "section", "item", "text"]);
    expect(lines[0]?.text).toBe("[0.2.0]");
    expect(lines[2]?.text).toBe("a thing");
  });

  it("keeps a line it does not recognise rather than dropping it", () => {
    // A parser that silently discards what it does not understand turns a paragraph somebody wrote
    // into nothing, and nobody notices until the entry that mattered is the missing one.
    const lines = parseChangelog("> a quote\n| a | table |");
    expect(lines.map((l) => l.text)).toEqual(["> a quote", "| a | table |"]);
  });

  it("keeps blank lines, because they are the paragraphs", () => {
    expect(parseChangelog("a\n\nb")).toHaveLength(3);
  });
});

describe("Changelog", () => {
  beforeEach(() => {
    vi.mocked(api.changelog).mockReset();
    useUiStore.setState({ locale: "en" });
  });

  it("shows what changed, with the releases as headings", async () => {
    vi.mocked(api.changelog).mockResolvedValue(
      "## [0.24.0] - 2026-08-01\n\n### Added\n\n- **Keyboard shortcuts**, rebindable\n",
    );
    render(<Changelog />);

    expect(
      await screen.findByRole("heading", { name: "[0.24.0] - 2026-08-01" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Added" })).toBeInTheDocument();
  });

  it("drops the emphasis markers, since nothing here renders them", async () => {
    // `**Keyboard shortcuts**` on screen is worse than plain text: it reads as a formatting bug.
    vi.mocked(api.changelog).mockResolvedValue("- **Keyboard shortcuts**, with `⌘T`\n");
    render(<Changelog />);

    expect(await screen.findByText(/Keyboard shortcuts, with ⌘T/)).toBeInTheDocument();
  });

  it("says it could not be read rather than showing an empty panel", async () => {
    vi.mocked(api.changelog).mockRejectedValue(new Error("not embedded"));
    render(<Changelog />);

    expect(await screen.findByText(/not embedded/)).toBeInTheDocument();
  });
});
