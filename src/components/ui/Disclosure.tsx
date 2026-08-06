import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface DisclosureProps {
  /** What is always visible, and what the control is labelled by. */
  summary: ReactNode;
  /** What appears when it is opened. */
  children: ReactNode;
  /** Open on first render. */
  defaultOpen?: boolean;
  /** Applied to the wrapper. */
  className?: string;
  /** Applied to the clickable summary row. */
  summaryClassName?: string;
  /** Applied to the revealed region. */
  contentClassName?: string;
  /** For a screen reader, when the visible summary is not a sentence. */
  label?: string;
}

/**
 * A show/hide control in the HUD design system (ADR-APP-026).
 *
 * **Why this exists instead of `<details>`.** A disclosure is an interactive control a view touches,
 * so it has to be a primitive — and the native element is not one that can be brought into line:
 * styling it means removing its marker, rebuilding its focus ring, and fighting a browser default
 * per platform. That is exactly the "you fight its skin instead of drawing the HUD" the rule names.
 * The lint gate names `details`/`summary` for the same reason it names `button`.
 *
 * The mechanics that a native element would have given for free, done properly instead:
 * `aria-expanded` on the control, `aria-controls` pointing at the region it reveals, and the region
 * removed from the tree when closed rather than merely hidden — so a screen reader and a `Ctrl+F`
 * agree with what is on screen.
 *
 * The chevron rotates rather than swapping glyphs: one element, no layout shift, and it respects
 * `prefers-reduced-motion` through the global rule in `globals.css`.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className = "",
  summaryClassName = "",
  contentClassName = "",
  label,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={label}
        onClick={() => setOpen((was) => !was)}
        className={`flex w-full items-baseline gap-[0.4em] text-left ${summaryClassName}`}
      >
        <ChevronRight
          size="0.9em"
          aria-hidden
          className={`text-dim shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {summary}
      </button>
      {open ? (
        <div id={regionId} className={contentClassName}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
