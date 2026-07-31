import { useRef } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import { PALETTE } from "../../styles/palette";
import { layoutHistory, type GraphRow } from "../../lib/gitGraph";
import { Row } from "../ui/Row";
import { Splitter } from "../ui/Splitter";
import { useTerminalStore } from "../../store/terminal";
import { useGitSnapshot } from "../../hooks/useGitSnapshot";
import { GIT_SPLIT_MAX, GIT_SPLIT_MIN, useUiStore, type GitDetail } from "../../store/ui";
import type { GitChange } from "../../bindings/GitChange";
import type { GitCommit } from "../../bindings/GitCommit";
import type { GitSnapshot } from "../../bindings/GitSnapshot";

/** Status glyph and colour per change kind. Spelled out rather than looked up: a computed member
 *  access is an object-injection sink and the gate runs at --max-warnings 0. */
function changeMark(status: string): { mark: string; className: string } {
  switch (status) {
    case "added":
      return { mark: "A", className: "text-green" };
    case "deleted":
      return { mark: "D", className: "text-danger" };
    case "renamed":
      return { mark: "R", className: "text-purple" };
    case "untracked":
      return { mark: "?", className: "text-dim" };
    case "conflicted":
      return { mark: "!", className: "text-danger" };
    default:
      return { mark: "M", className: "text-gold" };
  }
}

/**
 * The Git tool — the reason the tool column exists (mem:project-scope): watching a repository change
 * while the harness in the terminal works on it.
 *
 * Read-only by design. The backend offers no way to stage, commit or check anything out; a button
 * that rewrites history sitting next to an agent that edits files is a combination nobody asked for.
 *
 * The repository comes from the **active terminal's** working directory, which the shell reports over
 * OSC 7 — so it follows a `cd` instead of being pinned to wherever the app happened to start.
 */
export function GitTool() {
  const { cwd, query } = useGitSnapshot();

  if (cwd === null) {
    return (
      <Empty>
        Waiting for the terminal to report where it is.
        <br />
        <span className="text-dim/70">
          A shell that does not send OSC 7 never will — see the shell integration.
        </span>
      </Empty>
    );
  }

  if (query.isPending) return <Empty>Reading the repository…</Empty>;

  if (query.isError) {
    // Surfaced, never swallowed (rule:logging). The message is the backend's, which already names
    // what it was trying to do.
    return <Empty tone="danger">{String(query.error)}</Empty>;
  }

  const snapshot = query.data;
  if (!snapshot) return <Empty>Not a git repository.</Empty>;

  return <Body snapshot={snapshot} onRefresh={() => void query.refetch()} />;
}

/**
 * The three regions, and why they are laid out the way they are.
 *
 * The branch is a fixed header: it is two lines whatever happens, so giving it a share of a scroll
 * area would only ever waste it. Changes and history are the two that genuinely compete — one is long
 * while you are working, the other while you are reviewing — so the user sets the balance and it is
 * remembered. Both scroll on their own, so neither can push the other off screen.
 */
