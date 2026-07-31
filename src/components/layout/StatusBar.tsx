import { Button } from "../ui/Button";
import { StatusItemView } from "./statusItems";
import { useUiStore } from "../../store/ui";
import { useT } from "../../hooks/useT";

/**
 * The bottom strip: whatever the user put in it, and the scroll-to-top control.
 *
 * **Two halves, and the split is deliberate.** The left is a layout the user assembles — a flat list
 * with flexible spacers, because three fixed regions cannot express "second from the right" and force
 * a bucket decision on every element added later (`lib/statusBar`).
 *
 * The right is **not** configurable. Scroll-to-top appears and disappears with what is on screen; as
 * an item in the list, every appearance would shove the user's arrangement sideways, and it could be
 * removed altogether — leaving no way back to the top of a long view.
 */
export function StatusBar({
  canScrollTop = false,
  onScrollTop,
}: {
  canScrollTop?: boolean;
  onScrollTop?: () => void;
}) {
  const layout = useUiStore((s) => s.statusLayout);
  const t = useT();

  return (
    <div className="hud-strip hud-strip-bottom flex h-7 shrink-0 items-center gap-2 px-3 font-mono text-[10px] text-[var(--saga-text-dim)]">
      {layout.map((item) =>
        item.id === "spacer" ? (
          // The spacer IS the alignment: an empty flexible box, so everything after it is pushed
          // along. Several of them share the free space equally, which is how a centred group works.
          <span key={item.key} className="flex-1" aria-hidden />
        ) : item.id === "separator" ? (
          <span key={item.key} className="bg-cyan/20 h-3 w-px shrink-0" aria-hidden />
        ) : (
          <span key={item.key} className="flex min-w-0 shrink-0 items-center whitespace-nowrap">
            <StatusItemView id={item.id} />
          </span>
        ),
      )}

      {/* A bar with no spacer in it must still not leave this control stranded in the middle. */}
      {layout.some((i) => i.id === "spacer") ? null : <span className="flex-1" aria-hidden />}

      <div className="flex shrink-0 items-center justify-end">
        {canScrollTop ? (
          <Button
            variant="ghost"
            onClick={onScrollTop}
            aria-label={t("statusbar.scrollTop")}
            tooltip={t("statusbar.scrollTop")}
            className="tracking-wider uppercase"
          >
            ↑ {t("statusbar.top")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
