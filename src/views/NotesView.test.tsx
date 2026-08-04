import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/**
 * How wide jsdom should claim the panes are.
 *
 * The split is offered only where there is room for it, and that is *measured* — so a test that
 * wants the split has to say the window is big enough. jsdom reports every width as 0.
 */
function width(px: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: px });
}

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
    useUiStore.setState({
      locale: "en",
      note: { project: "p", topic: "inbox", at: null },
      notesLens: "read",
      notesFollow: true,
    });
    useTerminalStore.setState({ panes: [], activeKey: null });
    vi.mocked(notesApi.read).mockResolvedValue("# A note\n\n- [ ] something\n");
    vi.mocked(notesApi.write).mockResolvedValue(undefined);
    width(900);
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

  it("opens on a fresh install READING, never in an editor", async () => {
    // Reading is what opening a note is for, and it is never accidentally editable.
    renderView();
    await screen.findByText("A note");

    expect(screen.queryByLabelText("Note text")).toBeNull();
    expect(screen.getByRole("button", { name: "Read" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("offers three lenses and says which one you are in", async () => {
    // A segmented control, not a toggle labelled with its own opposite: each option names the state
    // it puts you in, and the current one is pressed. The earlier single button hid the fact that
    // leaving the editor is what commits ("read sollte edit heißen und view ist eigentlich save") —
    // three named options cannot.
    renderView();
    await screen.findByText("A note");

    fireEvent.click(screen.getByRole("button", { name: "Write" }));

    expect(screen.getByLabelText("Note text")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("A note")).toBeNull();
  });

  it("shows the source and the rendering at once in the split", async () => {
    // The thing the whole feature is: neither half pretending to be the other.
    renderView();
    await screen.findByText("A note");

    fireEvent.click(screen.getByRole("button", { name: "Split" }));

    expect(screen.getByLabelText("Note text")).toBeTruthy();
    expect(screen.getByText("A note")).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Editor and preview" })).toBeTruthy();
  });

  it("offers the follow switch only where it can do anything", async () => {
    // A control that is on screen while it does nothing is one the user tries once and stops
    // believing.
    renderView();
    await screen.findByText("A note");
    const follow = "Keep both sides pointed at the same place";

    expect(screen.queryByRole("button", { name: follow })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Split" }));

    expect(screen.getByRole("button", { name: follow }).getAttribute("aria-pressed")).toBe("true");
  });

  it("commits the text when the lens goes back to reading", async () => {
    // The debounce is 600ms; leaving must not depend on it. This is what the old toggle had to be
    // named "save" to convey, and the reason a lens change is not a pure display switch.
    renderView();
    await screen.findByText("A note");

    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    fireEvent.change(screen.getByLabelText("Note text"), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Read" }));

    await waitFor(() => {
      expect(vi.mocked(notesApi.write)).toHaveBeenCalledWith("p", "inbox", "changed");
    });
  });

  it("does not ask the backend to read an image that names no file", async () => {
    // `![]()` is exactly what the toolbar's Image button writes, so a half-finished note is the
    // ordinary case. Asking for `""` resolves to the project DIRECTORY in the backend: found in a
    // running build as `io error at : Is a directory (os error 21)`, once a second, with an empty
    // path in the message that named nothing.
    vi.mocked(notesApi.read).mockResolvedValue("text\n\n![a picture]()\n");
    renderView();
    await screen.findByText("a picture");

    expect(vi.mocked(notesApi.readImage)).not.toHaveBeenCalled();
  });

  it("refuses the split in a window with no room for it", async () => {
    // Measured, not assumed: this view fills the window and the window is the user's. Offering a
    // split that cannot be used is worse than not offering it — the control would appear inert.
    width(400);
    renderView();
    await screen.findByText("A note");

    expect(screen.getByRole("button", { name: "Split" }).hasAttribute("disabled")).toBe(true);
  });

  it("falls back to the editor, not to reading, when a stored split will not fit", async () => {
    // The user asked to write. Dropping them into reading because the window shrank takes the thing
    // they were doing away from them.
    width(400);
    useUiStore.setState({ notesLens: "split" });
    renderView();

    expect(await screen.findByLabelText("Note text")).toBeTruthy();
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
    useUiStore.setState({
      locale: "en",
      note: { project: "p", topic: "inbox", at: null },
      notesLens: "read",
    });
    vi.mocked(notesApi.read).mockResolvedValue("hello\n");
    vi.mocked(notesApi.write).mockResolvedValue(undefined);
    width(900);
  });

  /** Go to the editor and put the caret where the test wants it. */
  async function write(selection: { start: number; end: number }) {
    renderView();
    await screen.findByText("hello");
    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    const area = await screen.findByLabelText<HTMLTextAreaElement>("Note text");
    area.setSelectionRange(selection.start, selection.end);
    return area;
  }

  it("shows the palette only while writing", async () => {
    renderView();
    await screen.findByText("hello");

    expect(screen.queryByRole("toolbar", { name: "Insert markdown" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Write" }));

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
