import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

const open = (name = "terminal") =>
  fireEvent.contextMenu(screen.getByTestId(name), { clientX: 120, clientY: 80 });

function entries(overrides: Partial<Record<"copy" | "paste" | "close", () => void>> = {}) {
  return [
    { id: "copy", label: "Copy", onSelect: overrides.copy ?? vi.fn() },
    { id: "paste", label: "Paste", onSelect: overrides.paste ?? vi.fn(), disabled: true },
    { separator: true as const },
    {
      id: "close",
      label: "Close terminal",
      onSelect: overrides.close ?? vi.fn(),
      accent: "danger" as const,
    },
  ];
}

function Subject({ items }: { items: ReturnType<typeof entries> }) {
  return (
    <ContextMenu label="Terminal actions" items={items}>
      <div data-testid="terminal">output</div>
    </ContextMenu>
  );
}

describe("ContextMenu", () => {
  it("stays closed until the trigger is right-clicked", () => {
    render(<Subject items={entries()} />);
    expect(screen.queryByRole("menu")).toBeNull();

    open();
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument();
  });

  it("suppresses the native menu", () => {
    render(<Subject items={entries()} />);
    const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(screen.getByTestId("terminal"), evt);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("renders one menuitem per entry and a separator between groups", () => {
    render(<Subject items={entries()} />);
    open();

    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Close terminal" })).toBeInTheDocument();
  });

  it("opens at the pointer", () => {
    render(<Subject items={entries()} />);
    open();

    const menu = screen.getByRole("menu");
    expect(menu).toHaveStyle({ left: "120px", top: "80px" });
  });

  it("runs the item and closes on click", () => {
    const copy = vi.fn();
    render(<Subject items={entries({ copy })} />);
    open();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(copy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not run a disabled item", () => {
    const paste = vi.fn();
    render(<Subject items={entries({ paste })} />);
    open();

    const item = screen.getByRole("menuitem", { name: "Paste" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(paste).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("focuses the first enabled item on open", () => {
    render(<Subject items={entries()} />);
    open();
    expect(screen.getByRole("menuitem", { name: "Copy" })).toHaveFocus();
  });

  it("skips disabled items with the arrow keys and wraps around", () => {
    render(<Subject items={entries()} />);
    open();

    const copy = screen.getByRole("menuitem", { name: "Copy" });
    fireEvent.keyDown(copy, { key: "ArrowDown" });
    // "Paste" is disabled, so the next stop is "Close terminal".
    expect(screen.getByRole("menuitem", { name: "Close terminal" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Close terminal" }), {
      key: "ArrowDown",
    });
    expect(copy).toHaveFocus();
  });

  it("runs the focused item on Enter", () => {
    const close = vi.fn();
    render(<Subject items={entries({ close })} />);
    open();

    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Copy" }), { key: "End" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Close terminal" }), { key: "Enter" });
    expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    render(
      <ContextMenu label="Terminal actions" items={entries()}>
        <button data-testid="terminal">output</button>
      </ContextMenu>,
    );
    open();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("terminal")).toHaveFocus();
  });

  it("closes when something outside is pressed", () => {
    render(<Subject items={entries()} />);
    open();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps a handler the trigger already had", () => {
    const onContextMenu = vi.fn();
    render(
      <ContextMenu label="Terminal actions" items={entries()}>
        <div data-testid="terminal" onContextMenu={onContextMenu}>
          output
        </div>
      </ContextMenu>,
    );

    open();
    expect(onContextMenu).toHaveBeenCalledOnce();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("renders no menu at all when every entry is filtered away", () => {
    render(<Subject items={[]} />);
    open();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
