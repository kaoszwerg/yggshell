/**
 * Assembling the status bar: a palette of everything available, and the bar itself below it.
 *
 * **Why a list and not three regions.** A bar with left/centre/right slots forces every element into
 * one of three buckets, makes "second from the right" inexpressible, and turns each new element into
 * a bucket decision. A flat list with flexible spacers is how toolbars have worked since the NeXT
 * days: the user puts the gap where they want it, and the alignment follows.
 *
 * **Why every gesture has a key.** HTML5 drag-and-drop is not keyboard-operable — there is no
 * keyboard equivalent of `dragstart` — so an editor built only on dragging is unusable without a
 * mouse (rule:ui-design). Arrow keys move, Backspace removes, Enter in the palette appends. The
 * dragging is the convenience; the keys are the interface.
 */
import { useEffect, useRef, useState } from "react";
import { GripVertical, MoveHorizontal, Minus } from "lucide-react";
import { Button } from "../ui/Button";
import { StatusItemSample } from "../layout/statusItems";
import { useUiStore } from "../../store/ui";
import { useT } from "../../hooks/useT";
import type { MessageKey } from "../../i18n";
import {
  availableItems,
  isStatusItemId,
  insertItem,
  moveItem,
  removeItem,
  type StatusItem,
  type StatusItemId,
} from "../../lib/statusBar";

/**
 * The drag payload's MIME type.
 *
 * A private type rather than `text/plain`: the bar is a drop target on a desktop, and a path dragged
 * in from Finder or a selection from another window must be ignored, not parsed hopefully.
 */
const MIME = "application/x-yggshell-status-item";

/** A drag either carries something new from the palette, or an item already in the bar. */
type Payload = { from: "palette"; id: StatusItemId } | { from: "bar"; index: number };

function encode(payload: Payload): string {
  return JSON.stringify(payload);
}

function decode(raw: string): Payload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Partial<Payload> & Record<string, unknown>;
    if (p.from === "palette" && isStatusItemId(p.id)) {
      return { from: "palette", id: p.id };
    }
    if (p.from === "bar" && typeof p.index === "number" && Number.isInteger(p.index)) {
      return { from: "bar", index: p.index };
    }
    return null;
  } catch {
    // Anything that is not our JSON — a file, a URL, a text selection.
    return null;
  }
}

/**
 * The message keys for an item's name and its explanation.
 *
 * Derived from the id rather than stored beside it, so the registry in `lib/statusBar` stays a list
 * of *what exists* and this file owns *what it is called* — which is the half that changes with the
 * interface language.
 */
function itemKeys(id: StatusItemId): { label: MessageKey; hint: MessageKey } {
  return { label: `statusbar.item.${id}`, hint: `statusbar.item.${id}.hint` };
}

/** What a placed item looks like in the editor: an icon for the two abstract ones, a name otherwise. */
function ChipFace({ id }: { id: StatusItemId }) {
  const t = useT();
  if (id === "spacer") {
    return (
      <>
        <MoveHorizontal size={12} strokeWidth={2} aria-hidden />
        <span>{t("statusbar.item.spacer")}</span>
      </>
    );
  }
  if (id === "separator") {
    return (
      <>
        <Minus size={12} strokeWidth={2} className="rotate-90" aria-hidden />
        <span>{t("statusbar.item.separator")}</span>
      </>
    );
  }
  return <span>{t(itemKeys(id).label)}</span>;
}

