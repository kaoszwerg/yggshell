import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { hudButtonClass } from "./hudButton";
import { IconButton } from "./IconButton";

/** One tab. `id` is the identity handed back to every callback; `label` is what the user reads.
 * Not exported yet — nothing consumes it, and the unused-export check is a gate, not a suggestion
 * (rule:code-quality). It gets its `export` in the same change as the first caller that needs to
 * name the type; until then `TabsProps["items"]` says the same thing. */
interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  /** Accessible name of the tab list — required, because a page may hold more than one. */
  label: string;
  items: TabItem[];
  /** The selected tab's id. `Tabs` is controlled: it renders this, it never keeps its own. */
  activeId: string;
  onSelect: (id: string) => void;
  /** Omit to render no close control at all. */
  onClose?: (id: string) => void;
  /** Omit to render no add control at all. */
  onAdd?: () => void;
  /**
   * Middle-click on a tab. Left to the caller because there is no one right answer: a browser closes,
   * a terminal pastes. Nothing happens when it is omitted.
   */
  onMiddleClick?: (id: string) => void;
  /** Accessible name of the add control. */
  addLabel?: string;
  /** Ties each tab to the panel it controls, when the caller renders panels with known ids. */
  getPanelId?: (id: string) => string;
  className?: string;
}

/** Keys that move the selection, and by how much. Arrow keys step; Home/End jump to an end. */
const STEP = { ArrowRight: 1, ArrowLeft: -1 } as const;

/**
 * HUD tab strip (ADR-APP-020, ADR-APP-026) — the primitive behind the terminal's tabs, which live in
 * the title bar (ADR-PROJ-001) and must therefore stay narrow and scroll rather than wrap.
 *
 * Follows the WAI-ARIA tabs pattern with automatic activation: arrow keys move the selection (and the
 * focus with it), Home/End jump to the ends, Delete closes. Only the selected tab is tabbable, so the
 * strip costs one Tab stop no matter how many terminals are open.
 *
 * Middle-click is deliberately NOT bound to close here. In a browser that is the convention; in a
 * terminal, middle-click means paste, everywhere, and one gesture meaning two opposite things inside
 * the same window is how a user loses work. The caller says what it does.
 *
 * The close control is a sibling of the tab, never nested inside it — a button inside a button is
 * invalid, and it would swallow the tab's own click. Closing a background tab therefore closes it
 * *without* selecting it, which is what every tab strip does and what a user expects when they aim
 * for the ×.
 */
export function Tabs({
  label,
  items,
  activeId,
  onSelect,
  onClose,
  onAdd,
  onMiddleClick,
  addLabel = "New tab",
  getPanelId,
  className = "",
}: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  // Keyboard selection must carry the focus with it, or the next arrow key is delivered to the tab
  // the user left behind. Only when focus is already inside the strip: a selection changed from
  // elsewhere (a command, a new session) must not yank focus out of whatever the user is typing in.
  useEffect(() => {
    const el = tabRefs.current.get(activeId);
    const root = listRef.current;
    if (!el || !root || !root.contains(document.activeElement)) return;
    if (document.activeElement !== el) el.focus();
  }, [activeId]);

  const select = (id: string | undefined) => {
    if (id !== undefined) onSelect(id);
  };

  // On the tabs themselves, not on the list: the list is not focusable, so a key handler there would
  // only ever fire by bubbling — and jsx-a11y rightly rejects an interactive container nobody can
  // reach with a keyboard. The roving tabindex means exactly one tab is focusable at a time.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (items.length === 0) return;
    const index = items.findIndex((i) => i.id === activeId);

    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? STEP.ArrowRight : STEP.ArrowLeft;
      select(items.at((index + step + items.length) % items.length)?.id);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      select(items.at(0)?.id);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      select(items.at(-1)?.id);
      return;
    }
    if (e.key === "Delete" && onClose) {
      e.preventDefault();
      onClose(activeId);
    }
  };

  /** Middle-click is the caller's to define; right-click is left alone so a context menu wrapped
   *  around the strip still receives it. */
  const onAuxClick = (e: MouseEvent<HTMLButtonElement>, id: string) => {
    if (e.button !== 1 || !onMiddleClick) return;
    e.preventDefault();
    onMiddleClick(id);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={`no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto ${className}`.trim()}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <div
            key={item.id}
            role="presentation"
            className={`${hudButtonClass({ active })} flex max-w-[13rem] shrink-0 items-center`}
          >
            <button
              type="button"
              role="tab"
              ref={(el) => {
                if (el) tabRefs.current.set(item.id, el);
                else tabRefs.current.delete(item.id);
              }}
              aria-selected={active}
              aria-controls={getPanelId?.(item.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(item.id)}
              onAuxClick={(e) => onAuxClick(e, item.id)}
              onKeyDown={onKeyDown}
              className="truncate px-2 py-0.5 font-mono text-xs"
            >
              {item.label}
            </button>
            {onClose ? (
              <IconButton
                label={`Close ${item.label}`}
                variant="ghost"
                accent="danger"
                tooltip={null}
                tabIndex={-1}
                onClick={() => onClose(item.id)}
                className="mr-1 h-4 w-4 shrink-0 opacity-70 hover:opacity-100"
              >
                <X size={11} strokeWidth={2.5} />
              </IconButton>
            ) : null}
          </div>
        );
      })}

      {onAdd ? (
        <IconButton label={addLabel} variant="ghost" onClick={onAdd} className="h-5 w-5 shrink-0">
          <Plus size={13} strokeWidth={2.5} />
        </IconButton>
      ) : null}
    </div>
  );
}
