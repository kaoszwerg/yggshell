import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Columns2, GitCommitHorizontal, X } from "lucide-react";
import { gitApi } from "../../api/git";
import { DiffView } from "../ui/DiffView";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore, type GitDetail } from "../../store/ui";
import { useSettings, useTerminalThemes } from "../../hooks/useSettings";
import { detailThemeId, resolveTheme, themeById } from "../../lib/terminalTheme";
import type { SyntaxScheme } from "../../lib/highlight";
import type { GitCommitDetail } from "../../bindings/GitCommitDetail";
import type { GitFileStat } from "../../bindings/GitFileStat";

/**
 * The Git tool's detail view: a file's diff, or a commit in full.
 *
 * It covers the terminal rather than replacing it — the widest surface in the window, which is what a
 * diff needs, while the shell underneath keeps running with whatever it was doing. Escape and the ×
 * both give the terminal back.
 *
 * Not a `dialog`: it is not modal, nothing behind it is disabled, and calling it one would promise a
 * focus trap that is deliberately absent. It does take focus on open, so a keystroke meant for the
 * panel cannot land in a terminal the user can no longer see.
 */
/** The scheme a detail view of `kind` is drawn in for this tab. See `detailThemeId` for the chain. */
function useDetailScheme(paneKey: string, kind: "diff" | "commit"): SyntaxScheme | null {
  const settings = useSettings();
  const themes = useTerminalThemes();
  const paneThemeId = useTerminalStore(
    (s) => s.panes.find((p) => p.key === paneKey)?.themeId ?? null,
  );
  const id = detailThemeId(kind, settings.data, paneThemeId);
  const theme = themeById(themes.data, id);
  if (theme === null) return null;
  return { id: theme.id, colours: resolveTheme(theme) };
}

export function GitDetailPanel({ paneKey }: { paneKey: string }) {
  // Everything here is THIS tab's. A tabbed, multiplexed terminal has a repository per tab as often
  // as not, and one panel for the whole window meant opening a diff in one tab and finding it laid
  // over another.
  const detail = useTerminalStore((s) => s.panes.find((p) => p.key === paneKey)?.detail ?? null);
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === paneKey)?.cwd ?? null);
  const setPaneDetail = useTerminalStore((s) => s.setPaneDetail);
  const show = useCallback(
    (next: GitDetail | null) => setPaneDetail(paneKey, next),
    [paneKey, setPaneDetail],
  );
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (detail === null) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      show(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, show]);

  if (detail === null || cwd === null) return null;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="region"
      aria-label="Git detail"
      // `hud-popover`, never `hud-panel`: that class pins `position: relative` (globals.css) so its
      // ::before can inset by 1px, which SILENTLY BEATS Tailwind's `absolute` — the panel then sits in
      // the flow underneath the terminal instead of over it, and with no height of its own the
      // `min-h-0 flex-1 overflow-auto` below never becomes a scroll container either. `hud-popover`
      // is the same chamfered border with `position` deliberately left to the caller.
      className="hud-popover hud-accent-cyan absolute inset-0 z-30 flex flex-col overflow-hidden outline-none"
    >
      <Content detail={detail} cwd={cwd} show={show} paneKey={paneKey} />
    </div>
  );
}

function Content({
  detail,
  cwd,
  show,
  paneKey,
}: {
  detail: GitDetail;
  cwd: string;
  show: (detail: GitDetail | null) => void;
  paneKey: string;
}) {
  if (detail.kind === "commit") {
    return <CommitContent rev={detail.rev} cwd={cwd} show={show} paneKey={paneKey} />;
  }
  return <DiffContent detail={detail} cwd={cwd} show={show} paneKey={paneKey} />;
}

/** Header shared by both views: what you are looking at, how to get out, and how to go back. */
function Header({
  // Not `title`: the gate rejects a `title` JSX attribute wherever it appears, because the native
  // tooltip is OS chrome (ADR-APP-026) — and it cannot tell our prop from that one. Nor should it.
  heading,
  subtitle,
  onBack,
  show,
  extra,
}: {
  heading: React.ReactNode;
  subtitle?: React.ReactNode;
  onBack?: () => void;
  show: (detail: GitDetail | null) => void;
  /** Controls that belong to this particular view, placed before the close button. */
  extra?: React.ReactNode;
}) {
  return (
    <header className="border-cyan/20 flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      {onBack ? (
        <IconButton label="Back to the commit" variant="ghost" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={2.5} />
        </IconButton>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-fg truncate font-mono text-xs">{heading}</div>
        {subtitle === undefined ? null : (
          <div className="text-dim truncate font-mono text-[0.62rem]">{subtitle}</div>
        )}
      </div>
      {extra}
      <IconButton label="Close" variant="ghost" accent="danger" onClick={() => show(null)}>
        <X size={14} strokeWidth={2.5} />
      </IconButton>
    </header>
  );
}