export function StatusBarEditor() {
  const layout = useUiStore((s) => s.statusLayout);
  const setLayout = useUiStore((s) => s.setStatusLayout);
  const reset = useUiStore((s) => s.resetStatusLayout);
  /** Where a drop would land, for the insertion marker. `null` while nothing is over the bar. */
  const [dropAt, setDropAt] = useState<number | null>(null);
  /**
   * The key to put focus back on after a move.
   *
   * Without it an arrow-key move reorders the list, React re-renders, and focus falls to the body —
   * so moving an item two places left means finding it again with Tab in between. That is the
   * difference between a keyboard alternative and a keyboard *interface*.
   */
  const refocus = useRef<string | null>(null);
  /**
   * The rendered chips, by item key.
   *
   * A `ref` callback would not do: React MOVES an existing node when a keyed list is reordered
   * rather than recreating it, so the callback never fires for the item that just moved — the one
   * case this exists for. (Measured: focus landed on `<body>`.)
   */
  const chips = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const key = refocus.current;
    if (key === null) return;
    refocus.current = null;
    chips.current.get(key)?.focus();
  }, [layout]);

  const apply = (next: StatusItem[], focusKey?: string) => {
    refocus.current = focusKey ?? null;
    setLayout(next);
  };

  const add = (id: StatusItemId, at = layout.length) => apply(insertItem(layout, id, at));

  const onDrop = (event: React.DragEvent, at: number) => {
    event.preventDefault();
    setDropAt(null);
    const payload = decode(event.dataTransfer.getData(MIME));
    if (payload === null) return;
    if (payload.from === "palette") {
      apply(insertItem(layout, payload.id, at));
      return;
    }
    apply(moveItem(layout, payload.index, at), layout[payload.index]?.key);
  };

  const onKey = (event: React.KeyboardEvent, index: number, item: StatusItem) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const to = event.key === "ArrowLeft" ? index - 1 : index + 1;
      // Clamped rather than wrapped: an item that jumps from one end of the bar to the other because
      // it was nudged once too often is a surprise, not a feature.
      if (to < 0 || to >= layout.length) return;
      apply(moveItem(layout, index, to), item.key);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      apply(removeItem(layout, item.key));
    }
  };

  const t = useT();
  const offered = availableItems(layout);

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-col gap-1.5"
        role="group"
        aria-label={t("statusbar.editor.availableItems")}
      >
        <span className="text-dim text-xs">{t("statusbar.editor.available")}</span>
        <div className="flex flex-wrap gap-1">
          {offered.length === 0 ? (
            <span className="text-dim/60 font-mono text-xs">{t("statusbar.editor.allPlaced")}</span>
          ) : (
            offered.map((id) => (
              <Button
                key={id}
                draggable
                aria-label={t("statusbar.editor.add", { item: t(itemKeys(id).label) })}
                tooltip={t(itemKeys(id).hint)}
                onClick={() => add(id)}
                onDragStart={(e) => e.dataTransfer.setData(MIME, encode({ from: "palette", id }))}
                className="cursor-grab gap-1.5"
              >
                <ChipFace id={id} />
              </Button>
            ))
          )}
        </div>
        <span className="text-dim text-xs">{t("statusbar.editor.paletteHint")}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">{t("statusbar.editor.yourBar")}</span>
        <ul
          aria-label={t("statusbar.editor.yourBar")}
          className="hud-clip-sm bg-elevated flex min-h-11 flex-wrap items-center gap-1 p-2"
          onDragOver={(e) => {
            e.preventDefault();
            setDropAt(layout.length);
          }}
          onDragLeave={() => setDropAt(null)}
          onDrop={(e) => onDrop(e, layout.length)}
        >
          {layout.length === 0 ? (
            <li className="text-dim/60 font-mono text-xs">{t("statusbar.editor.empty")}</li>
          ) : null}
          {layout.map((item, index) => (
            <li
              key={item.key}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(MIME, encode({ from: "bar", index }))}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropAt(index);
              }}
              onDrop={(e) => {
                e.stopPropagation();
                onDrop(e, index);
              }}
              className={`flex items-center ${
                dropAt === index ? "border-cyan border-l-2" : "border-l-2 border-transparent"
              }`}
            >
              <Button
                ref={(el) => {
                  if (el) chips.current.set(item.key, el);
                  else chips.current.delete(item.key);
                }}
                tooltip={t("statusbar.editor.itemHint", { hint: t(itemKeys(item.id).hint) })}
                onKeyDown={(e) => onKey(e, index, item)}
                className="cursor-grab gap-1.5"
              >
                <GripVertical size={12} strokeWidth={2} className="text-dim" aria-hidden />
                <ChipFace id={item.id} />
              </Button>
            </li>
          ))}
        </ul>
        <span className="text-dim text-xs">{t("statusbar.editor.barHint")}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">{t("statusbar.editor.preview")}</span>
        {/* Sample values, not live ones: the preview exists to show the ARRANGEMENT, and live data
            would leave it empty exactly while somebody is arranging it (nothing running, no
            repository) — as well as dragging the Git query onto the settings page to do it. */}
        <div
          role="group"
          aria-label={t("statusbar.editor.preview")}
          className="hud-clip-sm bg-base flex h-7 items-center gap-2 px-3 font-mono text-[10px] text-[var(--saga-text-dim)]"
        >
          {layout.map((item) =>
            item.id === "spacer" ? (
              <span key={item.key} className="flex-1" aria-hidden />
            ) : item.id === "separator" ? (
              <span key={item.key} className="bg-cyan/20 h-3 w-px shrink-0" aria-hidden />
            ) : (
              <span key={item.key} className="flex shrink-0 items-center whitespace-nowrap">
                <StatusItemSample id={item.id} />
              </span>
            ),
          )}
        </div>
        <span className="text-dim text-xs">{t("statusbar.editor.previewHint")}</span>
      </div>

      <div className="flex flex-wrap gap-1">
        <Button onClick={() => reset()}>{t("statusbar.editor.reset")}</Button>
        <Button onClick={() => apply([])}>{t("statusbar.editor.removeAll")}</Button>
      </div>
    </div>
  );
}
