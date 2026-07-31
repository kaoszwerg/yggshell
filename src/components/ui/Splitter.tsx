import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

/** Which way the splitter's own line runs — and therefore which axis the drag reads. */
type SplitterOrientation = "vertical" | "horizontal";

export interface SplitterProps {
  /** Accessible name — what the drag actually resizes. */
  label: string;
  /**
   * How the splitter's line is drawn: `vertical` separates panes side by side and is dragged left
   * and right; `horizontal` separates panes stacked above each other and is dragged up and down.
   *
   * This is the `aria-orientation` of the separator itself, which is the axis of the *line* and not
   * of the movement — the two are perpendicular, and getting them the wrong way round is the classic
   * mistake here.
   */
  orientation?: SplitterOrientation;
  /** Current value, in whatever unit the caller reports (pixels, percent — it is only ever compared
   *  against `min`/`max` and announced). */
  value: number;
  min: number;
  max: number;
  /** Called with the new value, already clamped to `[min, max]`. */
  onChange: (value: number) => void;
  /**
   * Turn a pointer position on the drag axis (`clientX` when vertical, `clientY` when horizontal)
   * into the value this splitter reports.
   *
   * The caller does this rather than the splitter because only the caller knows what the number
   * means: a pane width in pixels, a share of a container's height. Handing it a screen coordinate
   * and hoping is how a splitter ends up drifting when the window moves.
   */
  toValue: (clientPosition: number) => number;
  className?: string;
}

/** Keyboard step, and the coarse step Shift gives. */
const STEP = 8;
const COARSE_STEP = 32;

/**
 * Drag handle between two panes (ADR-APP-026 — a control the user touches is a HUD primitive, never a
 * bare `<div onMouseDown>`).
 *
 * Reachable with a keyboard, which is the part these usually get wrong: it is a `separator` with a
 * value, focusable, and the arrow keys move it (Shift for a coarse step). A drag handle nobody can
 * operate without a mouse is not a control, it is a decoration that happens to work for some people.
 *
 * Visually a 2px line inside a 6px grab strip — the same trade the scrollbars make: it paints thin
 * and stays hittable.
 */
export function Splitter({
  label,
  orientation = "vertical",
  value,
  min,
  max,
  onChange,
  toValue,
  className = "",
}: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);
  const horizontal = orientation === "horizontal";

  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    setDragging(true);
    handleRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onChange(clamp(toValue(horizontal ? e.clientY : e.clientX)));
  };

  const stopDragging = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    handleRef.current?.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? COARSE_STEP : STEP;
    // The keys follow the drag axis, not the line: a handle you drag up and down must answer to
    // ArrowUp and ArrowDown, or the keyboard path is a different control from the mouse one.
    const back = horizontal ? "ArrowUp" : "ArrowLeft";
    const forward = horizontal ? "ArrowDown" : "ArrowRight";
    if (e.key === back) {
      e.preventDefault();
      onChange(clamp(value - step));
    }
    if (e.key === forward) {
      e.preventDefault();
      onChange(clamp(value + step));
    }
    if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
    }
    if (e.key === "End") {
      e.preventDefault();
      onChange(max);
    }
  };

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={onKeyDown}
      className={`group relative shrink-0 focus-visible:outline-none ${
        horizontal ? "h-1.5 cursor-row-resize" : "w-1.5 cursor-col-resize"
      } ${className}`.trim()}
    >
      <span
        aria-hidden
        className={`absolute transition-colors ${
          horizontal ? "inset-x-0 top-0.5 h-0.5" : "inset-y-0 left-0.5 w-0.5"
        } ${dragging ? "bg-cyan" : "bg-cyan/25 group-hover:bg-cyan group-focus-visible:bg-gold"}`}
      />
    </div>
  );
}