function Body({ snapshot, onRefresh }: { snapshot: GitSnapshot; onRefresh: () => void }) {
  const split = useUiStore((s) => s.gitSplit);
  const setSplit = useUiStore((s) => s.setGitSplit);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The drag reports a share of this element's height, not a pixel offset — see `gitSplit`.
  const toShare = (clientY: number) => {
    const box = bodyRef.current?.getBoundingClientRect();
    if (!box || box.height === 0) return split;
    return ((clientY - box.top) / box.height) * 100;
  };

  return (
    <div className="flex h-full flex-col font-mono text-[0.66rem]">
      <div className="border-cyan/15 shrink-0 border-b p-2">
        <Section
          label="BRANCH"
          action={
            <IconButton
              label="Refresh"
              variant="ghost"
              tooltip={null}
              className="h-4 w-4"
              onClick={onRefresh}
            >
              <RefreshCw size={11} strokeWidth={2.5} />
            </IconButton>
          }
        >
          <div className="flex items-center gap-1.5">
            <GitBranch size={12} strokeWidth={2} className="text-green shrink-0" aria-hidden />
            <span className="text-green truncate">
              {snapshot.branch ?? `${snapshot.head ?? "?"} (detached)`}
            </span>
            {snapshot.ahead > 0 ? (
              <span className="text-gold shrink-0">↑{snapshot.ahead}</span>
            ) : null}
            {snapshot.behind > 0 ? (
              <span className="text-cyan shrink-0">↓{snapshot.behind}</span>
            ) : null}
          </div>
        </Section>
      </div>

      {/* `min-h-0` on the flex parent AND on each region: without it a flex child refuses to shrink
          below its content, the scroll never engages, and the whole column grows instead. */}
      <div ref={bodyRef} data-region="body" className="flex min-h-0 flex-1 flex-col">
        <div
          className="min-h-0 overflow-y-auto p-2"
          style={{ flex: `0 0 ${split}%` }}
          aria-label="Changed files"
        >
          <Section label={`CHANGED · ${snapshot.changes.length}`}>
            {snapshot.changes.length === 0 ? (
              <span className="text-dim/60">Working tree clean.</span>
            ) : (
              snapshot.changes.map((change) => (
                <ChangeRow key={changeKey(change)} change={change} />
              ))
            )}
          </Section>
        </div>

        <Splitter
          label="Changes and history"
          orientation="horizontal"
          value={split}
          min={GIT_SPLIT_MIN}
          max={GIT_SPLIT_MAX}
          onChange={setSplit}
          toValue={toShare}
        />

        <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Commit history">
          <Section label="HISTORY">
            <History commits={snapshot.commits} />
          </Section>
        </div>
      </div>
    </div>
  );
}

/** A path can appear twice — staged and unstaged — and they are different rows. */
const changeKey = (c: GitChange) => `${c.staged ? "s" : "w"}:${c.path}`;

function ChangeRow({ change }: { change: GitChange }) {
  const { mark, className } = changeMark(change.status);
  // Into the ACTIVE tab: the tool shows the repository the tab in front is in, so what it opens
  // belongs to that tab and travels with it.
  const activeKey = useTerminalStore((s) => s.activeKey);
  const setPaneDetail = useTerminalStore((s) => s.setPaneDetail);
  const shown = useTerminalStore((s) => {
    const detail = s.panes.find((p) => p.key === s.activeKey)?.detail;
    return (
      detail?.kind === "file" && detail.path === change.path && detail.staged === change.staged
    );
  });
  const show = (detail: GitDetail) => {
    if (activeKey !== null) setPaneDetail(activeKey, detail);
  };

  return (
    // The full path in a HUD tooltip, because the column is narrow and the interesting part of a
    // path is usually the end that got truncated.
    <Tooltip content={change.path}>
      <Row
        label={`${change.path} — ${change.status}${change.staged ? ", staged" : ""}`}
        selected={shown}
        onActivate={() => show({ kind: "file", path: change.path, staged: change.staged })}
      >
        <span className={`w-3 shrink-0 ${className}`} aria-hidden>
          {mark}
        </span>
        <span className={`truncate ${change.staged ? "text-fg" : "text-dim"}`}>{change.path}</span>
        {change.staged ? (
          <span className="text-green/60 shrink-0 text-[0.55rem]">staged</span>
        ) : null}
      </Row>
    </Tooltip>
  );
}

/** One hue per lane, cycled. Four distinct ones rather than a generated ramp: past four parallel
 *  branches in one window the colour stops carrying identity anyway, and four HUD hues stay
 *  distinguishable at 2px where an interpolated palette would not (rule:theming — these are the
 *  palette's own values, not new ones). */
const LANE_COLOURS = [PALETTE.cyan, PALETTE.green, PALETTE.gold, PALETTE.purple] as const;

const laneColour = (lane: number) => LANE_COLOURS.at(lane % LANE_COLOURS.length) ?? PALETTE.cyan;

/** Pixels per lane, and the height of one row. Small enough that four branches fit in a narrow
 *  column, large enough that two adjacent lines are still two lines. */
const LANE_STEP = 9;
const ROW_HEIGHT = 16;

/**
 * The history, drawn rather than listed — every local branch, not just the one you are on.
 *
 * The layout itself lives in `lib/gitGraph`, which is where it can be tested against shapes that
 * would be tedious to build in a real repository. This only draws what that returns.
 */
