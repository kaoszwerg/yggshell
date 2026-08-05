import { ChevronDown } from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";

/**
 * A menu whose trigger **says what is currently chosen**.
 *
 * **Why this exists beside `KebabMenu`.** A `⋮` is the right trigger for *actions on a thing you can
 * already see* — a row, a file. It is the wrong one for a **scope**, because the scope is not on
 * screen anywhere else: the notes tool named its project only in the kebab's `aria-label`, so the
 * one way to find out which project you were filing into was to open the menu and look. Reported
 * exactly that way: *"es ist schwer zu erkennen in welchem Notes bereich man sich befindet"*.
 *
 * So the label is the control. What you are in is the thing you press to change it — the pattern a
 * branch picker or a workspace switcher uses everywhere, and it removes the question rather than
 * answering it.
 *
 * It lives here for the same two reasons `KebabMenu` does: `ContextMenu` attaches its handler to a
 * real DOM element, and a native `<button>` is banned outside `src/components/ui` (ADR-APP-026).
 */
export function MenuButton({
  label,
  text,
  items,
}: {
  /** Names the menu for a screen reader — say what it chooses, not "menu". */
  label: string;
  /** What is chosen right now. This is the visible part, and the point of the component. */
  text: string;
  items: ContextMenuEntry[];
}) {
  return (
    <ContextMenu label={label} items={items} openOnClick>
      <button
        type="button"
        // **The long form lives here**, because it cannot live in a tooltip: `Tooltip` and
        // `ContextMenu` both attach their handlers by cloning their child, so whichever wraps the
        // other is cloning a *component* and its handlers are dropped without a word — the same trap
        // `KebabMenu` documents, met from the other side. So the visible text may be shortened and
        // the accessible name carries the whole of it; the menu below lists the full names anyway.
        aria-label={label}
        // `text-fg` and not `text-dim`: this is the answer to "where am I", so it has to win against
        // the headings under it rather than blend into them. Chrome, so a fixed size is right
        // (rule:content-size) — it is interface, not the content the user sized.
        className="text-fg hover:text-glow-cyan flex min-w-0 cursor-pointer items-center gap-1 text-xs font-medium"
      >
        <span className="truncate">{text}</span>
        <ChevronDown size={11} className="text-dim shrink-0" aria-hidden />
      </button>
    </ContextMenu>
  );
}
