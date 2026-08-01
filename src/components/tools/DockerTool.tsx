import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, RefreshCw, ScrollText } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { dockerApi } from "../../api/docker";
import { useT } from "../../hooks/useT";
import { stateColour } from "../../lib/containerState";
import type { ContainerInfo } from "../../bindings/ContainerInfo";

/** How many log lines to fetch. Enough to see what went wrong, not enough to fill the panel. */
const LOG_LINES = 200;

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
  const query = useQuery({
    queryKey: ["docker"],
    queryFn: () => dockerApi.containers(),
    // On demand: this shells out to the daemon, and a panel nobody is looking at must not poll it.
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const containers = query.data ?? [];
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

      <div className="min-h-0 flex-1 overflow-auto py-1">
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
                <Container key={container.id} container={container} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function Container({ container }: { container: ContainerInfo }) {
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
        className="gap-2 px-2 font-mono text-[11px]"
      >
        <span className={`shrink-0 ${stateColour(container.state)}`} aria-hidden>
          ●
        </span>
        <span className="text-fg min-w-0 flex-1 truncate">{container.name}</span>
        {container.ports.map((port) => (
          <span key={port} className="text-green shrink-0 text-[10px]">
            {port}
          </span>
        ))}
        <ScrollText size={10} className="text-dim/50 shrink-0" aria-hidden />
      </Row>
      <p className="text-dim/70 truncate px-2 pb-0.5 pl-7 font-mono text-[10px]">
        {container.status} · {container.image}
      </p>
      {showLogs ? (
        <pre className="bg-elevated text-dim mx-2 mb-1 max-h-40 overflow-auto p-1 font-mono text-[10px] whitespace-pre-wrap">
          {logs.isPending ? t("docker.readingLogs") : (logs.data ?? "") || t("docker.noLogs")}
        </pre>
      ) : null}
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-dim p-3 text-center font-mono text-[11px]">{children}</p>;
}
