import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotesView } from "./NotesView";
import { useUiStore } from "../store/ui";
import { useTerminalStore } from "../store/terminal";

vi.mock("../hooks/useContentFontSize", () => ({ useContentFontSize: () => 17 }));
vi.mock("../api/notes", () => ({
  notesApi: { read: vi.fn(), write: vi.fn(), readImage: vi.fn() },
}));

import { notesApi } from "../api/notes";

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotesView />
    </QueryClientProvider>,
  );
}

describe("NotesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ locale: "en", note: { project: "p", topic: "inbox" } });
    useTerminalStore.setState({ panes: [], activeKey: null });
    vi.mocked(notesApi.read).mockResolvedValue("# A note\n\n- [ ] something\n");
  });

  it("draws the note at the terminal's own text size", async () => {
    // rule:content-size, asked for a second time by the maintainer after the tool had it and the view
    // did not. A hook that is imported and never reaches the DOM looks identical from the outside,
    // which is exactly why every tool owes this one test.
    const { container } = renderView();
    await screen.findByText("A note");

    const sized = container.querySelector<HTMLElement>("[style*='font-size']");
    expect(sized?.style.fontSize).toBe("17px");
  });

  it("opens READING, never in an editor", async () => {
    // Two named states, and you are always in exactly one. Reading is the default and is never
    // accidentally editable.
    renderView();
    await screen.findByText("A note");

    expect(screen.queryByLabelText("Write")).toBeNull();
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
  });

  it("gives every block its source range, so a click can say WHERE to write", async () => {
    // What the parser's byte offsets buy: "write, here" instead of "write, now find it".
    const { container } = renderView();
    await screen.findByText("A note");

    const blocks = container.querySelectorAll("[data-md-start]");
    expect(blocks.length).toBeGreaterThan(1);
  });
});
