import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { FocusEvent, MouseEvent, ReactElement, ReactNode } from "react";

interface TooltipProps {
  /** What the tooltip says. Rendered on hover and keyboard focus; nothing shows when `null`. */
  content: ReactNode;
  /** The single trigger element the tooltip describes (e.g. a `Button`/`IconButton`). */
  children: ReactElement;
}

/** Props the tooltip chains onto its trigger — existing handlers are preserved, not overwritten. */
interface TriggerProps {
  onMouseEnter?: (e: MouseEvent<Element>) => void;
  onMouseLeave?: (e: MouseEvent<Element>) => void;
  onFocus?: (e: FocusEvent<Element>) => void;
  onBlur?: (e: FocusEvent<Element>) => void;
  "aria-describedby"?: string;
}

/** How close to the window edge a tooltip may come. Matches the context menu's inset. */
const EDGE = 8;

/** Where the trigger is, so the tooltip can be placed against it and then clamped. */
interface Anchor {
  top: number;
  bottom: number;
  centre: number;
}

/**
 * HUD tooltip (ADR-APP-026): the replacement for the native `title` attribute, whose OS-drawn bubble is a
 * visual break in the HUD. Shows a chamfered popover on hover and on keyboard focus, links it to the
 * trigger via `aria-describedby`, and dismisses on blur, pointer-leave or Escape.
 *
 * Layout-neutral: it clones the single child trigger and attaches handlers rather than wrapping it in
 * a box, so it never disturbs a flex/grid parent. The popover renders through a portal so a parent's
 * `clip-path` can't crop it, and is `pointer-events: none` so it never eats a click.
 *
 * **It is measured and clamped into the window**, the same way the context menu is. Centring on the
 * trigger and hoping is what a tooltip usually does, and it is wrong precisely where tooltips are most
 * needed: on the icon buttons in the top-right corner, where the label ran off the edge of the window
 * and the last words simply could not be read.
 */
export function Tooltip({ content, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>({ top: 0, bottom: 0, centre: 0 });
  // Starts where the trigger is and is corrected on the next layout pass, once the bubble has a
  // width to measure. One frame slightly off beats a tooltip that flashes into place.
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Measure, then correct — and only when the correction actually changes something, so this
  // converges in one pass instead of re-rendering itself. Same shape as the context menu's clamp,
  // which is the primitive this borrows its behaviour from.
  useLayoutEffect(() => {
    if (!open) return;
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const { width, height } = bubble.getBoundingClientRect();

    const maxLeft = Math.max(EDGE, window.innerWidth - width - EDGE);
    const left = Math.min(Math.max(EDGE, anchor.centre - width / 2), maxLeft);
    // Below the trigger by default; above it when there is no room, which is what happens in a short
    // window or on the bottom row of a panel.
    const below = anchor.bottom + 6;
    const top = Math.max(
      EDGE,
      below + height + EDGE > window.innerHeight ? anchor.top - height - 6 : below,
    );

    if (left !== pos.left || top !== pos.top) setPos({ top, left });
  }, [open, anchor, content, pos.left, pos.top]);

  if (!isValidElement(children)) return children;

  const show = (e: MouseEvent<Element> | FocusEvent<Element>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAnchor({ top: r.top, bottom: r.bottom, centre: r.left + r.width / 2 });
    setPos({ top: r.bottom + 6, left: Math.max(EDGE, r.left) });
    setOpen(true);
  };
  const hide = () => setOpen(false);

  const childProps = (children.props ?? {}) as TriggerProps;
  const trigger = cloneElement(children as ReactElement<TriggerProps>, {
    onMouseEnter: (e: MouseEvent<Element>) => {
      childProps.onMouseEnter?.(e);
      show(e);
    },
    onMouseLeave: (e: MouseEvent<Element>) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<Element>) => {
      childProps.onFocus?.(e);
      show(e);
    },
    onBlur: (e: FocusEvent<Element>) => {
      childProps.onBlur?.(e);
      hide();
    },
    "aria-describedby": open ? id : childProps["aria-describedby"],
  });

  return (
    <>
      {trigger}
      {open && content != null
        ? createPortal(
            <div
              ref={bubbleRef}
              role="tooltip"
              id={id}
              className="hud-popover hud-clip-sm hud-accent-cyan text-fg pointer-events-none fixed z-[70] max-w-[240px] px-2 py-1 text-xs whitespace-nowrap"
              style={{ top: pos.top, left: pos.left }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
