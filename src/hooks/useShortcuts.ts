import { useEffect } from "react";
import { useSettings, useUpdateSettings } from "./useSettings";
import { useTerminalStore } from "../store/terminal";
import { useUiStore } from "../store/ui";
import { clearTerminal } from "../lib/terminalHandles";
import { ACTIONS, bindingFor, matches, type ActionId } from "../lib/shortcuts";
import { DEFAULT_FONT_SIZE, FONT_SIZES } from "../lib/fonts";

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
 */
export function useShortcuts(): void {
  const bindings = useUiStore((s) => s.shortcuts);
  const setView = useUiStore((s) => s.setView);
  const toggleTool = useUiStore((s) => s.toggleTool);
  const settings = useSettings();
  const update = useUpdateSettings();
  const fontSize = settings.data?.terminal_font_size ?? DEFAULT_FONT_SIZE;

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
      run(action);
    };

    const run = (action: ActionId) => {
      const store = useTerminalStore.getState();
      const { panes, activeKey } = store;
      const at = panes.findIndex((p) => p.key === activeKey);

      /** Bring a tab to the front and make sure the terminal is what is on screen. */
      const show = (key: string | undefined) => {
        if (key === undefined) return;
        store.setActive(key);
        setView("terminal");
      };

      /** Step through the font sizes the settings page offers, rather than by a free amount. */
      const step = (by: number) => {
        const index = FONT_SIZES.indexOf(fontSize as (typeof FONT_SIZES)[number]);
        // A size that is not in the list (set by an older build, or by hand) starts from the
        // nearest one rather than refusing to move.
        const from =
          index >= 0
            ? index
            : FONT_SIZES.reduce(
                (best, size, i, all) =>
                  Math.abs(size - fontSize) < Math.abs((all.at(best) ?? size) - fontSize)
                    ? i
                    : best,
                0,
              );
        const next = FONT_SIZES.at(Math.min(FONT_SIZES.length - 1, Math.max(0, from + by)));
        if (next !== undefined && next !== fontSize) update.mutate({ terminalFontSize: next });
      };

      switch (action) {
        case "newTab":
          store.openPane();
          setView("terminal");
          return;
        case "closeTab":
          if (activeKey !== null) store.requestClosePane(activeKey);
          return;
        // Wrapping, because a tab strip is a ring: pressing "next" on the last tab and getting
        // nothing is a key that silently does nothing.
        case "nextTab":
          show(panes[(at + 1) % panes.length]?.key);
          return;
        case "previousTab":
          show(panes[(at - 1 + panes.length) % panes.length]?.key);
          return;
        case "find":
          // Handled by the visible pane, which owns its own search bar — this only has to make sure
          // the terminal is what is on screen.
          setView("terminal");
          window.dispatchEvent(new CustomEvent("yggshell:find"));
          return;
        case "fontBigger":
          step(1);
          return;
        case "fontSmaller":
          step(-1);
          return;
        case "fontReset":
          if (fontSize !== DEFAULT_FONT_SIZE)
            update.mutate({ terminalFontSize: DEFAULT_FONT_SIZE });
          return;
        case "clear":
          if (activeKey !== null) clearTerminal(activeKey);
          return;
        case "openSettings":
          setView("settings");
          return;
        case "openLogs":
          setView("logs");
          return;
        case "toggleGitTool":
          toggleTool("git");
          return;
        case "toggleFilesTool":
          toggleTool("files");
          return;
        case "toggleActivityTool":
          toggleTool("activity");
          return;
        case "toggleDockerTool":
          toggleTool("docker");
          return;
        case "toggleTmuxTool":
          toggleTool("tmux");
          return;
        case "toggleNotesTool":
          toggleTool("notes");
          return;
        case "toggleAgentTool":
          toggleTool("agent");
          return;
        default: {
          // `selectTab1`…`selectTab9`. Derived rather than nine cases: the number IS the index, and
          // nine near-identical branches is nine places for one of them to be wrong.
          const wanted = Number(action.replace("selectTab", ""));
          if (Number.isInteger(wanted)) show(panes[wanted - 1]?.key);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bindings, setView, toggleTool, fontSize, update]);
}
