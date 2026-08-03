import { fireEvent, render, screen } from "@testing-library/react";
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
    useUiStore.setState({ locale: "en", note: { project: "p", topic: "inbox", at: null } });
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

    expect(screen.queryByLabelText("Note text")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("names the button after what pressing it DOES", async () => {
    // It was labelled with the state it would land in — "Write" while reading, "Read" while
    // writing — which reads as a label for where you ARE, and the second one hid the fact that
    // leaving the editor is what commits the text. "read sollte edit heißen und view ist eigentlich
    // save". Leaving does save (`stopWriting`), so the word is also true.
    renderView();
    await screen.findByText("A note");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Note text")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("gives every block its source range, so a click can say WHERE to write", async () => {
    // What the parser's byte offsets buy: "write, here" instead of "write, now find it".
    const { container } = renderView();
    await screen.findByText("A note");

    const blocks = container.querySelectorAll("[data-md-start]");
    expect(blocks.length).toBeGreaterThan(1);
  });
});

/**
 * The markdown palette — end to end, from the click to the text.
 *
 * `lib/markdownInsert` pins what each construct does to a string, and `MarkdownToolbar` pins that
 * every element has a control. Neither can see the part that actually breaks: whether the view hands
 * the *editor's* selection to the logic and writes the result back. That wiring is the defect class
 * this whole file exists for.
 */
describe("NotesView markdown toolbar", () => {
  beforeEach(() => {
    useUiStore.setState({ locale: "en", note: { project: "p", topic: "inbox", at: null } });
    vi.mocked(notesApi.read).mockResolvedValue("hello\n");
  });

  /** Go to the editor and put the caret where the test wants it. */
  async function write(selection: { start: number; end: number }) {
    renderView();
    await screen.findByText("hello");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const area = await screen.findByLabelText<HTMLTextAreaElement>("Note text");
    area.setSelectionRange(selection.start, selection.end);
    return area;
  }

  it("shows the palette only while writing", async () => {
    renderView();
    await screen.findByText("hello");

    expect(screen.queryByRole("toolbar", { name: "Insert markdown" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("toolbar", { name: "Insert markdown" })).toBeTruthy();
  });

  it("inserts at the caret, not at the end of the note", async () => {
    const area = await write({ start: 0, end: 0 });

    fireEvent.click(screen.getByRole("button", { name: "Task" }));

    expect(area.value).toBe("- [ ] hello\n");
  });

  it("wraps what the user selected", async () => {
    const area = await write({ start: 0, end: 5 });

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    expect(area.value).toBe("**hello**\n");
  });

  it("leaves the caret ready to type, in the editor", async () => {
    // The reason `mousedown` is prevented on every button: if the toolbar takes focus, the user has
    // to click back into the text before typing — which makes "insert at the cursor" a lie.
    const area = await write({ start: 5, end: 5 });

    fireEvent.click(screen.getByRole("button", { name: "Inline code" }));

    expect(area.value).toBe("hello``\n");
    expect(document.activeElement).toBe(area);
    expect(area.selectionStart).toBe(6);
  });
});
