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
import { Activity, Bot, Folder, GitBranch, Layers, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { useBuildInfo } from "../../hooks/useBuildInfo";
import { useGitSnapshot } from "../../hooks/useGitSnapshot";
import { useSystemLoad } from "../../hooks/useSystemLoad";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";
import { useT } from "../../hooks/useT";
import { useAgentSession } from "../../hooks/useAgentSession";
import { formatTokens } from "../../lib/tokens";
import { APP_NAME } from "../../lib/app";
import { formatElapsed, formatLoad, loadPressure, shortPath } from "../../lib/statusFormat";
import type { StatusItemId } from "../../lib/statusBar";

/** How often a running command's elapsed time is redrawn. */
const TICK_MS = 1000;

/** The version, and the way into About — where it has always been. */
function VersionItem() {
  const { data: build } = useBuildInfo();
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  const t = useT();

  return (
    <Button
      variant="ghost"
      onClick={() => setAboutOpen(true)}
      tooltip={t("statusbar.about", { app: APP_NAME })}
    >
      {APP_NAME} {build ? `v${build.version}` : ""}
      {build ? (
        <span className="text-dim ml-1">
          ({build.git_sha}
          {build.git_dirty ? "+" : ""})
        </span>
      ) : null}
      {build?.channel === "dev" ? (
        <span className="text-gold ml-1">{t("common.devChannel")}</span>
      ) : null}
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
  const t = useT();
  const snapshot = query.data;
  if (!snapshot) return null;

  const ahead = snapshot.ahead;
  const behind = snapshot.behind;
  const changed = snapshot.changes.length;

  return (
    <Tooltip
      content={[
        snapshot.branch ?? t("statusbar.detached"),
        ...(ahead > 0 ? [t("statusbar.toPush", { count: ahead })] : []),
        ...(behind > 0 ? [t("statusbar.toPull", { count: behind })] : []),
        changed > 0 ? t("statusbar.changed", { count: changed }) : t("statusbar.clean"),
      ].join(" · ")}
    >
      <span className="flex items-center gap-1.5">
        <GitBranch size={11} strokeWidth={2} className="text-purple shrink-0" aria-hidden />
        <span className="text-fg">{snapshot.branch ?? t("statusbar.detached")}</span>
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
  const t = useT();
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
      <span className={failed ? "text-danger" : "text-green"}>
        {failed ? t("statusbar.failed") : t("statusbar.done")}
      </span>
    );
  }
  if (pane.activity !== "running") return null;

  return (
    <span className="flex items-center gap-1.5">
      <TerminalIcon size={11} strokeWidth={2} className="text-cyan shrink-0" aria-hidden />
      <span className="text-fg">{pane.command ?? t("statusbar.running")}</span>
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
  const t = useT();
  if (session === null) return null;

  return (
    <Tooltip content={t("statusbar.tmuxAttached", { session })}>
      <span className="flex items-center gap-1.5">
        <Layers size={11} strokeWidth={2} className="text-green shrink-0" aria-hidden />
        <span className="text-fg">{session}</span>
      </span>
    </Tooltip>
  );
}

/**
 * How busy the machine is.
 *
 * Shown as the one-minute load and, in the tooltip, all three windows with the core count — because
 * the bare number means nothing without it. The colour comes from the RATIO, so "busy" means the
 * same thing on a laptop and on a build machine.
 *
 * Renders nothing where the platform has no load average. Windows has none — not a smaller number,
 * none — and a zero there would read as a perfectly idle machine.
 */
function LoadItem() {
  const t = useT();
  const { data } = useSystemLoad();
  if (!data) return null;

  const pressure = loadPressure(data.one, data.cores);
  const colour =
    pressure === "saturated" ? "text-danger" : pressure === "busy" ? "text-gold" : "text-fg";

  return (
    <Tooltip
      content={t("statusbar.load", {
        value: formatLoad(data.one),
        cores: data.cores,
        one: formatLoad(data.one),
        five: formatLoad(data.five),
        fifteen: formatLoad(data.fifteen),
      })}
    >
      <span className="flex items-center gap-1.5">
        <Activity size={11} strokeWidth={2} className="text-dim shrink-0" aria-hidden />
        <span className={colour}>{formatLoad(data.one)}</span>
      </span>
    </Tooltip>
  );
}

/**
 * How much context the harness in this tab is carrying.
 *
 * **A count, never a percentage.** The transcript records how many tokens a turn carried and nowhere
 * records the size of the window they went into — a live session measured 530k, which is comfortable
 * in a 1M window and impossible in a 200k one, with an identical model name in both cases. A
 * percentage against a guessed maximum is a number that looks precise and is not (`lib/tokens`).
 *
 * Renders nothing at all when no agent has run here, which is most tabs. An element that sat there
 * showing a dash would be spending the bar's width to say "not applicable".
 */
function AgentItem() {
  const t = useT();
  const { session } = useAgentSession();
  if (session === null || session.context_tokens === null) return null;

  return (
    <Tooltip
      content={t("statusbar.agent", {
        model: session.model ?? "?",
        turns: String(session.turns),
        written: formatTokens(session.output_tokens),
        account: session.home,
      })}
    >
      <span className="flex items-center gap-1.5">
        <Bot size={11} strokeWidth={2} className="text-dim shrink-0" aria-hidden />
        <span className="text-fg">{formatTokens(session.context_tokens)}</span>
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
    case "load":
      return <LoadItem />;
    case "agent":
      return <AgentItem />;
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
  const t = useT();
  switch (id) {
    case "version":
      return (
        <span className="text-fg">
          {APP_NAME} v0.0.0 <span className="text-gold">{t("common.devChannel")}</span>
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
    case "load":
      return (
        <span className="flex items-center gap-1.5">
          <Activity size={11} strokeWidth={2} className="text-dim shrink-0" aria-hidden />
          <span className="text-fg">1.4</span>
        </span>
      );
    case "agent":
      return (
        <span className="flex items-center gap-1.5">
          <Bot size={11} strokeWidth={2} className="text-dim shrink-0" aria-hidden />
          <span className="text-fg">128k</span>
        </span>
      );
    default:
      return null;
  }
}