function DiffContent({
  detail,
  cwd,
  show,
  paneKey,
}: {
  detail: Extract<GitDetail, { kind: "file" | "commit-file" }>;
  cwd: string;
  show: (detail: GitDetail | null) => void;
  paneKey: string;
}) {
  const split = useUiStore((s) => s.diffSplit);
  const setSplit = useUiStore((s) => s.setDiffSplit);
  const scheme = useDetailScheme(paneKey, "diff");
  const inCommit = detail.kind === "commit-file";

  const query = useQuery({
    queryKey: ["git-diff", cwd, detail],
    queryFn: () =>
      inCommit
        ? gitApi.commitFileDiff(cwd, detail.rev, detail.path)
        : gitApi.fileDiff(cwd, detail.path, detail.staged),
  });

  return (
    <>
      <Header
        heading={detail.path}
        subtitle={
          inCommit
            ? `in ${detail.rev.slice(0, 7)}`
            : detail.staged
              ? "staged — HEAD vs. the index"
              : "unstaged — the index vs. the file on disk"
        }
        onBack={inCommit ? () => show({ kind: "commit", rev: detail.rev }) : undefined}
        show={show}
        extra={
          <IconButton
            label={split ? "Show as one column" : "Show side by side"}
            variant="ghost"
            active={split}
            onClick={() => setSplit(!split)}
          >
            <Columns2 size={14} strokeWidth={2.5} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {query.isPending ? (
          <p className="text-dim p-4 font-mono text-xs">Reading the diff…</p>
        ) : query.isError ? (
          <p className="text-danger p-4 font-mono text-xs">{String(query.error)}</p>
        ) : query.data === null || query.data === undefined ? (
          <p className="text-dim p-4 font-mono text-xs">
            That file is no longer in the repository.
          </p>
        ) : (
          <DiffView diff={query.data} split={split} scheme={scheme} />
        )}
      </div>
    </>
  );
}

function CommitContent({
  rev,
  cwd,
  show,
  paneKey,
}: {
  rev: string;
  cwd: string;
  show: (detail: GitDetail | null) => void;
  paneKey: string;
}) {
  const scheme = useDetailScheme(paneKey, "commit");
  const query = useQuery({
    queryKey: ["git-commit", cwd, rev],
    queryFn: () => gitApi.commit(cwd, rev),
  });

  return (
    <>
      <Header
        heading={
          <span className="flex items-center gap-1.5">
            <GitCommitHorizontal
              size={13}
              strokeWidth={2}
              className="text-cyan shrink-0"
              aria-hidden
            />
            {query.data?.summary ?? rev.slice(0, 7)}
          </span>
        }
        subtitle={query.data === null || query.data === undefined ? rev : commitLine(query.data)}
        show={show}
      />
      <div
        className="min-h-0 flex-1 overflow-auto p-3"
        // The commit view is prose and a file list rather than code, so the scheme reaches it as its
        // surface colours instead of as syntax colouring.
        style={
          scheme
            ? { backgroundColor: scheme.colours.background, color: scheme.colours.foreground }
            : undefined
        }
      >
        {query.isPending ? (
          <p className="text-dim font-mono text-xs">Reading the commit…</p>
        ) : query.isError ? (
          <p className="text-danger font-mono text-xs">{String(query.error)}</p>
        ) : query.data === null || query.data === undefined ? (
          <p className="text-dim font-mono text-xs">That commit is not in this repository.</p>
        ) : (
          <CommitBody rev={rev} detail={query.data} show={show} />
        )}
      </div>
    </>
  );
}

/** Author, date and parent on one line — the metadata you glance at, not the message you read. */
function commitLine(detail: GitCommitDetail): string {
  const when = new Date(detail.authored_at);
  const date = Number.isNaN(when.getTime()) ? detail.authored_at : when.toLocaleString();
  const parents = detail.parents.map((p) => p.slice(0, 7)).join(", ");
  return `${detail.author_name} · ${date}${parents === "" ? "" : ` · parent ${parents}`}`;
}

function CommitBody({
  rev,
  detail,
  show,
}: {
  rev: string;
  detail: GitCommitDetail;
  show: (detail: GitDetail | null) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {detail.refs.length === 0 ? null : (
        <div className="flex flex-wrap gap-1">
          {detail.refs.map((ref) => (
            <span
              key={ref}
              className="hud-clip-sm bg-elevated text-cyan px-1.5 py-0.5 font-mono text-[0.6rem]"
            >
              {ref}
            </span>
          ))}
        </div>
      )}

      {/* The whole message, wrapped — prose, unlike the code below it, and a commit body that is cut
          off is the one part of a commit nobody can reconstruct from anywhere else. */}
      <div className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
        <span className="text-fg">{detail.summary}</span>
        {detail.body === "" ? null : <span className="text-dim">{`\n\n${detail.body}`}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-dim text-[0.56rem] tracking-[0.12em]">
          {detail.files.length} FILE{detail.files.length === 1 ? "" : "S"}
        </span>
        {detail.files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            onOpen={() => show({ kind: "commit-file", rev, path: file.path })}
          />
        ))}
      </div>
    </div>
  );
}

function FileRow({ file, onOpen }: { file: GitFileStat; onOpen: () => void }) {
  return (
    <Row
      label={`${file.path} — ${file.status}`}
      onActivate={onOpen}
      className="gap-2 font-mono text-[0.68rem]"
    >
      <span className={`w-3 shrink-0 ${statusColour(file.status)}`} aria-hidden>
        {statusMark(file.status)}
      </span>
      <span className="text-dim min-w-0 flex-1 truncate">{file.path}</span>
      {file.binary ? (
        <span className="text-dim/60 shrink-0">binary</span>
      ) : (
        <>
          <span className="text-green shrink-0">+{file.added}</span>
          <span className="text-danger shrink-0">−{file.removed}</span>
        </>
      )}
    </Row>
  );
}

/** Spelled out rather than looked up: a computed member access is an object-injection sink and the
 *  gate runs at --max-warnings 0. Same vocabulary as the tool's change list. */
function statusMark(status: string): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return "M";
  }
}

function statusColour(status: string): string {
  switch (status) {
    case "added":
      return "text-green";
    case "deleted":
      return "text-danger";
    case "renamed":
      return "text-purple";
    default:
      return "text-gold";
  }
}
