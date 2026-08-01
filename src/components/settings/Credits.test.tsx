import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Credits } from "./Credits";
import { useUiStore } from "../../store/ui";
import { api } from "../../api/commands";

vi.mock("../../api/commands", () => ({ api: { bundledCredits: vi.fn() } }));

describe("Credits", () => {
  beforeEach(() => {
    vi.mocked(api.bundledCredits).mockReset();
    useUiStore.setState({ locale: "en" });
  });

  it("shows the notices that ship with the app", async () => {
    // The obligation, not a courtesy: every ported scheme is MIT, and MIT requires the copyright
    // notice to travel with the copy. It shipped inside the binary while the notice stayed in the
    // repository, which does not satisfy that.
    vi.mocked(api.bundledCredits).mockResolvedValue(
      "# Bundled colour schemes\n\nDracula — MIT, © 2023 Dracula Theme\n",
    );
    render(<Credits />);

    expect(await screen.findByText(/Dracula Theme/)).toBeInTheDocument();
  });

  it("keeps every line, including one the renderer does not understand", async () => {
    // A licence notice is its wording, and a renderer that silently drops what it cannot parse turns
    // it into a shorter notice — nobody notices until the missing line is the one that mattered.
    vi.mocked(api.bundledCredits).mockResolvedValue(
      "© 2011 Ethan Schoonover\n\n> a block quote nobody taught it about\n",
    );
    const { container } = render(<Credits />);

    await screen.findByText(/Schoonover/);
    expect(container.textContent).toContain("a block quote nobody taught it about");
  });

  it("renders the table of upstreams as a table", async () => {
    // Most of the notice IS a table; as raw text it is a wall of pipes.
    vi.mocked(api.bundledCredits).mockResolvedValue(
      "| Scheme | Licence |\n| --- | --- |\n| Nord | MIT |\n",
    );
    render(<Credits />);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "MIT" })).toBeInTheDocument();
  });

  it("says it could not read them rather than showing nothing", async () => {
    // An empty licence panel reads as "nothing to credit", which is the opposite of true.
    vi.mocked(api.bundledCredits).mockRejectedValue(new Error("resource missing"));
    render(<Credits />);

    expect(await screen.findByText(/resource missing/)).toBeInTheDocument();
  });
});
