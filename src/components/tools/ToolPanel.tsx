import { useRef } from "react";
import { Splitter } from "../ui/Splitter";
import { GitTool } from "./GitTool";
import { TOOL_WIDTH_MAX, TOOL_WIDTH_MIN, useUiStore, type ToolId } from "../../store/ui";

/** What each tool calls itself in the column header and to a screen reader. A switch rather than a
 *  lookup table: a computed member access is an object-injection sink and the gate runs at
 *  --max-warnings 0. */
function toolLabel(tool: ToolId): string {
  switch (tool) {
    case "git":
      return "Git";
  }
}

/**
 * The tool column: its own region beside the navigation rail, resizable, collapsible
 * (ADR-PROJ-001 — the rail navigates, the tool renders here).
 *
 * It sits *next to* the terminal rather than replacing it, which is the entire point: you watch the
 * repository change while the harness in the terminal keeps working. Collapsed, it renders nothing at
 * all — no splitter either, because a handle for a pane that is not there is a control that does
 * nothing.
 */
export function ToolPanel() {
  const activeTool = useUiStore((s) => s.activeTool);
  const width = useUiStore((s) => s.toolWidth);
  const setToolWidth = useUiStore((s) => s.setToolWidth);
  const columnRef = useRef<HTMLElement>(null);

  if (activeTool === null) return null;

  const label = toolLabel(activeTool);

  return (
    <>
      <aside
        ref={columnRef}
        aria-label={label}
        style={{ width }}
        className="hud-strip flex shrink-0 flex-col overflow-hidden"
      >
        <header className="border-cyan/20 text-cyan flex h-6 shrink-0 items-center border-b px-2 font-mono text-[0.58rem] tracking-[0.18em]">
          {label.toUpperCase()}
        </header>
        {/* `min-h-0` and no scrolling of its own: a tool owns the scrolling inside it — the Git tool
            has two independently scrollable regions — and a scroll container wrapped around that
            would give the column a second scrollbar that moves both at once. */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTool === "git" ? <GitTool /> : null}
        </div>
      </aside>

      <Splitter
        label={`${label} panel width`}
        value={width}
        min={TOOL_WIDTH_MIN}
        max={TOOL_WIDTH_MAX}
        onChange={setToolWidth}
        // Measured from the column's own left edge, so the value is its width and not a screen
        // coordinate that shifts when the window moves.
        toValue={(x) => x - (columnRef.current?.getBoundingClientRect().left ?? 0)}
      />
    </>
  );
}
