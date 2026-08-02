import type { CSSProperties, KeyboardEvent, MouseEvent, MouseEventHandler, ReactNode } from "react";

/**
 * What counts as "a control of its own" inside a row.
 *
 * Anything a user can activate: the end/rename buttons on a tmux session, a task's checkbox, a `⋮`
 * menu, a link, a field. Everything else — a label, an icon, a badge — is the row.
 */
const CONTROL =
  'button, a, input, select, textarea, [role="button"], [role="menuitem"], [tabindex]';

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
  /**
   * A click on a control INSIDE the row belongs to that control alone.
   *
   * **Why this is here and not at each call site.** Rows carry their own controls — end this
   * session, tick this task, open this row's `⋮` — and they are nested inside the row's button, so
   * every one of those clicks bubbles here as well. That made ending a tmux session *also* attach a
   * tab to the session being killed, which then showed a bare shell with no tmux in it: two actions
   * from one click, and the second one silently wrong. The same trap was live on the task list's
   * checkbox, where ticking navigated to the note.
   *
   * A `stopPropagation` per control would work and would have to be remembered every time anyone
   * adds one — forgotten once, the defect is back and looks like something else entirely. The row is
   * the one place that can decide this, and it decides by ORIGIN: the click activates the row iff it
   * did not come out of something activatable.
   */
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const from = (e.target as Element).closest(CONTROL);
    if (from !== null && from !== e.currentTarget) return;
    onActivate();
  };

  // Enter and Space come free with a real button; this only exists so a row can be activated from a
  // keyboard without the caller wiring it up.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // The same origin rule as the click: Enter on a nested control is that control's key, and it
    // bubbles here exactly like the click does.
    const from = (e.target as Element).closest(CONTROL);
    if (from !== null && from !== e.currentTarget) return;
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
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`hover:bg-elevated focus-visible:outline-gold flex w-full items-baseline gap-1.5 px-1 py-0.5 text-left focus-visible:outline-1 ${
        selected ? "bg-cyan/10" : ""
      } ${className}`.trim()}
    >
      {children}
    </button>
  );
}