function History({ commits }: { commits: GitCommit[] }) {
  if (commits.length === 0) return <span className="text-dim/60">No commits yet.</span>;

  const { rows, lanes } = layoutHistory(commits);
  const width = lanes * LANE_STEP + 6;

  return (
    <div className="flex flex-col">
      {rows.map((row, index) => (
        <CommitRow key={row.commit.sha} row={row} width={width} last={index === rows.length - 1} />
      ))}
    </div>
  );
}

/** One commit in the graph. Clicking it opens the commit — the whole message and its files — in the
 *  detail panel over the terminal. */
function CommitRow({ row, width, last }: { row: GraphRow; width: number; last: boolean }) {
  const activeKey = useTerminalStore((s) => s.activeKey);
  const setPaneDetail = useTerminalStore((s) => s.setPaneDetail);
  const shown = useTerminalStore((s) => {
    const detail = s.panes.find((p) => p.key === s.activeKey)?.detail;
    return detail?.kind !== "file" && detail?.rev === row.commit.sha;
  });
  const show = (detail: GitDetail) => {
    if (activeKey !== null) setPaneDetail(activeKey, detail);
  };

  return (
    <Row
      label={`${row.commit.short_sha} ${row.commit.summary}`}
      selected={shown}
      onActivate={() => show({ kind: "commit", rev: row.commit.sha })}
      className="items-center px-0"
    >
      <Lane row={row} width={width} last={last} />
      <span className="shrink-0" style={{ color: `${laneColour(row.lane)}99` }}>
        {row.commit.short_sha}
      </span>
      <span className="text-dim truncate">{row.commit.summary}</span>
      {row.commit.refs.map((ref) => (
        <span
          key={ref}
          className="hud-clip-sm bg-elevated shrink-0 px-1 text-[0.55rem]"
          style={{ color: laneColour(row.lane) }}
        >
          {ref}
        </span>
      ))}
    </Row>
  );
}

/** The gutter for one row: the lines still running past it, this commit's dot, and any curve to a
 *  branch that joins or leaves here. */
function Lane({ row, width, last }: { row: GraphRow; width: number; last: boolean }) {
  const x = (lane: number) => 3 + lane * LANE_STEP;
  const mid = ROW_HEIGHT / 2;
  const tip = row.commit.refs.length > 0;

  return (
    <svg
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      className="shrink-0"
      aria-hidden
      focusable="false"
    >
      {row.through.map((lane) => (
        <line
          key={lane}
          x1={x(lane)}
          // The line above stops at the dot on this row's own lane and runs the full height on any
          // other — that is the difference between "this commit is on that branch" and "that branch
          // simply carries on past it".
          y1={0}
          x2={x(lane)}
          y2={lane === row.lane && last ? mid : ROW_HEIGHT}
          stroke={laneColour(lane)}
          strokeWidth={1.5}
          opacity={0.55}
        />
      ))}

      {row.links.map((link) => (
        <path
          key={`${link.from}-${link.to}`}
          d={`M${x(link.from)} ${mid} C${x(link.from)} ${ROW_HEIGHT}, ${x(link.to)} ${mid}, ${x(link.to)} ${ROW_HEIGHT}`}
          stroke={laneColour(link.to)}
          strokeWidth={1.5}
          fill="none"
          opacity={0.75}
        />
      ))}

      <circle
        cx={x(row.lane)}
        cy={mid}
        r={tip ? 3.2 : 2.2}
        fill={tip ? laneColour(row.lane) : PALETTE.deep}
        stroke={laneColour(row.lane)}
        strokeWidth={1.5}
      />
    </svg>
  );
}

function Section({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-dim text-[0.56rem] tracking-[0.12em]">{label}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children, tone }: { children: React.ReactNode; tone?: "danger" }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
      <GitBranch
        className={tone === "danger" ? "text-danger/40" : "text-cyan/30"}
        size={32}
        strokeWidth={1.25}
        aria-hidden
      />
      <p
        className={`font-mono text-xs leading-relaxed ${tone === "danger" ? "text-danger" : "text-dim"}`}
      >
        {children}
      </p>
    </div>
  );
}
