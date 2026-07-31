import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { StatusBarEditor } from "./StatusBarEditor";
import { useUiStore } from "../../store/ui";
import { useTerminalStore } from "../../store/terminal";
import { defaultLayout, makeItem } from "../../lib/statusBar";

vi.mock("../../api/commands", () => ({ api: { buildInfo: vi.fn().mockResolvedValue(null) } }));

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StatusBarEditor />
    </QueryClientProvider>,
  );
}

const ids = () => useUiStore.getState().statusLayout.map((i) => i.id);
const bar = () => screen.getByRole("list", { name: "Your status bar" });
const palette = () => screen.getByRole("group", { name: "Available items" });

/** jsdom has no drag machinery, so the transfer object is supplied by the test. */
function dataTransfer() {
  // A Map rather than a record: an index written from a variable is an object-injection sink as far
  // as the lint is concerned, and a Map has no such path — so the rule stays armed rather than being
  // suppressed here.
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => {
      store.set(k, v);
    },
    getData: (k: string) => store.get(k) ?? "",
    effectAllowed: "",
    dropEffect: "",
    setDragImage: () => {},
  };
}

describe("StatusBarEditor", () => {
  beforeEach(() => {
    useUiStore.setState({ statusLayout: defaultLayout() });
    useTerminalStore.setState({ panes: [], activeKey: null });
  });

  it("shows what is placed, in order", () => {
    renderEditor();
    const placed = within(bar())
      .getAllByRole("listitem")
      .map((el) => el.textContent);
    expect(placed).toHaveLength(5);
    expect(placed[0]).toMatch(/Version/);
    expect(placed[4]).toMatch(/Repository/);
  });

  it("offers only what can still be added", () => {
    renderEditor();
    // Version is already in the bar and is one fact, so offering it again would be a control that
    // does nothing.
    expect(within(palette()).queryByRole("button", { name: /^Add Version/ })).toBeNull();
    expect(within(palette()).getByRole("button", { name: /^Add Directory/ })).toBeInTheDocument();
    // A spacer is always on offer — a bar can want several.
    expect(within(palette()).getByRole("button", { name: /^Add Spacer/ })).toBeInTheDocument();
  });

  it("adds from the palette with a click, at the end", () => {
    renderEditor();
    fireEvent.click(within(palette()).getByRole("button", { name: /^Add Directory/ }));
    expect(ids().at(-1)).toBe("cwd");
  });

  // HTML5 drag-and-drop cannot be operated from a keyboard at all, so an editor that only supports
  // dragging is unusable without a mouse (rule:ui-design). Every gesture below has a key.
  describe("without a mouse", () => {
    it("moves an item left and right with the arrow keys", () => {
      renderEditor();
      const first = within(bar()).getAllByRole("listitem")[0];
      const handle = within(first as HTMLElement).getByRole("button");

      fireEvent.keyDown(handle, { key: "ArrowRight" });
      expect(ids()[0]).toBe("spacer");
      expect(ids()[1]).toBe("version");

      fireEvent.keyDown(
        within(within(bar()).getAllByRole("listitem")[1] as HTMLElement).getByRole("button"),
        { key: "ArrowLeft" },
      );
      expect(ids()[0]).toBe("version");
    });

    it("refuses to move the first item further left, rather than wrapping it to the end", () => {
      renderEditor();
      const handle = within(within(bar()).getAllByRole("listitem")[0] as HTMLElement).getByRole(
        "button",
      );
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      expect(ids()[0]).toBe("version");
    });

    it("removes an item with Backspace and with Delete", () => {
      renderEditor();
      const handle = within(within(bar()).getAllByRole("listitem")[0] as HTMLElement).getByRole(
        "button",
      );
      fireEvent.keyDown(handle, { key: "Backspace" });
      expect(ids()).not.toContain("version");

      fireEvent.keyDown(
        within(within(bar()).getAllByRole("listitem")[0] as HTMLElement).getByRole("button"),
        { key: "Delete" },
      );
      expect(ids()).not.toContain("spacer");
    });

    it("keeps focus on the item that moved, so it can be moved again", () => {
      renderEditor();
      const handle = within(within(bar()).getAllByRole("listitem")[0] as HTMLElement).getByRole(
        "button",
      );
      handle.focus();
      fireEvent.keyDown(handle, { key: "ArrowRight" });

      const moved = within(within(bar()).getAllByRole("listitem")[1] as HTMLElement).getByRole(
        "button",
      );
      expect(document.activeElement).toBe(moved);
    });
  });

  describe("with a mouse", () => {
    it("drops an item onto a new position", () => {
      renderEditor();
      const items = within(bar()).getAllByRole("listitem");
      const transfer = dataTransfer();

      fireEvent.dragStart(items[0] as HTMLElement, { dataTransfer: transfer });
      fireEvent.dragOver(items[2] as HTMLElement, { dataTransfer: transfer });
      fireEvent.drop(items[2] as HTMLElement, { dataTransfer: transfer });

      expect(ids()[0]).toBe("spacer");
      expect(ids()).toContain("version");
      expect(ids()).toHaveLength(5);
    });

    it("drops a palette item into the bar at the position it was dropped on", () => {
      useUiStore.setState({ statusLayout: [makeItem("version"), makeItem("repository")] });
      renderEditor();
      const transfer = dataTransfer();

      fireEvent.dragStart(within(palette()).getByRole("button", { name: /^Add Directory/ }), {
        dataTransfer: transfer,
      });
      const target = within(bar()).getAllByRole("listitem")[1];
      fireEvent.dragOver(target as HTMLElement, { dataTransfer: transfer });
      fireEvent.drop(target as HTMLElement, { dataTransfer: transfer });

      expect(ids()).toEqual(["version", "cwd", "repository"]);
    });

    it("adds at the end when dropped on the empty part of the bar", () => {
      useUiStore.setState({ statusLayout: [makeItem("version")] });
      renderEditor();
      const transfer = dataTransfer();

      fireEvent.dragStart(within(palette()).getByRole("button", { name: /^Add Directory/ }), {
        dataTransfer: transfer,
      });
      fireEvent.dragOver(bar(), { dataTransfer: transfer });
      fireEvent.drop(bar(), { dataTransfer: transfer });

      expect(ids()).toEqual(["version", "cwd"]);
    });

    it("ignores a drop carrying something that is not one of ours", () => {
      // A file dragged in from the desktop, a selection from another window.
      renderEditor();
      const before = ids();
      const transfer = dataTransfer();
      transfer.setData("text/plain", "/etc/passwd");

      fireEvent.drop(bar(), { dataTransfer: transfer });
      expect(ids()).toEqual(before);
    });
  });

  it("puts the defaults back", () => {
    useUiStore.setState({ statusLayout: [makeItem("cwd")] });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(ids()).toEqual(["version", "spacer", "command", "separator", "repository"]);
  });

  it("lets the bar be emptied, and says what that means", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    expect(ids()).toEqual([]);
    expect(within(bar()).getByText(/empty/i)).toBeInTheDocument();
  });

  it("previews the bar as it will look", () => {
    renderEditor();
    expect(screen.getByRole("group", { name: "Preview" })).toBeInTheDocument();
  });
});
