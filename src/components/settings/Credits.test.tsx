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

  it("keeps the wording exactly as written", async () => {
    // A licence notice is its wording. Parsing it into markup and dropping a line would be the
    // defect this panel exists to prevent.
    const text = "© 2011 Ethan Schoonover\n  indented, deliberately\n";
    vi.mocked(api.bundledCredits).mockResolvedValue(text);
    const { container } = render(<Credits />);

    await screen.findByText(/Schoonover/);
    expect(container.querySelector("pre")?.textContent).toBe(text);
  });

  it("says it could not read them rather than showing nothing", async () => {
    // An empty licence panel reads as "nothing to credit", which is the opposite of true.
    vi.mocked(api.bundledCredits).mockRejectedValue(new Error("resource missing"));
    render(<Credits />);

    expect(await screen.findByText(/resource missing/)).toBeInTheDocument();
  });
});
