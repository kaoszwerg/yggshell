import { useRef } from "react";
import { Splitter } from "../ui/Splitter";
import { Tooltip } from "../ui/Tooltip";
import { repositoryName, useGitSnapshot } from "../../hooks/useGitSnapshot";
import { useT } from "../../hooks/useT";
import type { MessageKey } from "../../i18n";
import { ActivityTool } from "./ActivityTool";
import { TmuxTool } from "./TmuxTool";
import { NotesTool } from "./NotesTool";
import { AgentTool } from "./AgentTool";
import { DockerTool } from "./DockerTool";
import { FilesTool } from "./FilesTool";
import { GitTool } from "./GitTool";
import { TOOL_WIDTH_MAX, TOOL_WIDTH_MIN, useUiStore, type ToolId } from "../../store/ui";

/** What each tool calls itself in the column header and to a screen reader. A switch rather than a
 *  lookup table: a computed member access is an object-injection sink and the gate runs at
 *  --max-warnings 0. */
function toolLabelKey(tool: ToolId): MessageKey {
  switch (tool) {
    case "git":
      return "nav.git";
    case "files":
      return "nav.files";
    case "activity":
      return "nav.activity";
    case "docker":
      return "nav.docker";
    case "agent":
      return "nav.agent";
    case "tmux":
      return "nav.tmux";
    case "notes":
      return "nav.notes";
  }
}

/**
 * Which repository the Git tool is showing, beside the column's own name.
 *
 * The branch alone does not say: `main` is `main` in every checkout, and this app is meant to have
 * several open at once. Read through the same hook the tool uses, so the header cannot name one
 * repository while the panel below it shows another.
 */
function RepositoryName() {
  const { query } = useGitSnapshot();
  const name = repositoryName(query.data?.root);
  if (name === null) return null;
  return (
    <>
      <span aria-hidden className="text-cyan/30 shrink-0">
        ·
      </span>
      {/* The full path in a tooltip: the column is narrow, and two checkouts of the same project have
          the same folder name. */}
      <Tooltip content={query.data?.root ?? name}>
        <span className="text-fg/80 truncate normal-case">{name}</span>
      </Tooltip>
    </>
  );
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
  const t = useT();

  if (activeTool === null) return null;

  const label = t(toolLabelKey(activeTool));

  return (
    <>
      <aside
        ref={columnRef}
        aria-label={label}
        style={{ width }}
        className="hud-strip flex shrink-0 flex-col overflow-hidden"
      >
        <header className="border-cyan/20 text-cyan flex h-6 shrink-0 items-center gap-1.5 border-b px-2 font-mono text-[0.58rem] tracking-[0.18em]">
          <span className="shrink-0">{label.toUpperCase()}</span>
          {activeTool === "git" ? <RepositoryName /> : null}
        </header>
        {/* `min-h-0` and no scrolling of its own: a tool owns the scrolling inside it — the Git tool
            has two independently scrollable regions — and a scroll container wrapped around that
            would give the column a second scrollbar that moves both at once.

            FLEX COLUMN, and that is the load-bearing part. This was a plain block, so a tool rooted
            with `flex-1` — which is all of them except Git — had no definite height at all: `flex-1`
            means nothing to a block-level child of a block container, so the root fell back to its
            content height, grew past this box, and `overflow-hidden` CLIPPED it. Every one of those
            tools looked like it simply refused to scroll, and the `overflow-auto` inside them never
            had a height to scroll against. Git was the exception only because it roots itself with
            `h-full`.
            Fixed here rather than by giving six tools `h-full`: the container is what owes its
            children a definite height. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTool === "git" ? <GitTool /> : null}
          {activeTool === "files" ? <FilesTool /> : null}
          {activeTool === "activity" ? <ActivityTool /> : null}
          {activeTool === "docker" ? <DockerTool /> : null}
          {activeTool === "agent" ? <AgentTool /> : null}
          {activeTool === "tmux" ? <TmuxTool /> : null}
          {activeTool === "notes" ? <NotesTool /> : null}
        </div>
      </aside>

      <Splitter
        label={t("nav.panelWidth", { tool: label })}
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
