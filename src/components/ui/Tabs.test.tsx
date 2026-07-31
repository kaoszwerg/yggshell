import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Tabs } from "./Tabs";

/** `fireEvent` has no `auxClick` shorthand, so the DOM event is built by hand. React delegates
 *  `onAuxClick` from the root container, hence `bubbles`. */
const aux = (button: number) =>
  new MouseEvent("auxclick", { bubbles: true, cancelable: true, button });

const items = [
  { id: "a", label: "zsh" },
  { id: "b", label: "cargo watch" },
  { id: "c", label: "claude" },
];

describe("Tabs", () => {
  it("exposes a named tablist with one tab per item", () => {
    render(<Tabs label="Terminals" items={items} activeId="a" onSelect={vi.fn()} />);

    expect(screen.getByRole("tablist", { name: "Terminals" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "cargo watch" })).toBeInTheDocument();
  });

  it("marks the active tab selected and makes only it tabbable", () => {
    render(<Tabs label="Terminals" items={items} activeId="b" onSelect={vi.fn()} />);

    const active = screen.getByRole("tab", { name: "cargo watch" });
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(active).toHaveAttribute("tabindex", "0");

    const inactive = screen.getByRole("tab", { name: "zsh" });
    expect(inactive).toHaveAttribute("aria-selected", "false");
    expect(inactive).toHaveAttribute("tabindex", "-1");
  });

  it("selects on click", () => {
    const onSelect = vi.fn();
    render(<Tabs label="Terminals" items={items} activeId="a" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("tab", { name: "claude" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("moves with the arrow keys and wraps at both ends", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <Tabs label="Terminals" items={items} activeId="a" onSelect={onSelect} />,
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "zsh" }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("b");

    onSelect.mockClear();
    rerender(<Tabs label="Terminals" items={items} activeId="a" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "zsh" }), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("jumps to the first and last tab with Home and End", () => {
    const onSelect = vi.fn();
    render(<Tabs label="Terminals" items={items} activeId="b" onSelect={onSelect} />);
    const active = screen.getByRole("tab", { name: "cargo watch" });

    fireEvent.keyDown(active, { key: "Home" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("a");

    onSelect.mockClear();
    fireEvent.keyDown(active, { key: "End" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("renders no close control unless onClose is given", () => {
    render(<Tabs label="Terminals" items={items} activeId="a" onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("closes a tab without selecting it", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <Tabs label="Terminals" items={items} activeId="a" onSelect={onSelect} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close claude" }));
    expect(onClose).toHaveBeenCalledExactlyOnceWith("c");
    // Closing is not selecting — clicking the × of a background tab must not switch to it.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hands a middle-click to the caller instead of closing", () => {
    // A browser closes on middle-click; a terminal pastes. One gesture must not mean two opposite
    // things inside the same window, so the primitive decides nothing.
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const onMiddleClick = vi.fn();
    render(
      <Tabs
        label="Terminals"
        items={items}
        activeId="a"
        onSelect={onSelect}
        onClose={onClose}
        onMiddleClick={onMiddleClick}
      />,
    );

    fireEvent(screen.getByRole("tab", { name: "cargo watch" }), aux(1));
    expect(onMiddleClick).toHaveBeenCalledExactlyOnceWith("b");
    expect(onClose).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does nothing on middle-click when the caller gave it no meaning", () => {
    const onClose = vi.fn();
    render(
      <Tabs label="Terminals" items={items} activeId="a" onSelect={vi.fn()} onClose={onClose} />,
    );

    fireEvent(screen.getByRole("tab", { name: "cargo watch" }), aux(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a right-click so the context menu still reaches the tab", () => {
    const onMiddleClick = vi.fn();
    render(
      <Tabs
        label="Terminals"
        items={items}
        activeId="a"
        onSelect={vi.fn()}
        onMiddleClick={onMiddleClick}
      />,
    );

    fireEvent(screen.getByRole("tab", { name: "cargo watch" }), aux(2));
    expect(onMiddleClick).not.toHaveBeenCalled();
  });

  it("closes the active tab on Delete", () => {
    const onClose = vi.fn();
    render(
      <Tabs label="Terminals" items={items} activeId="b" onSelect={vi.fn()} onClose={onClose} />,
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "cargo watch" }), { key: "Delete" });
    expect(onClose).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("renders the add control only when onAdd is given", () => {
    const onAdd = vi.fn();
    const { rerender } = render(
      <Tabs label="Terminals" items={items} activeId="a" onSelect={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "New terminal" })).toBeNull();

    rerender(
      <Tabs
        label="Terminals"
        items={items}
        activeId="a"
        onSelect={vi.fn()}
        onAdd={onAdd}
        addLabel="New terminal"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("links each tab to its panel when getPanelId is given", () => {
    render(
      <Tabs
        label="Terminals"
        items={items}
        activeId="a"
        onSelect={vi.fn()}
        getPanelId={(id) => `term-panel-${id}`}
      />,
    );

    expect(screen.getByRole("tab", { name: "zsh" })).toHaveAttribute(
      "aria-controls",
      "term-panel-a",
    );
  });

  it("renders nothing but the add control when there are no tabs", () => {
    render(<Tabs label="Terminals" items={[]} activeId="" onSelect={vi.fn()} onAdd={vi.fn()} />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "New tab" })).toBeInTheDocument();
  });
});
