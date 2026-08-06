import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, RefreshCw, ScrollText } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { dockerApi } from "../../api/docker";
import { useT } from "../../hooks/useT";
import { useToolFontSize } from "../../hooks/useContentFontSize";
import { stateColour } from "../../lib/containerState";
import type { ContainerInfo } from "../../bindings/ContainerInfo";
import type { ContainerStats } from "../../bindings/ContainerStats";
import { Meter } from "../ui/Meter";
import { humanSize } from "../../lib/humanSize";

/** How many log lines to fetch. Enough to see what went wrong, not enough to fill the panel. */
const LOG_LINES = 200;

/** How often the live figures are refreshed. The call itself takes ~2 s — see the query. */
const STATS_MS = 5_000;

/**
 * The Docker tool: what is up, what is not, and what it publishes.
 *
 * **Read-only, deliberately.** Starting or stopping a container is a command, and this app holds
 * that the webview never chooses what runs (ADR-PROJ-001 §5). A referenced action could be made to
 * satisfy that rule — but that is a change in what the app may do, and it belongs in an ADR with the
 * maintainer's name on it rather than in a widget that grew one. The terminal is right beside it.
 *
 * **The health verdict is shown verbatim.** `Up 3 hours (healthy)` and `Up 2 minutes (health:
 * starting)` are different situations, and reducing them to a green dot loses the one that means
 * "wait" and the one that means "look at it".
 */
