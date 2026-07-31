// Global UI state (Zustand): active view, the tool column, and transient dialog flags.
import { create } from "zustand";
import { persist } from "zustand/middleware";

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
export type ToolId = "git";

const TOOLS: ToolId[] = ["git"];

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
  /** Whether the HUD About dialog is open (transient — not persisted). */
  aboutOpen: boolean;

  setView: (v: ViewId) => void;
  /** Show a tool. Choosing the one already shown collapses the column — the rail button is a toggle. */
  toggleTool: (t: ToolId) => void;
  setToolWidth: (px: number) => void;
  setGitSplit: (percent: number) => void;
  setDiffSplit: (split: boolean) => void;
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
      aboutOpen: false,

      setView: (view) => set({ view }),
      toggleTool: (tool) => set((s) => ({ activeTool: s.activeTool === tool ? null : tool })),
      setToolWidth: (px) => set({ toolWidth: clampWidth(px) }),
      setGitSplit: (percent) => set({ gitSplit: clampSplit(percent) }),
      setDiffSplit: (diffSplit) => set({ diffSplit }),
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
      },
    },
  ),
);
