// Global UI state (Zustand): active view, the tool column, and transient dialog flags.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultLayout, sanitiseLayout, type StatusItem } from "../lib/statusBar";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../i18n";
import { defaultBindings, sanitiseBindings, type ActionId, type Binding } from "../lib/shortcuts";

/** Top-level views (sidebar navigation). Product views are added here as they land. */
export type ViewId = "terminal" | "logs" | "settings";

const VIEWS: ViewId[] = ["terminal", "logs", "settings"];

/**
 * Tools that render in the column beside the navigation rail — never *in* the rail, which is
 * navigation only.
 *
 * A tool is not a view: a view replaces what you are looking at, a tool sits next to it while the
 * terminal keeps running. That is the whole point of the column, so Logs and Settings stay views.
 */
export type ToolId = "git" | "files" | "activity" | "docker" | "agent" | "tmux";

const TOOLS: ToolId[] = ["git", "files", "activity", "docker", "agent", "tmux"];

/** Bounds of the tool column, in pixels. Below the minimum a file path is unreadable; above the
 *  maximum the terminal stops being the main thing on screen. */
export const TOOL_WIDTH_MIN = 180;
export const TOOL_WIDTH_MAX = 560;
const TOOL_WIDTH_DEFAULT = 280;

/**
 * How much of the Git tool's scrollable area the changes list gets, as a percentage — the graph gets
 * the rest.
 *
 * A share rather than a pixel height, because the column's height is the window's: a stored `240px`
 * would be most of a short window and a sliver of a tall one, and the user would have to re-drag it
 * every time they resized. The bounds keep either region from being dragged into a strip too small
 * to show a single row.
 */
export const GIT_SPLIT_MIN = 15;
export const GIT_SPLIT_MAX = 85;
const GIT_SPLIT_DEFAULT = 45;

/**
 * What a Git detail panel is showing.
 *
 * The *value* lives here; **where it is shown does not** — it belongs to a tab (`TerminalPane.detail`).
 * This is a tabbed, multiplexed terminal: two tabs are usually two repositories, and one panel for the
 * whole window meant opening a diff in one tab and finding it laid over another.
 */
export type GitDetail =
  | { kind: "file"; path: string; staged: boolean }
  | { kind: "commit"; rev: string }
  | { kind: "commit-file"; rev: string; path: string };

export interface UiState {
  view: ViewId;
  /** The tool in the column, or `null` when the column is collapsed. */
  activeTool: ToolId | null;
  /** Width of the tool column in pixels. Remembered even while it is collapsed, so reopening it
   *  restores the size the user chose rather than a default. */
  toolWidth: number;
  /** Percentage of the Git tool's body given to the changes list; the graph takes the rest. */
  gitSplit: number;
  /**
   * Whether a diff is drawn side by side rather than as one interleaved column.
   *
   * A layout preference like the column width, so it is remembered and shared by every tab — how you
   * *read* a diff does not change between repositories, unlike WHAT you are reading, which is why the
   * panel's content belongs to a tab and this does not.
   */
  diffSplit: boolean;
  /**
   * What the status bar is made of, left to right.
   *
   * A list rather than three fixed regions: spacers do the aligning, so "second from the right" is
   * expressible and a new element needs no decision about which region owns it (`lib/statusBar`).
   */
  statusLayout: StatusItem[];
  /**
   * The language the interface is drawn in.
   *
   * **The durable source is `settings.json`**, like every other preference — this is a mirror of it,
   * and `useSyncLocale` writes the stored value here once it has loaded. Two reasons it is mirrored
   * rather than read directly:
   *
   *  - **the first frame**. The settings arrive over IPC, so reading them directly means the whole
   *    interface paints in English and then switches — a visible flicker on every launch, in the one
   *    place a user notices immediately.
   *  - **every component would need the query client.** `t()` is used in leaf primitives; sourcing it
   *    from a query would drag a `QueryClientProvider` into each of their tests, for a value that
   *    changes about once in a user's life.
   */
  locale: Locale;
  /**
   * Which keys ask for which action.
   *
   * Sanitised on the way in and on rehydrate, because one rule here is not the user's to override:
   * a binding without the platform's own modifier reaches the SHELL, and taking `Ctrl+C` away from
   * every program they run is not a preference (`lib/shortcuts`).
   */
  shortcuts: Record<ActionId, Binding>;
  /**
   * Whether the file browser shows dot-files.
   *
   * Off by default and remembered. On for a developer more often than not — `.github`, `.env` and
   * `.claude` are exactly what they are looking for — but a tree that opens with twelve dot-entries
   * above `src` buries the thing they actually came to see.
   */
  filesShowHidden: boolean;
  /** Whether the HUD About dialog is open (transient — not persisted). */
  aboutOpen: boolean;

  setView: (v: ViewId) => void;
  /** Show a tool. Choosing the one already shown collapses the column — the rail button is a toggle. */
  toggleTool: (t: ToolId) => void;
  setToolWidth: (px: number) => void;
  setGitSplit: (percent: number) => void;
  setDiffSplit: (split: boolean) => void;
  /** Replace the bar's contents. Sanitised on the way in, so the renderer never meets an unknown id. */
  setStatusLayout: (items: StatusItem[]) => void;
  resetStatusLayout: () => void;
  setLocale: (locale: Locale) => void;
  /** Rebind one action. A binding the shell needs is refused, not stored. */
  setShortcut: (action: ActionId, binding: Binding) => void;
  resetShortcuts: () => void;
  toggleFilesHidden: () => void;
  setAboutOpen: (v: boolean) => void;
}

