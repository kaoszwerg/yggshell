import { useEffect } from "react";
import { useToastStore, TOAST_MS } from "../../store/toast";
import { useT } from "../../hooks/useT";

/**
 * The short confirmation that something just happened — rendered once, at the app root.
 *
 * **A HUD primitive, not a stock notification** (ADR-APP-026): same chamfer as every panel, same
 * palette, drawn in the accent that matches what it is saying. Green for something that worked, the
 * danger accent for something that did not, and nothing else — a message with three meanings is a
 * message the user has to read twice.
 *
 * **It sits above the terminal and out of the way of the tabs.** Bottom centre: the status bar is
 * along the bottom edge and the title bar carries the tab strip, so the only place that covers neither
 * is just above the status bar. `pointer-events-none`, because a confirmation that can swallow a click
 * on the thing underneath it is worse than no confirmation.
 *
 * **Reduced motion removes the movement, not the message** — the same distinction the activity line
 * makes. It still appears and still disappears; it simply does not slide.
 */
export function Toast() {
  const toast = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);
  const t = useT();

  const id = toast?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    // Keyed on the id, so a newer message restarts the clock rather than inheriting the old one's
    // remaining time — otherwise the second of two quick copies could vanish almost immediately.
    const timer = setTimeout(() => {
      dismiss(id);
    }, TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [id, dismiss]);

  if (toast === null) return null;

  // `hud-popover` + `hud-clip-sm` + an accent, which is the composition the design system documents
  // for a chamfered surface with an edge: a CSS `border` under a `clip-path` is cut off at the
  // chamfers and the corners turn square again. The accent utility is what colours both at once.
  const accent = toast.tone === "error" ? "hud-accent-danger" : "hud-accent-green";
  const label = toast.tone === "error" ? "text-danger" : "text-green";

  return (
    <div
      // `status`, not `alert`: this confirms something the user just did. An alert interrupts a screen
      // reader mid-sentence, which for "copied" is louder than the thing it is reporting.
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-3 z-50 flex justify-center"
    >
      <span
        key={toast.id}
        className={`hud-popover hud-clip-sm hud-toast ${accent} ${label} px-3 py-1 font-mono text-[11px] tracking-wide`}
      >
        {t(toast.key)}
      </span>
    </div>
  );
}
