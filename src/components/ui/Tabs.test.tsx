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

/**
 * jsdom has no layout: `scrollWidth`, `clientWidth` and `scrollLeft` are all 0 unless a test says
 * otherwise. These define them so the overflow logic can be exercised at all — without this the
 * arrows would simply never appear, and every assertion below would pass for the wrong reason.
 */
function withScroll(el: Element, { scrollLeft = 0, clientWidth = 400, scrollWidth = 1200 } = {}) {
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(el, "scrollLeft", {
    value: scrollLeft,
    writable: true,
    configurable: true,
  });
}

describe("reaching tabs that do not fit", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }));

  it("shows no arrows when everything fits", () => {
    render(
      <Tabs
        label="Terminals"
        items={[{ id: "a", label: "One" }]}
        activeId="a"
        onSelect={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Scroll tabs left" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scroll tabs right" })).toBeNull();
  });

  it("offers a forward arrow when there is more to the right", async () => {
    const { rerender } = render(
      <Tabs label="Terminals" items={many} activeId="t0" onSelect={() => {}} />,
    );
    withScroll(screen.getByRole("tablist"), { scrollLeft: 0 });
    fireEvent.scroll(screen.getByRole("tablist"));
    rerender(<Tabs label="Terminals" items={many} activeId="t0" onSelect={() => {}} />);

    expect(await screen.findByRole("button", { name: "Scroll tabs right" })).toBeInTheDocument();
    // Nothing to the left yet — an arrow that does nothing is worse than no arrow.
    expect(screen.queryByRole("button", { name: "Scroll tabs left" })).toBeNull();
  });

  it("offers a back arrow once something has scrolled off the left", async () => {
    render(<Tabs label="Terminals" items={many} activeId="t0" onSelect={() => {}} />);
    withScroll(screen.getByRole("tablist"), { scrollLeft: 300 });
    fireEvent.scroll(screen.getByRole("tablist"));

    expect(await screen.findByRole("button", { name: "Scroll tabs left" })).toBeInTheDocument();
  });

  it("scrolls the strip when an arrow is pressed", async () => {
    render(<Tabs label="Terminals" items={many} activeId="t0" onSelect={() => {}} />);
    const list = screen.getByRole("tablist");
    withScroll(list, { scrollLeft: 0 });
    const scrollBy = vi.fn();
    list.scrollBy = scrollBy;
    fireEvent.scroll(list);

    fireEvent.click(await screen.findByRole("button", { name: "Scroll tabs right" }));

    expect(scrollBy).toHaveBeenCalled();
    expect(scrollBy.mock.calls[0]?.[0]).toMatchObject({ behavior: "smooth" });
    expect(scrollBy.mock.calls[0]?.[0].left).toBeGreaterThan(0);
  });

  it("keeps the arrows outside the scrolling element", async () => {
    // Inside it they would scroll away with the tabs, which is the one place a scroll control must
    // never be.
    render(<Tabs label="Terminals" items={many} activeId="t0" onSelect={() => {}} />);
    withScroll(screen.getByRole("tablist"), { scrollLeft: 300 });
    fireEvent.scroll(screen.getByRole("tablist"));

    const back = await screen.findByRole("button", { name: "Scroll tabs left" });
    expect(screen.getByRole("tablist").contains(back)).toBe(false);
  });

  it("scrolls with a vertical wheel, which is what a mouse has", () => {
    // A horizontal strip ignores deltaY by default: a trackpad could reach the far tabs and a mouse
    // could not.
    render(<Tabs label="Terminals" items={many} activeId="t0" onSelect={() => {}} />);
    const list = screen.getByRole("tablist");
    withScroll(list, { scrollLeft: 0 });

    fireEvent.wheel(list, { deltaY: 120, deltaX: 0 });

    expect(list.scrollLeft).toBe(120);
  });

  it("leaves a horizontal wheel alone, so a trackpad still works normally", () => {
    render(<Tabs label="Terminals" items={many} activeId="t0" onSelect={() => {}} />);
    const list = screen.getByRole("tablist");
    withScroll(list, { scrollLeft: 50 });

    fireEvent.wheel(list, { deltaY: 0, deltaX: 30 });

    expect(list.scrollLeft).toBe(50);
  });
});

describe("a strip with more tabs than fit", () => {
  it("brings the selected tab into view, whoever selected it", () => {
    // ⌘3 or a terminal opened by `ygg` can pick a tab that is scrolled out of sight, and a selection
    // you cannot see reads as nothing having happened.
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;

    const items = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }));
    const { rerender } = render(
      <Tabs label="Terminals" items={items} activeId="t0" onSelect={() => {}} />,
    );
    into.mockClear();

    rerender(<Tabs label="Terminals" items={items} activeId="t7" onSelect={() => {}} />);

    expect(into).toHaveBeenCalled();
    // `nearest`: a tab already visible must stay exactly where it is, or the strip lurches under a
    // selection made with the mouse.
    expect(into.mock.calls[0]?.[0]).toMatchObject({ inline: "nearest" });
  });

  it("lets a tab shrink rather than overflowing the strip mid-tab", () => {
    // The reported symptom: the strip's edge fell in the middle of a tab, which reads as a rendering
    // fault rather than as "there is more over there".
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      label: `A long tab title ${i}`,
    }));
    render(<Tabs label="Terminals" items={items} activeId="t0" onSelect={() => {}} />);

    const tab = screen.getByRole("tab", { name: "A long tab title 3" }).parentElement;
    expect(tab?.className).toContain("shrink");
    expect(tab?.className).not.toContain("shrink-0");
    expect(tab?.className).toContain("min-w-");
  });

  it("comes to rest on a tab boundary when it does scroll", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }));
    render(<Tabs label="Terminals" items={items} activeId="t0" onSelect={() => {}} />);

    expect(screen.getByRole("tablist").className).toContain("snap-x");
    expect(screen.getByRole("tab", { name: "Tab 3" }).parentElement?.className).toContain(
      "snap-start",
    );
  });
});

it("marks a tab that is asking for attention, without out-shouting the selected one", () => {
  // The bell says "something happened here" and nothing more. A dot rather than a recolouring: the
  // selected tab has to stay the loudest thing in the strip, and a tab that changes colour competes
  // with it.
  render(
    <Tabs
      label="Terminals"
      items={[
        { id: "a", label: "one" },
        { id: "b", label: "two", attention: true },
      ]}
      activeId="a"
      onSelect={vi.fn()}
    />,
  );

  expect(screen.getByTestId("tab-attention-b")).toBeInTheDocument();
  expect(screen.queryByTestId("tab-attention-a")).toBeNull();
});