export function DockerTool() {
  const t = useT();
  const fontSize = useToolFontSize();
  const query = useQuery({
    queryKey: ["docker"],
    queryFn: () => dockerApi.containers(),
    // On demand: this shells out to the daemon, and a panel nobody is looking at must not poll it.
    // The LIST, on the same cadence as the stats beside it: a container that has just started is
    // exactly what you open this panel to see, and it appeared nowhere until somebody pressed
    // refresh. Only while the panel is mounted and the window visible.
    refetchInterval: STATS_MS,
  });

  /**
   * Live CPU and memory, polled **only while this panel is mounted** — which `ToolPanel` guarantees,
   * because it renders exactly one tool and nothing when none is open.
   *
   * **The opposite decision to the attention signal, deliberately** (rule:attention-signals). That one
   * has to keep polling while the window is hidden, because its whole job is to reach somebody who is
   * looking elsewhere. This one is a monitor: a figure nobody is looking at is just heat. So it stops
   * with the panel, and it stops again when the window is hidden — which is Query's default, and the
   * one query in this app that overrides it is the other one.
   *
   * **Five seconds, and the number is not arbitrary:** the call itself takes ~2 s, because
   * `docker stats` samples twice to work out a CPU delta. Anything under about four would mean a
   * `docker` process running more often than not.
   */
  const stats = useQuery({
    queryKey: ["docker-stats"],
    queryFn: () => dockerApi.stats(),
    refetchInterval: STATS_MS,
    refetchOnWindowFocus: false,
  });

  const containers = query.data ?? [];
  const usage = new Map((stats.data ?? []).map((s) => [s.id, s]));
  const groups = new Map<string, ContainerInfo[]>();
  for (const container of containers) {
    const key = container.project ?? "";
    groups.set(key, [...(groups.get(key) ?? []), container]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-cyan/15 flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <Box size={13} className="text-cyan shrink-0" aria-hidden />
        <span className="text-dim min-w-0 flex-1 truncate font-mono text-[10px]">
          {t("docker.count", { count: String(containers.length) })}
        </span>
        <IconButton
          label={t("docker.refresh")}
          onClick={() => void query.refetch()}
          variant="ghost"
          className="h-5 w-5 shrink-0"
        >
          <RefreshCw
            size={12}
            aria-hidden
            className={query.isFetching ? "animate-spin" : undefined}
          />
        </IconButton>
      </header>

      <div
        className="min-h-0 flex-1 overflow-auto py-1"
        // Content, not chrome — container names and logs read like a terminal.
        style={{ fontSize: `${fontSize}px` }}
      >
        {query.isPending ? (
          <Empty>{t("docker.reading")}</Empty>
        ) : query.isError ? (
          <Empty>{String(query.error)}</Empty>
        ) : containers.length === 0 ? (
          // Not an error: plenty of machines have no Docker and plenty of projects never use it.
          <Empty>{t("docker.none")}</Empty>
        ) : (
          [...groups.entries()].map(([project, list]) => (
            <section key={project} className="pb-1">
              <h3 className="text-dim px-2 py-0.5 font-mono text-[0.56rem] tracking-[0.12em]">
                {(project === "" ? t("docker.noProject") : project).toUpperCase()}
              </h3>
              {list.map((container) => (
                <Container
                  key={container.id}
                  container={container}
                  usage={usage.get(container.id) ?? null}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function Container({
  container,
  usage,
}: {
  container: ContainerInfo;
  usage: ContainerStats | null;
}) {
  const t = useT();
  const [showLogs, setShowLogs] = useState(false);
  const logs = useQuery({
    queryKey: ["docker-logs", container.id],
    queryFn: () => dockerApi.logs(container.id, LOG_LINES),
    enabled: showLogs,
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  return (
    <>
      <Row
        label={`${container.name} — ${container.status}`}
        onActivate={() => setShowLogs((was) => !was)}
        // Content: the row takes the size the scroll region carries (rule:content-size).
        className="gap-2 px-2 font-mono"
      >
        <span className={`shrink-0 ${stateColour(container.state)}`} aria-hidden>
          ●
        </span>
        <span className="text-fg min-w-0 flex-1 truncate">{container.name}</span>
        {container.ports.map((port) => (
          <span key={port} className="text-green shrink-0 text-[0.85em]">
            {port}
          </span>
        ))}
        <ScrollText size={10} className="text-dim/50 shrink-0" aria-hidden />
      </Row>
      <p className="text-dim/70 truncate px-2 pb-0.5 pl-7 font-mono text-[0.85em]">
        {container.status} · {container.image}
      </p>
      {usage === null ? null : <Usage usage={usage} />}
      {showLogs ? (
        <pre className="bg-elevated text-dim mx-2 mb-1 max-h-40 overflow-auto p-1 font-mono text-[0.85em] whitespace-pre-wrap">
          {logs.isPending ? t("docker.readingLogs") : (logs.data ?? "") || t("docker.noLogs")}
        </pre>
      ) : null}
    </>
  );
}

/**
 * What one container is consuming, as two bars.
 *
 * **Bars rather than graphs, and no history** — the maintainer's call, and the cheap one: a series
 * would need a buffer that survives tab switches, and the question a container monitor actually
 * answers ("is this one eating the machine right now") is a current value, not a shape over time.
 *
 * **CPU is scaled against one core**, which is what docker reports: a container using two cores says
 * 200 %. The bar clamps at 100 — the number beside it stays exact, so the bar never becomes the only
 * source and never lies about a figure it cannot draw.
 */
function Usage({ usage }: { usage: ContainerStats }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 px-2 pb-1 pl-7">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="text-dim/70 shrink-0 font-mono text-[0.85em]">{t("docker.cpu")}</span>
        <Meter percent={usage.cpu_percent} label={t("docker.cpu")} />
        <span className="text-dim shrink-0 font-mono text-[0.85em] tabular-nums">
          {usage.cpu_percent.toFixed(0)}%
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="text-dim/70 shrink-0 font-mono text-[0.85em]">{t("docker.memory")}</span>
        <Meter percent={usage.mem_percent} label={t("docker.memory")} />
        <span className="text-dim shrink-0 font-mono text-[0.85em] tabular-nums">
          {humanSize(usage.mem_used)}
        </span>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-dim p-3 text-center font-mono text-[0.9em]">{children}</p>;
}
