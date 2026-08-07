import { useEffect } from "react";
import { useUiStore } from "../store/ui";

/**
 * Escape returns to the terminal from a full-page view.
 *
 * **Every view that replaces the page owes the user a way out that costs nothing to discover.**
 * Reported from the running app: *"die Einstellungen haben weder einen Close-Button noch reagieren
 * sie auf Esc"* — and Logs had neither either. Notes had both, and had them written inline, which is
 * exactly how the other two came to be missing: a behaviour that lives in one component is a
 * behaviour the next component does not inherit (ADR-CORE-005).
 *
 * @param enabled pass `false` while something inside the view owns Escape itself — a text editor, an
 *   open menu, a dialog. Escape then belongs to the innermost thing that can consume it, and leaving
 *   the view is the *second* press. Two at most, from anywhere, and neither has to be known in
 *   advance.
 *
 * It listens on the **window**, not on a focused element: a view is left from wherever the caret
 * happens to be, including a search box or a scrolled list that never took focus.
 */
export function useEscapeToTerminal(enabled = true): void {
  const setView = useUiStore((s) => s.setView);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setView("terminal");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled, setView]);
}
