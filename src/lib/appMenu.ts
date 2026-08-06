import type { AppMenuSpec } from "../bindings/AppMenuSpec";
import type { MessageKey } from "../i18n";
import { bindingFor, toAccelerator, type ActionId, type Binding } from "./shortcuts";

/**
 * Which actions the native menu offers a key for.
 *
 * Everything else in the menu is either a predefined item with the platform's own key (Quit, Hide,
 * Cut/Copy/Paste, Toggle Full Screen) or has none at all. **Listed rather than derived from
 * `ACTIONS`**, because the menu is a chosen subset: a menu that grew an item every time an action was
 * added would be a menu nobody designed.
 */
const KEYED: ActionId[] = [
  "openSettings",
  "newTab",
  "closeTab",
  "find",
  "clear",
  "fontBigger",
  "fontSmaller",
  "fontReset",
  "openLogs",
  "toggleGitTool",
  "toggleFilesTool",
  "toggleActivityTool",
  "toggleDockerTool",
  "toggleAgentTool",
  "toggleChainTool",
  "toggleTmuxTool",
  "toggleNotesTool",
  "nextTab",
  "previousTab",
  "selectTab1",
  "selectTab2",
  "selectTab3",
  "selectTab4",
  "selectTab5",
  "selectTab6",
  "selectTab7",
  "selectTab8",
  "selectTab9",
];

/**
 * Everything the native menu says and every key it shows, built from the two places those live.
 *
 * **The words from the catalogue, the keys from the store — never a copy of either.** A menu that
 * carried its own strings would be a second thing to translate; one that carried its own keys would
 * *win* against the user's own binding, because a menu key equivalent is dispatched by AppKit before
 * the webview ever sees the keystroke. That is not a hypothetical: it is why `⌘W` closed the window
 * instead of the tab under Tauri's default menu.
 *
 * Pure, so the mapping can be checked without a window: the half that actually breaks is which id
 * gets which key.
 */
export function appMenuSpec(
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  bindings: Record<ActionId, Binding>,
): AppMenuSpec {
  // Built from entries rather than by assigning `keys[action]`: a computed member write is an
  // object-injection sink as far as the lint is concerned, and the gate runs at --max-warnings 0.
  // An action with no binding simply gets no entry, so the item shows no key — better than
  // inventing one, which would leave the menu advertising a combination that does nothing.
  const keys: Record<string, string> = Object.fromEntries(
    KEYED.map((action) => [action, bindingFor(bindings, action)] as const)
      .filter((pair): pair is [ActionId, Binding] => pair[1] !== undefined)
      .map(([action, binding]) => [action, toAccelerator(binding)]),
  );

  // No full-screen key here: AppKit adds its own *Enter Full Screen* to the View menu, with `⌃⌘F`,
  // once the window is marked full-screen-capable (`window_chrome::allow_fullscreen`).

  return {
    labels: {
      about: t("menu.about"),
      settings: t("menu.settings"),
      services: t("menu.services"),
      hide: t("menu.hide"),
      hideOthers: t("menu.hideOthers"),
      showAll: t("menu.showAll"),
      quit: t("menu.quit"),

      shell: t("menu.shell"),
      newTab: t("menu.newTab"),
      closeTab: t("menu.closeTab"),
      find: t("menu.find"),
      clear: t("menu.clear"),

      edit: t("menu.edit"),
      undo: t("menu.undo"),
      redo: t("menu.redo"),
      cut: t("menu.cut"),
      copy: t("menu.copy"),
      paste: t("menu.paste"),
      selectAll: t("menu.selectAll"),

      view: t("menu.view"),
      fontBigger: t("menu.fontBigger"),
      fontSmaller: t("menu.fontSmaller"),
      fontReset: t("menu.fontReset"),
      logs: t("menu.logs"),

      tools: t("menu.tools"),
      toolGit: t("menu.tool.git"),
      toolFiles: t("menu.tool.files"),
      toolActivity: t("menu.tool.activity"),
      toolDocker: t("menu.tool.docker"),
      toolAgent: t("menu.tool.agent"),
      toolChain: t("menu.tool.chain"),
      toolTmux: t("menu.tool.tmux"),
      toolNotes: t("menu.tool.notes"),

      window: t("menu.window"),
      minimize: t("menu.minimize"),
      zoom: t("menu.zoom"),
      nextTab: t("menu.nextTab"),
      previousTab: t("menu.previousTab"),
      // The numbering is wording, so it comes from the catalogue like everything else.
      selectTabs: Array.from({ length: 9 }, (_, at) => t("menu.selectTab", { n: at + 1 })),
    },
    keys,
  };
}
