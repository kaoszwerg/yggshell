import { useQuery } from "@tanstack/react-query";
import { GitBranch, RefreshCw } from "lucide-react";
import { gitApi } from "../../api/git";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import { PALETTE } from "../../styles/palette";
import { useTerminalStore } from "../../store/terminal";
import type { GitChange } from "../../bindings/GitChange";
import type { GitCommit } from "../../bindings/GitCommit";

/** How often the snapshot is re-read while the tool is open. A harness editing files should show up
 *  without the user asking, but reading a repository is not free — this is the compromise, and the
 *  refresh control is there for the moment it feels too slow. */
const REFRESH_MS = 4000;

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
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);

  const query = useQuery({
    queryKey: ["git", cwd],
    queryFn: () => (cwd === null ? Promise.resolve(null) : gitApi.snapshot(cwd)),
    enabled: cwd !== null,
    refetchInterval: REFRESH_MS,
  });

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

  return (
    <div className="flex flex-col gap-4 p-2 font-mono text-[0.66rem]">
      <Section
        label="BRANCH"
        action={
          <IconButton
            label="Refresh"
            variant="ghost"
            tooltip={null}
            className="h-4 w-4"
            onClick={() => void query.refetch()}
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

      <Section label={`CHANGED · ${snapshot.changes.length}`}>
        {snapshot.changes.length === 0 ? (
          <span className="text-dim/60">Working tree clean.</span>
        ) : (
          snapshot.changes.map((change) => <ChangeRow key={changeKey(change)} change={change} />)
        )}
      </Section>

      <Section label="HISTORY">
        <History commits={snapshot.commits} />
      </Section>
    </div>
  );
}

/** A path can appear twice — staged and unstaged — and they are different rows. */
const changeKey = (c: GitChange) => `${c.staged ? "s" : "w"}:${c.path}`;

function ChangeRow({ change }: { change: GitChange }) {
  const { mark, className } = changeMark(change.status);
  return (
    // The full path in a HUD tooltip, because the column is narrow and the interesting part of a
    // path is usually the end that got truncated.
    <Tooltip content={change.path}>
      <div className="flex items-baseline gap-1.5">
        <span className={`w-3 shrink-0 ${className}`} aria-hidden>
          {mark}
        </span>
        <span className={`truncate ${change.staged ? "text-fg" : "text-dim"}`}>{change.path}</span>
        {change.staged ? (
          <span className="text-green/60 shrink-0 text-[0.55rem]">staged</span>
        ) : null}
      </div>
    </Tooltip>
  );
}

/**
 * The history, drawn rather than listed.
 *
 * Lanes are assigned as the walk proceeds: a commit takes the lane its child reserved for it, and a
 * merge reserves a new lane for its second parent. That is what makes a branch visible as a branch —
 * a column of shas says nothing about how the work came together.
 */
function History({ commits }: { commits: GitCommit[] }) {
  if (commits.length === 0) return <span className="text-dim/60">No commits yet.</span>;

  // Lane reservations: sha -> lane, filled in by whichever commit refers to it first.
  const lanes = new Map<string, number>();
  let nextLane = 0;
  const rows = commits.map((commit) => {
    const lane = lanes.get(commit.sha) ?? nextLane++;
    lanes.set(commit.sha, lane);
    // The first parent continues this lane; any further parent is a merged branch and gets its own.
    commit.parents.forEach((parent, index) => {
      if (lanes.has(parent)) return;
      lanes.set(parent, index === 0 ? lane : nextLane++);
    });
    return { commit, lane, merge: commit.parents.length > 1 };
  });

  const width = Math.min(4, nextLane) * 9 + 10;

  return (
    <div className="flex flex-col gap-px">
      {rows.map(({ commit, lane, merge }, index) => (
        <div key={commit.sha} className="flex items-center gap-1.5">
          <Lane
            width={width}
            lane={lane}
            merge={merge}
            head={index === 0}
            last={index === rows.length - 1}
          />
          <span className="text-cyan/60 shrink-0">{commit.short_sha}</span>
          <span className={`truncate ${index === 0 ? "text-fg" : "text-dim"}`}>
            {commit.summary}
          </span>
          {commit.refs.map((ref) => (
            <span
              key={ref}
              className="hud-clip-sm bg-elevated text-green shrink-0 px-1 text-[0.55rem]"
            >
              {ref}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Lane({
  width,
  lane,
  merge,
  head,
  last,
}: {
  width: number;
  lane: number;
  merge: boolean;
  head: boolean;
  last: boolean;
}) {
  // Canvas-free and hand-drawn, because it is four line segments — a charting library for this would
  // be a dependency to draw a dot on a line.
  const x = 5 + Math.min(lane, 3) * 9;
  const colour = head ? PALETTE.green : merge ? PALETTE.purple : PALETTE.cyan;
  return (
    <svg
      width={width}
      height={14}
      viewBox={`0 0 ${width} 14`}
      className="shrink-0"
      aria-hidden
      focusable="false"
    >
      <line x1={x} y1={0} x2={x} y2={7} stroke={colour} strokeWidth={1.5} opacity={0.5} />
      {last ? null : (
        <line x1={x} y1={7} x2={x} y2={14} stroke={colour} strokeWidth={1.5} opacity={0.5} />
      )}
      {merge ? (
        <path
          d={`M${x} 7 C${x + 5} 7, ${x + 5} 14, ${x + 9} 14`}
          stroke={PALETTE.purple}
          strokeWidth={1.5}
          fill="none"
          opacity={0.7}
        />
      ) : null}
      <circle cx={x} cy={7} r={head ? 3 : 2.2} fill={colour} />
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
