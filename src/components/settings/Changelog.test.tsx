import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Changelog } from "./Changelog";
import { useUiStore } from "../../store/ui";
import { api } from "../../api/commands";

vi.mock("../../api/commands", () => ({ api: { changelog: vi.fn() } }));

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

  it("renders the emphasis rather than showing its markers", async () => {
    // `**Keyboard shortcuts**` on screen reads as a formatting bug. It is now drawn as emphasis, so
    // the text is split across elements — which is the point, and what a plain-text match would miss.
    vi.mocked(api.changelog).mockResolvedValue("- **Keyboard shortcuts**, with `⌘T`\n");
    const { container } = render(<Changelog />);

    expect(await screen.findByText("Keyboard shortcuts")).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("Keyboard shortcuts");
    expect(container.querySelector("code")?.textContent).toBe("⌘T");
    expect(container.textContent).not.toContain("**");
  });

  it("says it could not be read rather than showing an empty panel", async () => {
    vi.mocked(api.changelog).mockRejectedValue(new Error("not embedded"));
    render(<Changelog />);

    expect(await screen.findByText(/not embedded/)).toBeInTheDocument();
  });
});
