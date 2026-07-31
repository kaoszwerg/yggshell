/**
 * The things that can sit in the status bar.
 *
 * One component per item, each responsible for its own data, so the bar itself only ever decides
 * *order*. That is what makes the item list in `lib/statusBar` the single place a new element is
 * declared: add an entry there and a case here, and it is draggable, storable and rendered.
 *
 * **Every item is allowed to render nothing.** The bar is chrome, not a report: a tab that is not in
 * a repository has no branch, a plain shell has no tmux session, an idle terminal is running nothing.
 * Showing "—" for each of those would fill the strip with absences.
 */
import { useEffect, useState } from "react";
import { GitBranch, Terminal as TerminalIcon, Folder, Layers } from "lucide-react";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { useBuildInfo } from "../../hooks/useBuildInfo";
import { useGitSnapshot } from "../../hooks/useGitSnapshot";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";
import { APP_NAME } from "../../lib/app";
import { formatElapsed, shortPath } from "../../lib/statusFormat";
import type { StatusItemId } from "../../lib/statusBar";

/** How often a running command's elapsed time is redrawn. */
const TICK_MS = 1000;

/** The version, and the way into About — where it has always been. */
function VersionItem() {
  const { data: build } = useBuildInfo();
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);

  return (
    <Button variant="ghost" onClick={() => setAboutOpen(true)} tooltip={`About ${APP_NAME}`}>
      {APP_NAME} {build ? `v${build.version}` : ""}
      {build ? (
        <span className="text-dim ml-1">
          ({build.git_sha}
          {build.git_dirty ? "+" : ""})
        </span>
      ) : null}
      {build?.channel === "dev" ? <span className="text-gold ml-1">· dev</span> : null}
    </Button>
  );
}

/**
 * The branch of the repository the tab in front is in, with what is unpushed and what has changed.
 *
 * It shares its query with the Git tool — same key, so opening the tool costs no second read — and
 * it is why the remote check is not tied to the tool being open any more: this shows the same
 * ahead/behind counts, and a count nobody refreshes goes quietly wrong (ADR-PROJ-002).
 */
function RepositoryItem() {
  const { query } = useGitSnapshot();
  const snapshot = query.data;
  if (!snapshot) return null;

  const ahead = snapshot.ahead;
  const behind = snapshot.behind;
  const changed = snapshot.changes.length;

  return (
    <Tooltip
      content={`${snapshot.branch ?? "detached"}${ahead > 0 ? ` · ${ahead} to push` : ""}${
        behind > 0 ? ` · ${behind} to pull` : ""
      }${changed > 0 ? ` · ${changed} changed` : " · clean"}`}
    >
      <span className="flex items-center gap-1.5">
        <GitBranch size={11} strokeWidth={2} className="text-purple shrink-0" aria-hidden />
        <span className="text-fg">{snapshot.branch ?? "detached"}</span>
        {ahead > 0 ? <span className="text-green">↑{ahead}</span> : null}
        {behind > 0 ? <span className="text-gold">↓{behind}</span> : null}
        {changed > 0 ? <span className="text-cyan">±{changed}</span> : null}
      </span>
    </Tooltip>
  );
}

/**
 * What the tab in front is running, and for how long.
 *
 * The name is only there inside tmux, which reports `#{pane_current_command}`. A plain shell's
 * OSC 133 says that *something* started and how it ended, never what — so this says "running"
 * rather than inventing a name it does not have.
 */