const clampWidth = (px: number) =>
  Math.min(TOOL_WIDTH_MAX, Math.max(TOOL_WIDTH_MIN, Math.round(px)));

const clampSplit = (percent: number) =>
  Math.min(GIT_SPLIT_MAX, Math.max(GIT_SPLIT_MIN, Math.round(percent)));

/** Global client-UI state: view, tool column and transient dialog flags (rule:frontend-architecture). */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      // The terminal is the product, so it is what a fresh install opens on
      // (mem:project-scope). A persisted choice still wins — this is only the default.
      view: "terminal",
      // Collapsed on a fresh install: an empty column beside the terminal earns its space only once
      // the user has asked for a tool. After that the choice is remembered.
      activeTool: null,
      toolWidth: TOOL_WIDTH_DEFAULT,
      gitSplit: GIT_SPLIT_DEFAULT,
      // Side by side is the default: it is what makes a reindent or a rename readable, and the
      // interleaved form is the one to fall back to in a narrow window.
      diffSplit: true,
      statusLayout: defaultLayout(),
      locale: DEFAULT_LOCALE,
      shortcuts: defaultBindings(),
      filesShowHidden: false,
      aboutOpen: false,

      setView: (view) => set({ view }),
      toggleTool: (tool) => set((s) => ({ activeTool: s.activeTool === tool ? null : tool })),
      setToolWidth: (px) => set({ toolWidth: clampWidth(px) }),
      setGitSplit: (percent) => set({ gitSplit: clampSplit(percent) }),
      setDiffSplit: (diffSplit) => set({ diffSplit }),
      // Sanitised HERE rather than at render time: one gate on the way in beats every consumer
      // defending itself against a payload it did not write (rule:code-quality).
      setStatusLayout: (items) =>
        set({ statusLayout: items.length === 0 ? [] : sanitiseLayout(items) }),
      resetStatusLayout: () => set({ statusLayout: defaultLayout() }),
      setLocale: (locale) => set({ locale }),
      setShortcut: (action, binding) =>
        set((s) => ({ shortcuts: sanitiseBindings({ ...s.shortcuts, [action]: binding }) })),
      resetShortcuts: () => set({ shortcuts: defaultBindings() }),
      toggleFilesHidden: () => set((s) => ({ filesShowHidden: !s.filesShowHidden })),
      setAboutOpen: (aboutOpen) => set({ aboutOpen }),
    }),
    {
      name: "app-ui",
      // Schema version for the Zustand-persist middleware (NOT the app version — that lives in
      // package.json and follows SemVer per ADR-CORE-024). Bump whenever the `partialize` shape changes
      // *incompatibly*, so any previously-stored payload is discarded and the defaults above apply.
      // Adding a field is compatible — persist merges over the initial state, so a payload written by
      // an older build simply keeps the new field's default. Discarding it would throw away the user's
      // view for no reason.
      // 1: { view }, then additively { activeTool, toolWidth, gitSplit, diffSplit }
      version: 1,
      partialize: (s) => ({
        view: s.view,
        activeTool: s.activeTool,
        toolWidth: s.toolWidth,
        gitSplit: s.gitSplit,
        diffSplit: s.diffSplit,
        statusLayout: s.statusLayout,
        locale: s.locale,
        shortcuts: s.shortcuts,
        filesShowHidden: s.filesShowHidden,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // A persisted "home" from an older build is no longer a view; it falls back to the terminal
        // rather than to a blank screen.
        if (!VIEWS.includes(state.view)) state.view = "terminal";
        // Likewise for a tool that has since been removed or renamed: collapse rather than render
        // nothing in a column that is taking up space.
        if (state.activeTool !== null && !TOOLS.includes(state.activeTool)) state.activeTool = null;
        // A width outside the bounds — an older build's, or a hand-edited payload — would leave the
        // column unusable and unresizable.
        state.toolWidth = clampWidth(state.toolWidth);
        // Same reasoning for the divider: a payload from an older build has no share at all, and
        // `NaN` would collapse one of the two regions to nothing with no way to drag it back.
        state.gitSplit = Number.isFinite(state.gitSplit)
          ? clampSplit(state.gitSplit)
          : GIT_SPLIT_DEFAULT;
        // A payload from a build that predates the setting has no boolean at all.
        if (typeof state.diffSplit !== "boolean") state.diffSplit = true;
        // An empty bar is a legitimate choice and must survive a restart; `undefined` is a payload
        // from a build that predates the setting and gets the defaults (`sanitiseLayout`).
        // A language this build does not have — a downgrade, a hand-edited payload — would otherwise
        // put raw message keys on screen.
        if (!isLocale(state.locale)) state.locale = DEFAULT_LOCALE;
        // Also the gate against a hand-edited payload binding something the shell needs.
        state.shortcuts = sanitiseBindings(state.shortcuts);
        state.statusLayout = Array.isArray(state.statusLayout)
          ? state.statusLayout.length === 0
            ? []
            : sanitiseLayout(state.statusLayout)
          : defaultLayout();
      },
    },
  ),
);
