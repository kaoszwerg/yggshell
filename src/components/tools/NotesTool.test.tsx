import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotesTool } from "./NotesTool";
import { useUiStore } from "../../store/ui";

vi.mock("../../hooks/useContentFontSize", () => ({ useContentFontSize: () => 17 }));
vi.mock("../../hooks/useNoteProject", () => ({ useNoteProject: () => "github.com/a/b" }));
vi.mock("../../api/notes", () => ({
  notesApi: {
    topics: vi.fn(),
    read: vi.fn(),
    capture: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    removeProject: vi.fn(() => Promise.resolve()),
    projects: vi.fn(() => Promise.resolve(["github.com/a/b"])),
    // Opening the tool syncs — that is the only place it happens, because doing it at startup put a
    // Touch ID prompt in front of the app.
    sync: vi.fn(() => Promise.resolve()),
    toggle: vi.fn(() => Promise.resolve(true)),
    search: vi.fn(() => Promise.resolve([])),
  },
}));

import { notesApi } from "../../api/notes";

function renderTool() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotesTool />
    </QueryClientProvider>,
  );
}

describe("NotesTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ locale: "en", view: "terminal", note: null });
    vi.mocked(notesApi.topics).mockResolvedValue(["inbox", "release"]);
    vi.mocked(notesApi.read).mockImplementation((_p: string, topic: string) =>
      Promise.resolve(
        topic === "inbox"
          ? "- [ ] !! ask about the frame\n      it flickers after a resize\n- [x] shipped\n"
          : "- [ ] notarise\n",
      ),
    );
  });

  it("shows one line per task and never its body", async () => {
    // The whole reason the tool and the view are separate surfaces. A body in a 280px column is what
    // stops the list being readable at a glance — "ich will auf einen Blick die aktuelle Situation
    // erfassen können".
    renderTool();

    expect(await screen.findByText("ask about the frame")).toBeTruthy();
    expect(screen.queryByText(/it flickers after a resize/)).toBeNull();
  });

  it("hides what is done until it is asked for, rather than deleting it", async () => {
    // A list that only grows becomes unreadable; a list that forgets is worse. The fold is the
    // answer the attention signal reached first (rule:attention-signals).
    renderTool();
    await screen.findByText("ask about the frame");

    expect(screen.queryByText("shipped")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /DONE · 1/i }));

    expect(await screen.findByText("shipped")).toBeTruthy();
  });

  it("files a capture with Enter and keeps typing on Shift+Enter", async () => {
    // The same keys the maintainer already types at the harness one panel over. A staging area that
    // costs two gestures is one people stop using.
    renderTool();
    const field = await screen.findByLabelText("Note something…");

    fireEvent.change(field, { target: { value: "a thought" } });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(notesApi.capture).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => {
      expect(notesApi.capture).toHaveBeenCalledWith("github.com/a/b", "a thought");
    });
  });

  it("ticks from the list, with no trip to the view", async () => {
    // Ticking is not editing: it rewrites the marker in the file, from here, with no mode. By far
    // the most frequent thing anyone does with this.
    renderTool();
    await screen.findByText("ask about the frame");

    fireEvent.click(screen.getAllByRole("button", { name: "Mark as done" })[0] as HTMLElement);

    await waitFor(() => {
      expect(notesApi.toggle).toHaveBeenCalled();
    });
    // The offset is the parser's, not a guess — the backend rewrites three bytes at it.
    expect(vi.mocked(notesApi.toggle).mock.calls[0]?.[2]).toBe(0);
  });

  it("searches across every project and opens the hit in the view", async () => {
    // Search IS navigation, which is why it lives in the tool rather than the page.
    vi.mocked(notesApi.search).mockResolvedValue([
      { project: "github.com/x/y", topic: "release", line: "notarise", offset: 0 },
    ]);
    renderTool();

    fireEvent.change(await screen.findByLabelText("Search all notes"), {
      target: { value: "notar" },
    });

    fireEvent.click(await screen.findByText("notarise"));
    expect(useUiStore.getState().view).toBe("notes");
    expect(useUiStore.getState().note).toEqual({
      project: "github.com/x/y",
      topic: "release",
      // No offset: opening a hit is "show me this note", not "put me in the editor at this byte".
      at: null,
    });
  });

  it("draws its content at the terminal's own text size", async () => {
    // rule:content-size — a note list reads like a terminal, and the setting exists because the
    // maintainer's eyes are not the developer's.
    const { container } = renderTool();
    await screen.findByText("ask about the frame");

    const sized = container.querySelector<HTMLElement>("[style*='font-size']");
    expect(sized?.style.fontSize).toBe("17px");
  });
});

describe("managing what is in the list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ locale: "en", view: "terminal", note: null });
    vi.mocked(notesApi.topics).mockResolvedValue(["inbox"]);
    vi.mocked(notesApi.read).mockResolvedValue("- [ ] first\n- [ ] second\n");
  });

  it("offers the actions on a VISIBLE control, not only on right-click", async () => {
    // The first build had them on right-click and the first question was "where is the menu?".
    // A hidden affordance is a missing one — nobody right-clicks a list row they have not seen.
    renderTool();
    await screen.findByText("first");

    fireEvent.click(screen.getByRole("button", { name: "Actions for first" }));

    expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Type into the terminal" })).toBeTruthy();
  });

  it("removes one entry and leaves its neighbours alone", async () => {
    // Spliced out by its own byte range, which the parser reports — the same number a tick rewrites
    // into. A second way of deciding what an item IS would be a second place for the two to disagree.
    renderTool();
    await screen.findByText("first");

    fireEvent.click(screen.getByRole("button", { name: "Actions for first" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(notesApi.write).toHaveBeenCalledWith("github.com/a/b", "inbox", "- [ ] second\n");
    });
  });

  it("says where a note would land instead of just 'nothing here'", async () => {
    // Asked outright: "how do I create projects?" and "wo landen Eingaben die ich ins Note something
    // Feld tippe?". The empty state and the line above the field are the only places that can answer
    // either, and neither said anything.
    vi.mocked(notesApi.topics).mockResolvedValue([]);
    renderTool();

    expect(await screen.findByText(/lands in this project's inbox/)).toBeTruthy();
    expect(screen.getByText(/files into github.com\/a\/b/)).toBeTruthy();
  });
});
