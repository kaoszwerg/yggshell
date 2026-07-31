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

export interface UiState {
  view: ViewId;
  /** The tool in the column, or `null` when the column is collapsed. */
  activeTool: ToolId | null;
  /** Width of the tool column in pixels. Remembered even while it is collapsed, so reopening it
   *  restores the size the user chose rather than a default. */
  toolWidth: number;
  /** Whether the HUD About dialog is open (transient — not persisted). */
  aboutOpen: boolean;

  setView: (v: ViewId) => void;
  /** Show a tool. Choosing the one already shown collapses the column — the rail button is a toggle. */
  toggleTool: (t: ToolId) => void;
  setToolWidth: (px: number) => void;
  setAboutOpen: (v: boolean) => void;
}

const clampWidth = (px: number) =>
  Math.min(TOOL_WIDTH_MAX, Math.max(TOOL_WIDTH_MIN, Math.round(px)));

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
      aboutOpen: false,

      setView: (view) => set({ view }),
      toggleTool: (tool) => set((s) => ({ activeTool: s.activeTool === tool ? null : tool })),
      setToolWidth: (px) => set({ toolWidth: clampWidth(px) }),
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
      // 1: { view }, then additively { activeTool, toolWidth }
      version: 1,
      partialize: (s) => ({ view: s.view, activeTool: s.activeTool, toolWidth: s.toolWidth }),
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
      },
    },
  ),
);
