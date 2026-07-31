import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Splitter } from "./Splitter";

const onChange = vi.fn();

/** jsdom has no pointer capture; the component calls it on every drag. */
beforeEach(() => {
  onChange.mockReset();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

function renderSplitter(props: Partial<React.ComponentProps<typeof Splitter>> = {}) {
  render(
    <Splitter
      label="Panel size"
      value={50}
      min={10}
      max={90}
      onChange={onChange}
      toValue={(pos) => pos}
      {...props}
    />,
  );
  return screen.getByRole("separator", { name: "Panel size" });
}

/** A drag is pointer-down then pointer-move: a move without the button held must be ignored. */
function drag(handle: HTMLElement, to: { clientX?: number; clientY?: number }) {
  fireEvent.pointerDown(handle, { pointerId: 1 });
  fireEvent.pointerMove(handle, { pointerId: 1, ...to });
}

describe("Splitter", () => {
  it("reports its value and bounds to assistive technology", () => {
    const handle = renderSplitter();
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
    expect(handle.getAttribute("aria-valuemin")).toBe("10");
    expect(handle.getAttribute("aria-valuemax")).toBe("90");
    expect(handle.getAttribute("tabindex")).toBe("0");
  });

  it("is vertical by default and reads the horizontal axis", () => {
    const handle = renderSplitter({ toValue: (pos) => pos });
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");

    drag(handle, { clientX: 42, clientY: 999 });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("reads the vertical axis when it is horizontal", () => {
    const handle = renderSplitter({ orientation: "horizontal" });
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");

    drag(handle, { clientX: 999, clientY: 42 });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("ignores a pointer that moves over it without dragging", () => {
    const handle = renderSplitter();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 42 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops following the pointer once it is released", () => {
    const handle = renderSplitter();
    drag(handle, { clientX: 42 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 80 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("clamps what the caller's conversion returns", () => {
    const handle = renderSplitter();
    drag(handle, { clientX: 5000 });
    expect(onChange).toHaveBeenLastCalledWith(90);
    drag(handle, { clientX: -5000 });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it("moves with the arrow keys along the drag axis, not along its own line", () => {
    // A handle dragged left and right answers to Left/Right…
    const handle = renderSplitter();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(58);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(42);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("moves up and down when it is horizontal", () => {
    const handle = renderSplitter({ orientation: "horizontal" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(58);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(42);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("takes a coarse step with Shift, and jumps to the bounds with Home and End", () => {
    const handle = renderSplitter();
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(82);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(10);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(90);
  });
});
