import { useSettings, useUpdateSettings } from "./useSettings";
import { useTerminalStore } from "../store/terminal";
import { useUiStore } from "../store/ui";
import { clearTerminal } from "../lib/terminalHandles";
import type { ActionId } from "../lib/shortcuts";
import { DEFAULT_FONT_SIZE, FONT_SIZES } from "../lib/fonts";

/**
 * What each action actually does — **the one place that knows**.
 *
 * There are two ways to ask for the same thing: a key (`useShortcuts`) and a menu item
 * (`useAppMenu`). They must not each carry their own idea of what "new tab" means, or the day one of
 * them grows a step the other does not is the day the menu and the keyboard quietly disagree
 * (ADR-CORE-005). So the *asking* is two mechanisms and the *doing* is this function.
 *
 * It lives in a hook rather than a plain module because every branch needs a store or a mutation, and
 * reading those outside React would mean a second way to reach them as well.
 */
export function useRunAction(): (action: ActionId) => void {
  const setView = useUiStore((s) => s.setView);
  const toggleTool = useUiStore((s) => s.toggleTool);
  const settings = useSettings();
  const update = useUpdateSettings();
  const fontSize = settings.data?.terminal_font_size ?? DEFAULT_FONT_SIZE;

  return (action: ActionId) => {
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
                Math.abs(size - fontSize) < Math.abs((all.at(best) ?? size) - fontSize) ? i : best,
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
        if (fontSize !== DEFAULT_FONT_SIZE) update.mutate({ terminalFontSize: DEFAULT_FONT_SIZE });
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
      case "toggleChainTool":
        toggleTool("chain");
        return;
      default: {
        // `selectTab1`…`selectTab9`. Derived rather than nine cases: the number IS the index, and
        // nine near-identical branches is nine places for one of them to be wrong.
        const wanted = Number(action.replace("selectTab", ""));
        if (Number.isInteger(wanted)) show(panes[wanted - 1]?.key);
      }
    }
  };
}
