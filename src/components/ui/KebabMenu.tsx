import { MoreVertical } from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";

/**
 * The `⋮` that opens a menu — visible, and opened by a plain click.
 *
 * **A primitive rather than a composition repeated per view**, for two reasons that are both rules
 * rather than taste. `ContextMenu` needs a DOM element as its trigger, because `cloneElement` will
 * attach a handler to a component that quietly drops it; and a native `<button>` is banned outside
 * `src/components/ui` (ADR-APP-026). Those two together mean the trigger can only live here.
 *
 * **Why it exists at all**: the notes tool shipped with its actions on right-click and the first
 * question was "where is the menu?". A hidden affordance is a missing one — right-click is not a
 * gesture anyone tries on a list row they have never seen before.
 */
export function KebabMenu({
  label,
  items,
  size = 12,
}: {
  /** Names the menu for a screen reader — say what it acts on, not "menu". */
  label: string;
  items: ContextMenuEntry[];
  size?: number;
}) {
  return (
    <ContextMenu label={label} items={items} openOnClick>
      <button
        type="button"
        aria-label={label}
        className="text-dim hover:text-fg hover:text-glow-cyan shrink-0 cursor-pointer px-0.5"
      >
        <MoreVertical size={size} aria-hidden />
      </button>
    </ContextMenu>
  );
}