function CommandItem() {
  const pane = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey));
  const since = pane?.activitySince ?? null;
  const [now, setNow] = useState(() => Date.now());

  // Ticking only while something runs: a timer firing every second forever, to redraw nothing, is a
  // thing a laptop notices.
  //
  // The effect does NOT seed `now` for a newly started command — a synchronous setState in an effect
  // is a cascading render, and the lint rejects it. It needs no seeding: until the first tick lands,
  // `now` predates `since`, and `formatElapsed` clamps a negative span to `0:00` — which is exactly
  // what a command that started a moment ago has run for.
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [since]);

  if (!pane) return null;

  if (pane.activity === "ok" || pane.activity === "failed") {
    const failed = pane.activity === "failed";
    return (
      <span className={failed ? "text-danger" : "text-green"}>{failed ? "failed" : "done"}</span>
    );
  }
  if (pane.activity !== "running") return null;

  return (
    <span className="flex items-center gap-1.5">
      <TerminalIcon size={11} strokeWidth={2} className="text-cyan shrink-0" aria-hidden />
      <span className="text-fg">{pane.command ?? "running"}</span>
      {since === null ? null : <span className="text-dim">· {formatElapsed(now - since)}</span>}
    </span>
  );
}

/** Where the tab in front is, when its shell has said so. */
function CwdItem() {
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);
  if (cwd === null) return null;

  return (
    <Tooltip content={cwd}>
      <span className="flex items-center gap-1.5">
        <Folder size={11} strokeWidth={2} className="text-dim shrink-0" aria-hidden />
        <span className="text-fg">{shortPath(cwd)}</span>
      </span>
    </Tooltip>
  );
}

/** The tmux session this tab is attached to, if it is attached to one. */
function TmuxItem() {
  const session = useTerminalStore(
    (s) => s.panes.find((p) => p.key === s.activeKey)?.tmuxSession ?? null,
  );
  if (session === null) return null;

  return (
    <Tooltip content={`Attached to the tmux session “${session}”`}>
      <span className="flex items-center gap-1.5">
        <Layers size={11} strokeWidth={2} className="text-green shrink-0" aria-hidden />
        <span className="text-fg">{session}</span>
      </span>
    </Tooltip>
  );
}

/**
 * One item of the bar.
 *
 * Spacer and separator are drawn by the bar itself, not here: a spacer is a flex property of the
 * strip rather than something with content, and giving it a component would mean wrapping it in a
 * box that then has to be told to stretch.
 */
export function StatusItemView({ id }: { id: StatusItemId }) {
  switch (id) {
    case "version":
      return <VersionItem />;
    case "repository":
      return <RepositoryItem />;
    case "command":
      return <CommandItem />;
    case "cwd":
      return <CwdItem />;
    case "tmux":
      return <TmuxItem />;
    default:
      return null;
  }
}

/**
 * What an item looks like with something in it, for the editor's preview.
 *
 * Sample values rather than the live ones, and the reason is what a preview is FOR: it shows the
 * arrangement. Live data would leave the strip empty whenever nothing happened to be running —
 * precisely while somebody is arranging it — and would drag the Git query into the settings page to
 * do it.
 */
export function StatusItemSample({ id }: { id: StatusItemId }) {
  switch (id) {
    case "version":
      return (
        <span className="text-fg">
          {APP_NAME} v0.0.0 <span className="text-gold">· dev</span>
        </span>
      );
    case "repository":
      return (
        <span className="flex items-center gap-1.5">
          <GitBranch size={11} strokeWidth={2} className="text-purple shrink-0" aria-hidden />
          <span className="text-fg">main</span>
          <span className="text-green">↑2</span>
          <span className="text-cyan">±7</span>
        </span>
      );
    case "command":
      return (
        <span className="flex items-center gap-1.5">
          <TerminalIcon size={11} strokeWidth={2} className="text-cyan shrink-0" aria-hidden />
          <span className="text-fg">cargo</span>
          <span className="text-dim">· 0:12</span>
        </span>
      );
    case "cwd":
      return (
        <span className="flex items-center gap-1.5">
          <Folder size={11} strokeWidth={2} className="text-dim shrink-0" aria-hidden />
          <span className="text-fg">…/git/yggshell</span>
        </span>
      );
    case "tmux":
      return (
        <span className="flex items-center gap-1.5">
          <Layers size={11} strokeWidth={2} className="text-green shrink-0" aria-hidden />
          <span className="text-fg">work</span>
        </span>
      );
    default:
      return null;
  }
}
