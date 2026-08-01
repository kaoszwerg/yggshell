import { useQuery } from "@tanstack/react-query";
import { Activity, Network, RefreshCw } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { terminalApi } from "../../api/terminal";
import { useTerminalStore } from "../../store/terminal";
import { useT } from "../../hooks/useT";
import type { PortInfo } from "../../bindings/PortInfo";
import { stateColour } from "../../lib/processState";
import type { ProcessInfo } from "../../bindings/ProcessInfo";

/** Indentation per level of the process tree, in pixels. */
const INDENT = 10;

/**
 * What this tab is running, and what it has open.
 *
 * **The question it answers.** A harness starts a dev server, a watcher, a build; it scrolls away,
 * or the tab is closed, and nothing says any of it is still there. The next run then fails on a port
 * that is already taken, with an error naming neither the process nor the tab it came from.
 *
 * **Read on demand, never on a timer.** It costs a `ps` and an `lsof`, which have no business
 * running every few seconds behind a panel nobody is looking at. The refresh button is the contract:
 * what you see is what was true when you asked.
 *
 * **It shows; it does not act.** No stop button, no kill. The terminal is right there and already
 * has every signal a process understands — a button that ends a process from a panel, next to an
 * agent that starts them, is the combination this app keeps declining (ADR-PROJ-001 §5).
 */
export function ActivityTool() {
  const t = useT();
  const sessionId = useTerminalStore(
    (s) => s.panes.find((p) => p.key === s.activeKey)?.sessionId ?? null,
  );

  const query = useQuery({
    queryKey: ["activity", sessionId],
    queryFn: () => (sessionId === null ? null : terminalApi.activity(sessionId)),
    enabled: sessionId !== null,
    // Never on its own. See the comment above — this is two process spawns per read.
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (sessionId === null) return <Empty>{t("activity.noSession")}</Empty>;

  const processes = query.data?.processes ?? [];
  const ports = query.data?.ports ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-cyan/15 flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <Activity size={13} className="text-cyan shrink-0" aria-hidden />
        <span className="text-dim min-w-0 flex-1 truncate font-mono text-[10px]">
          {query.data?.via_tmux === true ? t("activity.viaTmux") : t("activity.thisTab")}
        </span>
        <IconButton
          label={t("activity.refresh")}
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

      <div className="min-h-0 flex-1 overflow-auto">
        {query.isPending ? (
          <Empty>{t("activity.reading")}</Empty>
        ) : query.isError ? (
          // Named rather than swallowed: this reads the process table, and "may not" and "could not"
          // are different answers (rule:logging).
          <Empty>{String(query.error)}</Empty>
        ) : (
          <>
            <Section label={t("activity.ports")} count={ports.length}>
              {ports.length === 0 ? (
                <Note>{t("activity.noPorts")}</Note>
              ) : (
                ports.map((port) => <Port key={`${port.pid}:${port.port}`} port={port} />)
              )}
            </Section>
            <Section label={t("activity.processes")} count={processes.length}>
              {processes.length === 0 ? (
                <Note>{t("activity.noProcesses")}</Note>
              ) : (
                processes.map((process) => <Process key={process.pid} process={process} />)
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="py-1">
      <h3 className="text-dim px-2 py-0.5 font-mono text-[0.56rem] tracking-[0.12em]">
        {label.toUpperCase()} {count === 0 ? "" : `· ${count}`}
      </h3>
      {children}
    </section>
  );
}

/**
 * One listening port.
 *
 * The address is shown, not just the number: `*` means anything on the network can reach it and
 * `127.0.0.1` means only this machine can, which is the difference between a dev server and an
 * exposure.
 */
function Port({ port }: { port: PortInfo }) {
  return (
    <Row
      label={`${port.port} — ${port.command}`}
      onActivate={() => {
        navigator.clipboard.writeText(String(port.port)).catch((error: unknown) => {
          console.warn("could not copy the port", error);
        });
      }}
      className="gap-2 px-2 font-mono text-[11px]"
    >
      <Network size={11} className="text-green shrink-0" aria-hidden />
      <span className="text-fg w-12 shrink-0">{port.port}</span>
      <span className="text-dim min-w-0 flex-1 truncate">{port.command}</span>
      <span className="text-dim/60 shrink-0 text-[10px]">{port.address}</span>
    </Row>
  );
}

/** One process in the tree. */
function Process({ process }: { process: ProcessInfo }) {
  return (
    <Row
      label={`${process.pid} — ${process.command}`}
      onActivate={() => {
        navigator.clipboard.writeText(String(process.pid)).catch((error: unknown) => {
          console.warn("could not copy the pid", error);
        });
      }}
      className="gap-2 font-mono text-[11px]"
      style={{ paddingLeft: `${process.depth * INDENT + 8}px`, paddingRight: "8px" }}
    >
      <span className={`w-3 shrink-0 text-center ${stateColour(process.state)}`} aria-hidden>
        {process.state.slice(0, 1)}
      </span>
      <span className="text-fg min-w-0 flex-1 truncate">{process.command}</span>
      <span className="text-dim/60 shrink-0 text-[10px]">{process.elapsed}</span>
    </Row>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-dim px-2 py-1 font-mono text-[10px]">{children}</p>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-dim p-3 text-center font-mono text-[11px]">{children}</p>;
}
