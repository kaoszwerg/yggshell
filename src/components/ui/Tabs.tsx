import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
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
  /** Accessible names for the scroll arrows. Supplied by the caller, because they are user text. */
  scrollBackLabel?: string;
  scrollForwardLabel?: string;
  /**
   * `horizontal` (default) is a strip; `vertical` is a column, for a settings pane whose sections
   * sit down the left-hand side. Only the axis changes — the ARIA pattern, the roving tabindex and
   * the callbacks are the same, which is the whole reason this is one primitive and not two.
   */
  orientation?: "horizontal" | "vertical";
  /** Ties each tab to the panel it controls, when the caller renders panels with known ids. */
  getPanelId?: (id: string) => string;
  className?: string;
}

/** The two arrow keys that step along the strip, per axis (WAI-ARIA: a vertical tab list is driven
 *  by Up/Down, a horizontal one by Left/Right). Home/End jump on both. */
const ARROWS = {
  horizontal: { back: "ArrowLeft", forward: "ArrowRight" },
  vertical: { back: "ArrowUp", forward: "ArrowDown" },
} as const;

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
  scrollBackLabel = "Scroll tabs left",
  scrollForwardLabel = "Scroll tabs right",
  orientation = "horizontal",
  getPanelId,
  className = "",
}: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const vertical = orientation === "vertical";

  // Keyboard selection must carry the focus with it, or the next arrow key is delivered to the tab
  // the user left behind. Only when focus is already inside the strip: a selection changed from
  // elsewhere (a command, a new session) must not yank focus out of whatever the user is typing in.
  useEffect(() => {
    const el = tabRefs.current.get(activeId);
    const root = listRef.current;
    if (!el || !root || !root.contains(document.activeElement)) return;
    if (document.activeElement !== el) el.focus();
  }, [activeId]);

  /**
   * Whether there is anything hidden to the left and to the right, right now.
   *
   * **Measured, never counted.** How many tabs fit depends on the window width, the UI scale and the
   * titles the shells set, so "more than six tabs" would be wrong on both sides of it — and the
   * arrows would either appear when everything is visible or stay away when it is not.
   */
  const [hidden, setHidden] = useState({ before: false, after: false });

  useEffect(() => {
    const root = listRef.current;
    if (!root || vertical) return;

    const measure = () => {
      // The 1px slack is not superstition: `scrollWidth`/`clientWidth` are integers rounded from a
      // fractional layout, so a strip that fits exactly reports one pixel of overflow often enough
      // to make an arrow flicker in and out as the window is dragged.
      const max = root.scrollWidth - root.clientWidth;
      setHidden({ before: root.scrollLeft > 1, after: root.scrollLeft < max - 1 });
    };
    measure();

    // Three sources, and all three are needed: the strip resizes with the window, its CONTENT
    // changes when a tab opens or the shell renames one, and scrolling moves which end is hidden.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const child of Array.from(root.children)) observer.observe(child);
    root.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", measure);
    };
  }, [items, vertical]);

  /** Scroll by most of a screenful, so a click makes visible progress without losing the thread. */
  const scrollBy = (direction: -1 | 1) => {
    const root = listRef.current;
    if (!root) return;
    root.scrollBy({ left: direction * Math.max(120, root.clientWidth * 0.8), behavior: "smooth" });
  };

  // Bring the selected tab into view, whoever selected it. Switching with ⌘3 or opening a terminal
  // from `ygg` can pick a tab that is scrolled out of sight, and a selection you cannot see reads as
  // nothing having happened. `nearest` so a tab already visible is left exactly where it is — pulling
  // the strip around under a selection made with the mouse would be its own kind of wrong.
  useEffect(() => {
    const el = tabRefs.current.get(activeId);
    // jsdom has no layout and therefore no `scrollIntoView`; the guard keeps the component testable
    // without pretending the call happened.
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
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
    const arrows = vertical ? ARROWS.vertical : ARROWS.horizontal;

    if (e.key === arrows.forward || e.key === arrows.back) {
      e.preventDefault();
      const step = e.key === arrows.forward ? 1 : -1;
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

  const strip = (
    <div
      ref={listRef}
      role="tablist"
      // A horizontal strip does not scroll with a vertical wheel, which is what a mouse has. Without
      // this, a trackpad could reach the far tabs and a mouse could not.
      onWheel={(e) => {
        const root = listRef.current;
        if (!root || vertical || e.deltaY === 0 || e.deltaX !== 0) return;
        root.scrollLeft += e.deltaY;
      }}
      aria-label={label}
      aria-orientation={orientation}
      className={`no-scrollbar flex min-w-0 gap-1 ${
        vertical
          ? "flex-col items-stretch overflow-y-auto"
          : "snap-x snap-mandatory items-center overflow-x-auto"
      } ${vertical ? className : "flex-1"}`.trim()}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <div
            key={item.id}
            role="presentation"
            // Horizontal tabs SHRINK before the strip scrolls — `shrink-0` meant it overflowed the
            // moment they stopped fitting, and the strip's edge then fell in the middle of a tab,
            // which reads as a rendering fault rather than as "there is more over there".
            //
            // The floor is not a taste decision. Below it a tab stops doing its two jobs — saying
            // which terminal it is, and offering the ×:
            //
            //     padding      8px + 8px   (px-2)
            //     close button 16px + 4px  (h-4 w-4, mr-1)
            //     ────────────────────────
            //     fixed        36px, leaving 52px of the 88px (5.5rem) floor for the title,
            //                  which is ~7 characters of 12px JetBrains Mono — enough to tell
            //                  `cargo…` from `claude…`.
            //
            // Past that the strip scrolls and the overflow menu takes over, because a tab narrower
            // than this is not a smaller tab, it is an unusable one.
            //
            // `snap-start` is the other half of the scroll: it comes to rest on a tab boundary, so a
            // half-tab is never the resting state.
            className={`${hudButtonClass({ active })} flex items-center ${
              vertical ? "w-full" : "max-w-[13rem] min-w-[5.5rem] shrink snap-start"
            }`}
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
              className={`truncate font-mono text-xs ${
                vertical ? "flex-1 px-3 py-1.5 text-left" : "px-2 py-0.5"
              }`}
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

  // A vertical list has no arrows: it is the settings rail, it is short, and it scrolls the way
  // everything else on the page does.
  if (vertical) return strip;

  return (
    // The arrows sit OUTSIDE the scrolling element — inside it they would scroll away with the tabs,
    // which is the one place a scroll control must never be.
    //
    // Each appears only when there is something in its direction, so the row does not carry two
    // permanently dead buttons — and their space is reserved either way (`w-5` on the placeholder),
    // because a strip that jumps sideways as an arrow appears is worse than one that is a little
    // narrower than it could be.
    <div className={`flex min-w-0 items-center gap-0.5 ${className}`.trim()}>
      {hidden.before ? (
        <ScrollArrow direction={-1} label={scrollBackLabel} onScroll={scrollBy} />
      ) : (
        <span aria-hidden className="w-5 shrink-0" />
      )}
      {strip}
      {hidden.after ? (
        <ScrollArrow direction={1} label={scrollForwardLabel} onScroll={scrollBy} />
      ) : (
        <span aria-hidden className="w-5 shrink-0" />
      )}
    </div>
  );
}

/**
 * One scroll arrow.
 *
 * Defined at module level, not inside `Tabs`: a component created during render is a NEW type on
 * every pass, so React unmounts and remounts it each time — which for a button means losing focus
 * mid-click. The lint catches it, and it is right to.
 */
function ScrollArrow({
  direction,
  label,
  onScroll,
}: {
  direction: -1 | 1;
  label: string;
  onScroll: (direction: -1 | 1) => void;
}) {
  return (
    <IconButton
      label={label}
      variant="ghost"
      tooltip={null}
      // Out of the tab order on purpose: every tab is already reachable with the arrow keys and with
      // ⌘1…9, so a keyboard user gains nothing from two extra stops and loses two.
      tabIndex={-1}
      onClick={() => onScroll(direction)}
      className="h-5 w-5 shrink-0"
    >
      {direction === -1 ? (
        <ChevronLeft size={14} strokeWidth={2.5} />
      ) : (
        <ChevronRight size={14} strokeWidth={2.5} />
      )}
    </IconButton>
  );
}
