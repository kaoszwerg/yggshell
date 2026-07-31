import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Tooltip } from "./Tooltip";

// The pointer path uses React's synthesised mouseenter/leave, which jsdom cannot reliably dispatch,
// so these tests drive the keyboard-focus path — the accessibility-critical one. Both paths share the
// same open/close state, so covering focus proves the behaviour.
describe("Tooltip", () => {
  it("is hidden until the trigger is focused", () => {
    render(
      <Tooltip content="Toggle sort order">
        <button>sort</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(screen.getByRole("button", { name: "sort" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Toggle sort order");
  });

  it("links the tooltip to the trigger via aria-describedby while open", () => {
    render(
      <Tooltip content="hint">
        <button>t</button>
      </Tooltip>,
    );
    const btn = screen.getByRole("button", { name: "t" });
    fireEvent.focus(btn);
    const tip = screen.getByRole("tooltip");
    expect(btn).toHaveAttribute("aria-describedby", tip.id);
  });

  it("hides on blur", () => {
    render(
      <Tooltip content="hint">
        <button>t</button>
      </Tooltip>,
    );
    const btn = screen.getByRole("button", { name: "t" });
    fireEvent.focus(btn);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on Escape", () => {
    render(
      <Tooltip content="hint">
        <button>t</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole("button", { name: "t" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("preserves a handler the trigger already had", () => {
    const onFocus = vi.fn();
    render(
      <Tooltip content="hint">
        <button onFocus={onFocus}>t</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole("button", { name: "t" }));
    expect(onFocus).toHaveBeenCalledOnce();
  });

  // The bug this pins: a tooltip on an icon button in the top-right corner ran off the edge of the
  // window, and its last words could not be read at all.
  describe("staying inside the window", () => {
    /** Give the bubble a real width, which jsdom otherwise reports as 0. */
    function withSize(width: number, height = 24) {
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.getAttribute("role") === "tooltip") {
          return { width, height, top: 0, left: 0, right: width, bottom: height } as DOMRect;
        }
        return original.call(this);
      };
      return () => {
        Element.prototype.getBoundingClientRect = original;
      };
    }

    function showAt(triggerRect: Partial<DOMRect>, bubbleWidth: number) {
      const restore = withSize(bubbleWidth);
      render(
        <Tooltip content="Show side by side">
          <button
            type="button"
            onMouseEnter={() => undefined}
            ref={(el) => {
              if (!el) return;
              el.getBoundingClientRect = () =>
                ({
                  top: 40,
                  bottom: 60,
                  left: 0,
                  right: 0,
                  width: 24,
                  height: 20,
                  ...triggerRect,
                }) as DOMRect;
            }}
          >
            trigger
          </button>
        </Tooltip>,
      );
      fireEvent.mouseEnter(screen.getByRole("button"));
      const bubble = screen.getByRole("tooltip");
      return { bubble, restore };
    }

    it("is pulled back from the right edge instead of overflowing it", () => {
      // A trigger 20px from the right of a 1024px window, with a 200px label.
      const { bubble, restore } = showAt({ left: 990, right: 1014, width: 24 }, 200);
      const left = Number.parseFloat(bubble.style.left);
      expect(left + 200).toBeLessThanOrEqual(window.innerWidth);
      expect(left).toBeGreaterThanOrEqual(0);
      restore();
    });

    it("is pushed off the left edge no further than the right one", () => {
      const { bubble, restore } = showAt({ left: 0, right: 24, width: 24 }, 200);
      expect(Number.parseFloat(bubble.style.left)).toBeGreaterThanOrEqual(0);
      restore();
    });

    it("flips above the trigger when there is no room below", () => {
      const { bubble, restore } = showAt(
        { top: window.innerHeight - 10, bottom: window.innerHeight - 2 },
        120,
      );
      expect(Number.parseFloat(bubble.style.top)).toBeLessThan(window.innerHeight - 10);
      restore();
    });

    it("centres on the trigger when there is room on both sides", () => {
      const { bubble, restore } = showAt({ left: 400, right: 424, width: 24 }, 100);
      // centre 412 − half of 100 = 362
      expect(Number.parseFloat(bubble.style.left)).toBe(362);
      restore();
    });
  });
});
