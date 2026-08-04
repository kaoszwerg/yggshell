import { useEffect, useRef } from "react";
import { useUiStore } from "../store/ui";
import { ACTIONS, bindingFor, matches } from "../lib/shortcuts";
import { useRunAction } from "./useRunAction";

/**
 * Run the keyboard shortcuts, once, at the app root.
 *
 * **On the window, not on the emulator.** xterm's key handler only fires while the terminal holds
 * focus, so binding here is what makes `⌘F` work when the caret is in the search box, and `⌘T` work
 * while the settings page is open. The cost is that this sees *every* keystroke, which is why the
 * match is exact and `preventDefault` is called only when something actually ran.
 *
 * **Nothing reaches the shell that the shell should have had**: a binding without the platform's own
 * modifier is refused before it can be stored (`lib/shortcuts`), so this loop can never be holding
 * one.
 *
 * **What each action DOES is not here** — it is `useRunAction`, shared with the native menu, so the
 * two ways of asking cannot drift into two ideas of what was asked for (ADR-CORE-005).
 */
export function useShortcuts(): void {
  const bindings = useUiStore((s) => s.shortcuts);
  const run = useRunAction();

  // Through a ref, so the window listener is registered once instead of being torn down and rebuilt
  // every time a setting changes underneath the runner.
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = ACTIONS.find((id) => {
        const binding = bindingFor(bindings, id);
        return binding !== undefined && matches(binding, event);
      });
      if (action === undefined) return;

      // Only now — a key that matched nothing must reach whatever it was going to reach, including
      // the terminal.
      event.preventDefault();
      latest.current(action);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bindings]);
}
