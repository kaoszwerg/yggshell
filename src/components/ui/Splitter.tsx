import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

export interface SplitterProps {
  /** Accessible name — what the drag actually resizes. */
  label: string;
  /** Current size of the pane on the splitter's left, in pixels. */
  value: number;
  min: number;
  max: number;
  /** Called with the new size, already clamped. */
  onChange: (value: number) => void;
  /** Where the measurement starts — the left edge of the pane being resized. */
  originX: () => number;
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
  value,
  min,
  max,
  onChange,
  originX,
  className = "",
}: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);

  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    setDragging(true);
    handleRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onChange(clamp(e.clientX - originX()));
  };

  const stopDragging = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    handleRef.current?.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? COARSE_STEP : STEP;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(clamp(value - step));
    }
    if (e.key === "ArrowRight") {
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
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={onKeyDown}
      className={`group relative w-1.5 shrink-0 cursor-col-resize focus-visible:outline-none ${className}`.trim()}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0.5 w-0.5 transition-colors ${
          dragging ? "bg-cyan" : "bg-cyan/25 group-hover:bg-cyan group-focus-visible:bg-gold"
        }`}
      />
    </div>
  );
}
