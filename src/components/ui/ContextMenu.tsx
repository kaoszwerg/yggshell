import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import { hudButtonClass, type HudAccent } from "./hudButton";

/** One actionable row. `accent` colours the row on hover — `danger` for anything destructive. */
interface ContextMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  accent?: HudAccent;
  /** Keyboard hint shown right-aligned (e.g. `⌘C`). Display only — this primitive binds nothing. */
  shortcut?: string;
}

/** A rule between two groups of rows. Never focusable, never counted by the arrow keys. */
interface ContextMenuSeparator {
  separator: true;
}

/** Not exported yet — nothing consumes these names, and the unused-export check is a gate rather
 * than a suggestion (rule:code-quality). They get their `export` alongside the first caller that
 * needs to name them. */
type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export interface ContextMenuProps {
  /** Accessible name of the menu — a view may carry more than one. */
  label: string;
  items: ContextMenuEntry[];
  /** The single element whose right-click opens the menu. */
  children: ReactElement;
}

/** Props the menu chains onto its trigger — an existing handler is preserved, not overwritten. */
interface TriggerProps {
  onContextMenu?: (e: MouseEvent<Element>) => void;
}

const isItem = (e: ContextMenuEntry): e is ContextMenuItem => !("separator" in e);

/** Keeps the menu off the viewport edge. Matches the popover inset used elsewhere in the HUD. */
const EDGE = 8;

/**
 * HUD context menu (ADR-APP-026): the replacement for the WebView's own right-click menu, which is
 * unstyled OS chrome and a break in the HUD. `useNativeContextMenuGuard` suppresses that menu
 * app-wide; this primitive is what the app puts in its place, and it suppresses it again itself so it
 * is correct on its own — a primitive that only works because some hook elsewhere ran is a trap.
 *
 * Layout-neutral, like `Tooltip`: it clones the single child and attaches a handler instead of
 * wrapping it in a box, so it never disturbs a flex/grid parent. The menu renders through a portal so
 * a parent's `clip-path` cannot crop it, and it is clamped into the viewport after measuring — a menu
 * opened near the bottom edge must not run off the screen.
 *
 * Keyboard follows the WAI-ARIA menu pattern: the first enabled row takes focus on open, the arrow
 * keys move over enabled rows only (a disabled row is announced but never a stop), Home/End jump,
 * Enter/Space activate, Escape closes and gives focus back to the trigger.
 */
export function ContextMenu({ label, items, children }: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  // The element to hand focus back to. State, not a ref: it is written from the trigger's event
  // handler, and that handler is built during render — where a ref may not be touched.
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const enabled = items.filter(isItem).filter((i) => i.disabled !== true);

  // Memoised because the dismiss listeners below depend on it: an identity that changed every
  // render would tear down and re-attach two window listeners on each one.
  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) triggerEl?.focus();
    },
    [triggerEl],
  );

  // Escape anywhere closes: the pointer may have left the menu, and a menu that can only be dismissed
  // by clicking is a trap for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onDown = (e: globalThis.MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, close]);

  // Measure, then clamp. Done in a layout effect so the menu never paints once at the wrong place.
  useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(pos.left, window.innerWidth - rect.width - EDGE));
    const top = Math.max(EDGE, Math.min(pos.top, window.innerHeight - rect.height - EDGE));
    if (left !== pos.left || top !== pos.top) setPos({ top, left });
  }, [open, pos.left, pos.top]);

  // Focus lands on the first enabled row, as the menu pattern requires. Keyed on that row's id, not
  // on the items array: a menu that re-renders while open (a label updating behind it) must not drag
  // the focus back to the top and undo the arrow key the user just pressed.
  const firstEnabledId = enabled.at(0)?.id;
  useEffect(() => {
    if (!open || firstEnabledId === undefined) return;
    itemRefs.current.get(firstEnabledId)?.focus();
  }, [open, firstEnabledId]);

  if (!isValidElement(children)) return children;

  // The trigger must be a HOST element (`div`, `button`, …), not a component.
  //
  // `cloneElement` will happily attach `onContextMenu` to a React component, and a component that
  // does not forward unknown props to a DOM node simply drops it: no error, no warning, a menu that
  // never opens. That shipped once — a `<Tabs>` used directly as the trigger. Loud in development,
  // where it can still be fixed.
  if (import.meta.env.DEV && typeof children.type !== "string") {
    console.warn(
      "ContextMenu: the trigger must be a DOM element, not a component — a component that does not " +
        "forward onContextMenu to a DOM node silently swallows it. Wrap it in a <div>.",
    );
  }

  const childProps = (children.props ?? {}) as TriggerProps;
  const trigger = cloneElement(children as ReactElement<TriggerProps>, {
    onContextMenu: (e: MouseEvent<Element>) => {
      childProps.onContextMenu?.(e);
      // Suppressed even when there is nothing to show: the native menu must never appear over the
      // HUD, and "no actions here" is not a reason to hand the user the WebView's own menu.
      e.preventDefault();
      if (enabled.length === 0 && items.filter(isItem).length === 0) return;
      setTriggerEl(e.currentTarget as HTMLElement);
      setPos({ top: e.clientY, left: e.clientX });
      setOpen(true);
    },
  });

  const focusAt = (index: number) => {
    const target = enabled.at(((index % enabled.length) + enabled.length) % enabled.length);
    if (target) itemRefs.current.get(target.id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, item: ContextMenuItem) => {
    const index = enabled.findIndex((i) => i.id === item.id);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusAt(index + (e.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusAt(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      focusAt(enabled.length - 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      run(item);
    }
  };

  const run = (item: ContextMenuItem) => {
    if (item.disabled === true) return;
    close(false);
    item.onSelect();
  };

  return (
    <>
      {trigger}
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              className="hud-popover hud-clip-sm hud-accent-cyan fixed z-[80] min-w-[11rem] py-1"
              style={{ top: pos.top, left: pos.left }}
            >
              {items.map((entry, i) =>
                isItem(entry) ? (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    aria-disabled={entry.disabled === true}
                    ref={(el) => {
                      if (el) itemRefs.current.set(entry.id, el);
                      else itemRefs.current.delete(entry.id);
                    }}
                    onClick={() => run(entry)}
                    onKeyDown={(e) => onKeyDown(e, entry)}
                    className={`${hudButtonClass({ variant: "ghost", accent: entry.accent })} flex w-full items-center gap-4 px-3 py-1 text-left font-mono text-xs ${
                      entry.disabled === true ? "text-dim/50 pointer-events-none" : "text-fg"
                    }`}
                  >
                    <span className="flex-1 truncate">{entry.label}</span>
                    {entry.shortcut != null ? (
                      <span className="text-dim shrink-0 text-[10px] tracking-wider">
                        {entry.shortcut}
                      </span>
                    ) : null}
                  </button>
                ) : (
                  // A separator carries no identity of its own; its position between two named rows
                  // is the only thing that distinguishes it, so that is what the key says.
                  <div
                    key={`sep-after-${items.slice(0, i).filter(isItem).length}`}
                    role="separator"
                    className="hud-divider mx-2 my-1"
                  />
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
