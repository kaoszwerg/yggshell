import type { CSSProperties, KeyboardEvent, MouseEventHandler, ReactNode } from "react";

export interface RowProps {
  /** What activating this row does. */
  onActivate: () => void;
  /** Accessible name. The visible content is usually truncated, so it is rarely the whole story. */
  label: string;
  /** Marks the row the detail view is currently showing. */
  selected?: boolean;
  children: ReactNode;
  className?: string;
  /**
   * Right-click handler, forwarded to the button.
   *
   * **Declared explicitly rather than left to a `...rest` spread**, and that is the point: this
   * component has no spread, so anything not named here is dropped SILENTLY. `ContextMenu` attaches
   * its handler to whatever child it is given, so wrapping a `Row` in one produced a menu that
   * never opened and said nothing about it — the same defect that shipped once already on the tab
   * strip. Naming the prop is what makes losing it a compile error rather than a mystery.
   */
  onContextMenu?: MouseEventHandler<HTMLButtonElement>;
  /**
   * Inline style, for what a class cannot express.
   *
   * Added for the file tree, whose indentation is a *computed* depth — a Tailwind class per possible
   * level is not a thing, and a nested wrapper per level would break the row's own flex layout.
   * Not a licence to style rows individually: the HUD look stays in the class list.
   */
  style?: CSSProperties;
}

/**
 * One activatable row in a list — a changed file, a commit, a file inside a commit.
 *
 * A HUD primitive rather than a `<button>` in the view (ADR-APP-026): a native button brings its own
 * appearance and its own box model, and a list of forty of them is forty stock controls in a panel
 * that is meant to be ours. What it keeps from a button is everything that matters — it is a real
 * `button` element underneath, so it is in the tab order, announced as activatable, and answers to
 * Enter and Space without any of that being re-implemented per list.
 *
 * `aria-current` rather than `aria-selected`: this marks what is being *shown*, and `aria-selected`
 * belongs to a listbox, which this is not.
 */
export function Row({
  onActivate,
  label,
  selected = false,
  children,
  className = "",
  style,
  onContextMenu,
}: RowProps) {
  // Enter and Space come free with a real button; this only exists so a row can be activated from a
  // keyboard without the caller wiring it up.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onActivate();
  };

  return (
    <button
      type="button"
      aria-label={label}
      style={style}
      onContextMenu={onContextMenu}
      aria-current={selected ? "true" : undefined}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      className={`hover:bg-elevated focus-visible:outline-gold flex w-full items-baseline gap-1.5 px-1 py-0.5 text-left focus-visible:outline-1 ${
        selected ? "bg-cyan/10" : ""
      } ${className}`.trim()}
    >
      {children}
    </button>
  );
}
