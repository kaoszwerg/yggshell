import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLogs } from "../hooks/useLogs";
import { useT } from "../hooks/useT";
import { useEscapeToTerminal } from "../hooks/useEscapeToTerminal";
import { useUiStore } from "../store/ui";
import { HudPanel } from "../components/ui/HudPanel";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { TextField } from "../components/ui/TextField";
import { PALETTE } from "../styles/palette";
import type { LogRecord } from "../bindings/LogRecord";

const LEVELS = ["ALL", "ERROR", "WARN", "INFO", "DEBUG"] as const;
type LevelFilter = (typeof LEVELS)[number];

const LEVEL_COLOR: Record<string, string> = {
  ERROR: PALETTE.danger,
  WARN: PALETTE.gold,
  INFO: PALETTE.cyan,
  DEBUG: PALETTE.dim,
  TRACE: PALETTE.dim,
};

/** Live log view: structured records streamed from the backend, with level filter, full-text search,
 * sort, pause and clear. */
export function LogsView() {
  const { logs, clear, paused, setPaused, error, isLoading } = useLogs();
  const [level, setLevel] = useState<LevelFilter>("ALL");
  const [q, setQ] = useState("");
  const [desc, setDesc] = useState(true);
  const t = useT();
  const setView = useUiStore((s) => s.setView);
  useEscapeToTerminal();

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = logs;
    if (level !== "ALL") out = out.filter((l) => l.level === level);
    if (needle) {
      out = out.filter((l) =>
        `${l.message} ${l.target} ${l.fields}`.toLowerCase().includes(needle),
      );
    }
    out = out.slice();
    if (desc) out.reverse();
    return out;
  }, [logs, level, q, desc]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <IconButton
            label={t("common.back")}
            variant="ghost"
            className="h-5 w-5 shrink-0"
            onClick={() => {
              setView("terminal");
            }}
          >
            <ArrowLeft size={13} aria-hidden />
          </IconButton>
          <h1 className="hud-label" style={{ "--hud-label-size": "1rem" } as React.CSSProperties}>
            Logs
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {LEVELS.map((l) => (
              <Button
                key={l}
                onClick={() => setLevel(l)}
                aria-pressed={level === l}
                active={level === l}
                className="px-2.5 py-1 text-xs tracking-wide"
              >
                {l}
              </Button>
            ))}
          </div>
          <TextField
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("common.search")}
            aria-label={t("logs.search")}
            className="w-40"
          />
          <Button
            onClick={() => setDesc((d) => !d)}
            tooltip={t("logs.sort")}
            className="px-2.5 py-1 text-xs"
          >
            {desc ? "newest" : "oldest"}
          </Button>
          <Button
            onClick={() => setPaused((p) => !p)}
            accent={paused ? "gold" : "green"}
            active={paused}
            className="px-2.5 py-1 text-xs"
          >
            {paused ? "paused" : "live"}
          </Button>
          <Button onClick={clear} accent="danger" className="px-2.5 py-1 text-xs">
            clear
          </Button>
        </div>
      </header>

      <HudPanel accent="cyan" label={t("logs.records", { count: rows.length })}>
        <div className="flex max-h-[calc(100vh-260px)] flex-col overflow-auto font-mono text-xs">
          {error ? (
            <p style={{ color: PALETTE.danger }}>{t("logs.failed", { message: error.message })}</p>
          ) : isLoading && logs.length === 0 ? (
            <p className="text-dim">{t("common.loading")}</p>
          ) : rows.length === 0 ? (
            <p className="text-dim">{t("logs.empty")}</p>
          ) : (
            rows.map((r, i) => <LogLine key={`${r.ts}-${i}`} rec={r} />)
          )}
        </div>
      </HudPanel>
    </div>
  );
}

function LogLine({ rec }: { rec: LogRecord }) {
  const color = LEVEL_COLOR[rec.level] ?? PALETTE.dim;
  const time = new Date(rec.ts);
  const ts = Number.isNaN(time.getTime()) ? rec.ts : time.toLocaleTimeString();
  return (
    <div className="border-elevated flex gap-2 border-b py-1 leading-relaxed">
      <span className="text-dim shrink-0">{ts}</span>
      <span className="w-12 shrink-0 font-bold" style={{ color }}>
        {rec.level}
      </span>
      <span className="min-w-0 flex-1 break-words">
        <span className="text-fg">{rec.message}</span> <Fields json={rec.fields} />
        {rec.target ? <span className="text-dim ml-2 text-[10px]">({rec.target})</span> : null}
      </span>
    </div>
  );
}

/** Inline key=value rendering of the JSON fields, lightly highlighted. */
function Fields({ json }: { json: string }) {
  if (!json || json === "{}") return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return <span className="text-dim">{json}</span>;
  }
  const entries = Object.entries(obj);
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map(([k, v]) => (
        <span key={k} className="mr-2 text-[10px]">
          <span className="text-cyan">{k}</span>
          <span className="text-dim">=</span>
          <span className="text-green">{typeof v === "string" ? v : JSON.stringify(v)}</span>
        </span>
      ))}
    </>
  );
}
