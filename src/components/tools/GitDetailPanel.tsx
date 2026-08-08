import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Columns2, FileQuestion, FileText, GitCommitHorizontal, X } from "lucide-react";
import { gitApi } from "../../api/git";
import { Button } from "../ui/Button";
import { DiffView } from "../ui/DiffView";
import { ImageViewer, ZoomableImage } from "../ui/ImageViewer";
import { Markdown } from "../ui/Markdown";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { toDataUrl } from "../../lib/dataUrl";
import { humanSize } from "../../lib/humanSize";
import { useTerminalStore } from "../../store/terminal";
import { useT } from "../../hooks/useT";
import { useUiStore, type PaneDetail } from "../../store/ui";
import { useContentFontSize } from "../../hooks/useContentFontSize";
import { useDetailScheme } from "../../hooks/useDetailScheme";
import { surfaceStyle } from "../../lib/schemeSurface";
import { isMarkdown, languageFor, tokenize } from "../../lib/highlight";
import { filesApi } from "../../api/files";
import type { FilePreviewDto } from "../../bindings/FilePreviewDto";
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
/// A diff and a commit message are **reading surfaces**, so they follow the terminal's size — not the
/// tool column's.
///
/// **This has now been wrong in both directions, and the second time says where the line actually
/// runs.** It began as a private copy reading `terminal_font_size`; that was made shared, and then
/// moved onto the new `tool_font_size` on the reasoning that a panel in the tool column is tool
/// content. Reported from the running app: the detail panel came out too small, *"und das ist bei git
/// commit, git diff, markdown edit und markdown view/render ebenfalls so"*.
///
/// The distinction is not tool-versus-view, it is **reading versus scanning**. A dense column of
/// paths wants to be smaller than the thing you are sitting down to read — which is precisely why the
/// maintainer set the two settings to different numbers. See `useContentFontSize`.
function useDetailFontSize(): number {
  return useContentFontSize();
}

// `useDetailScheme` moved to `hooks/useDetailScheme` when the notes view became its third and fourth
// caller: one chain, one answer to "which scheme wins" (ADR-CORE-005).

export function GitDetailPanel({ paneKey }: { paneKey: string }) {
  const t = useT();
  // Everything here is THIS tab's. A tabbed, multiplexed terminal has a repository per tab as often
  // as not, and one panel for the whole window meant opening a diff in one tab and finding it laid
  // over another.
  const detail = useTerminalStore((s) => s.panes.find((p) => p.key === paneKey)?.detail ?? null);
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === paneKey)?.cwd ?? null);
  const setPaneDetail = useTerminalStore((s) => s.setPaneDetail);
  const show = useCallback(
    (next: PaneDetail | null) => setPaneDetail(paneKey, next),
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
      aria-label={t("git.detail")}
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
  detail: PaneDetail;
  cwd: string;
  show: (detail: PaneDetail | null) => void;
  paneKey: string;
}) {
  if (detail.kind === "commit") {
    return <CommitContent rev={detail.rev} cwd={cwd} show={show} paneKey={paneKey} />;
  }
  if (detail.kind === "text") {
    return <TextContent detail={detail} show={show} paneKey={paneKey} />;
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
  show: (detail: PaneDetail | null) => void;
  /** Controls that belong to this particular view, placed before the close button. */
  extra?: React.ReactNode;
}) {
  const t = useT();
  return (
    <header className="border-cyan/20 flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      {onBack ? (
        <IconButton label={t("git.backToCommit")} variant="ghost" onClick={onBack}>
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
      <IconButton
        label={t("common.close")}
        variant="ghost"
        accent="danger"
        onClick={() => show(null)}
      >
        <X size={14} strokeWidth={2.5} />
      </IconButton>
    </header>
  );
}

/**
 * A file from disk, read and highlighted — and nothing else.
 *
 * **Reading, never running.** Handing a path to the platform's default handler starts an application
 * chosen by the file; this does not. The file's type decides only which highlighter colours it, and
 * the backend refuses a directory, refuses anything binary, and caps what it reads.
 *
 * It reuses the diff's scheme and text size on purpose: the same setting that says how a diff is
 * drawn says how a file is, or the two would disagree side by side in the same panel.
 */
function TextContent({
  detail,
  show,
  paneKey,
}: {
  detail: Extract<PaneDetail, { kind: "text" }>;
  show: (detail: PaneDetail | null) => void;
  paneKey: string;
}) {
  const t = useT();
  const scheme = useDetailScheme(paneKey, "diff");
  const fontSize = useDetailFontSize();

  const query = useQuery({
    queryKey: ["file-preview", detail.root, detail.path],
    queryFn: () => filesApi.preview(detail.root, detail.path),
  });

  // **What the file turned out to be, decided in the backend.** The panel never guesses from an
  // extension: a `.png` full of zip bytes is not a picture, and a `.txt` that is really a JPEG is.
  const preview = query.data;
  const text: Extract<FilePreviewDto, { kind: "text" }> | undefined =
    preview !== undefined && preview.kind === "text" ? preview : undefined;

  const coloured = useQuery({
    // Keyed on WHEN the file was read, not on its contents: a two-megabyte string in a query key is
    // stringified for hashing on every render. `dataUpdatedAt` moves whenever the read above returns,
    // which is the same signal for a fraction of the cost.
    queryKey: ["highlight-file", detail.path, query.dataUpdatedAt, scheme?.id ?? "hud"],
    queryFn: () => tokenize(text?.text ?? "", languageFor(detail.path), scheme),
    enabled: text !== undefined,
  });

  // The lens is only offered where there is text to switch — a picture has no source view.
  const markdown = isMarkdown(detail.path) && preview?.kind !== "image";
  const rendered = markdown && detail.rendered === true;

  return (
    <>
      <Header
        heading={detail.path.split("/").pop() ?? detail.path}
        subtitle={detail.path}
        show={show}
        // **The lens lives on the panel, not only in the tree's menu.** Opening a document to find
        // out it is the wrong lens and having to walk back to the file list to say so is the friction
        // that stops anybody using the second lens at all. Only for markdown: a `.rs` has nothing to
        // render.
        extra={
          markdown ? (
            <IconButton
              label={rendered ? t("files.viewSource") : t("files.viewRendered")}
              variant="ghost"
              active={rendered}
              onClick={() => {
                show({ ...detail, rendered: !rendered });
              }}
            >
              <FileText size={13} strokeWidth={2.5} />
            </IconButton>
          ) : undefined
        }
      />
      {/* `scheme-surface` is what APPLIES the variables `surfaceStyle` sets — without it the nine
          custom properties sit on the element and nothing reads them, so the file drew on the HUD's
          panel background with the HUD's foreground, and syntax colours on the wrong background read
          as no highlighting at all. Reported as both at once, which is what it looked like. */}
      <div
        className="scheme-surface min-h-0 flex-1 overflow-auto"
        style={surfaceStyle(scheme, fontSize)}
      >
        {query.isPending ? (
          <p className="text-dim p-4 font-mono text-xs">{t("files.reading")}</p>
        ) : query.isError ? (
          // A real failure — gone, unreadable, outside the root. "Cannot be drawn here" is NOT one
          // of these any more; it arrives as a state below (rule:logging).
          <p className="text-dim p-4 font-mono text-xs">{String(query.error)}</p>
        ) : preview === undefined ? null : preview.kind === "image" ? (
          // **A picture, drawn.** This used to say "no image renderer, deliberately", on the grounds
          // that a "read any binary under root" command was a wider door than the feature was worth.
          // The door was already open — `read_text` reads every file under the root and only refuses
          // to *return* binary — and the command that replaced it is strictly narrower: same root
          // check, a size cap, and an allow-list of picture formats recognised by their first bytes.
          // No `assetProtocol` capability is involved, so the sandbox is exactly where it was
          // (ADR-PROJ-004).
          <ImageContent preview={preview} name={detail.path.split("/").pop() ?? detail.path} />
        ) : preview.kind === "unsupported" ? (
          <UnsupportedContent
            preview={preview}
            onOpen={() => {
              void filesApi.open(detail.root, detail.path).catch((error: unknown) => {
                console.error("could not open", detail.path, error);
              });
            }}
          />
        ) : (
          <>
            {rendered ? (
              <Markdown source={preview.text} scheme={scheme} className="px-3 py-2" />
            ) : (
              <pre className="px-2 py-1 font-mono leading-[1.5] wrap-anywhere whitespace-pre-wrap">
                {coloured.data === undefined
                  ? preview.text
                  : coloured.data.map((line, at) => (
                      <span key={at}>
                        {line.map((token, index) => (
                          <span
                            key={index}
                            style={token.color ? { color: token.color } : undefined}
                          >
                            {token.content}
                          </span>
                        ))}
                        {"\n"}
                      </span>
                    ))}
              </pre>
            )}
            {preview.truncated ? (
              // Said out loud: a file that silently stops is read as a file that ends there.
              <p className="scheme-meta px-2 py-1 font-mono text-[10px]">
                {t("files.fileTruncated")}
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/**
 * A picture from the tree, shown at its own size and zoomable.
 *
 * **The bytes come over IPC, not over a URL the webview resolves.** This app declares no
 * `assetProtocol` capability, so a `file://` in an `<img>` loads nothing — every byte reaches the
 * webview through a command confined to the tab's root (ADR-PROJ-004). The type is the one the
 * backend read out of the file's first bytes, never one guessed from the name here.
 *
 * `ZoomableImage` rather than a bare `<img>`: the picture is the affordance, so it is a primitive
 * (ADR-APP-026), and a raw element in a view is lint-rejected — rightly.
 */
function ImageContent({
  preview,
  name,
}: {
  preview: Extract<FilePreviewDto, { kind: "image" }>;
  name: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Built once per read rather than on every render: base64 of a multi-megabyte picture is not a
  // thing to redo because a parent re-rendered.
  const src = useMemo(() => toDataUrl(preview.bytes, preview.mime), [preview]);

  return (
    <div className="flex min-h-full items-center justify-center p-3">
      <ZoomableImage
        src={src}
        alt={name}
        label={t("files.imageOpen", { name })}
        onOpen={() => setOpen(true)}
        className="max-h-full max-w-full object-contain"
      />
      {open ? (
        <ImageViewer
          src={src}
          alt={name}
          caption={name}
          onClose={() => setOpen(false)}
          labels={{
            back: t("common.back"),
            zoomIn: t("notes.zoomIn"),
            zoomOut: t("notes.zoomOut"),
            fit: t("notes.zoomFit"),
            actual: t("notes.zoomActual"),
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A file this panel cannot draw — said as a state, not as an error.
 *
 * **The whole reason this component exists.** Opening a PDF used to print
 * *"…/spec.pdf is not a text file"*: true, addressed to nobody, and silent about what to do next. A
 * viewer that cannot show something owes the reader two facts — *what it is* and *what to do
 * instead* — and the second one is a button, because the platform handler is exactly the right
 * answer here and is one click away in the tree's own menu.
 */
function UnsupportedContent({
  preview,
  onOpen,
}: {
  preview: Extract<FilePreviewDto, { kind: "unsupported" }>;
  onOpen: () => void;
}) {
  const t = useT();
  const reason =
    preview.reason === "image_too_large" ? t("files.imageTooLarge") : t("files.notShowable");

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <FileQuestion size={28} strokeWidth={1.5} className="text-dim" />
      <p className="text-dim font-mono text-xs">{reason}</p>
      <p className="text-dim font-mono text-[10px]">{humanSize(preview.size)}</p>
      <Button variant="ghost" onClick={onOpen}>
        {t("files.open")}
      </Button>
    </div>
  );
}

function DiffContent({
  detail,
  cwd,
  show,
  paneKey,
}: {
  detail: Extract<PaneDetail, { kind: "file" | "commit-file" }>;
  cwd: string;
  show: (detail: PaneDetail | null) => void;
  paneKey: string;
}) {
  const t = useT();
  const split = useUiStore((s) => s.diffSplit);
  const setSplit = useUiStore((s) => s.setDiffSplit);
  const scheme = useDetailScheme(paneKey, "diff");
  const fontSize = useDetailFontSize();
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
            label={split ? t("git.oneColumn") : t("git.sideBySide")}
            variant="ghost"
            active={split}
            onClick={() => setSplit(!split)}
          >
            <Columns2 size={14} strokeWidth={2.5} />
          </IconButton>
        }
      />
      <div
        className="scheme-surface min-h-0 flex-1 overflow-auto"
        // The SCROLL container carries the scheme, not just the diff inside it. A diff shorter than
        // the panel left the rest showing the panel's own `bg-elevated` — two different backgrounds
        // meeting at the last line of the file, which is exactly what it looked like.
        style={surfaceStyle(scheme)}
      >
        {query.isPending ? (
          <p className="scheme-dim p-4 font-mono text-xs">{t("git.readingDiff")}</p>
        ) : query.isError ? (
          <p className="scheme-mark-del p-4 font-mono text-xs">{String(query.error)}</p>
        ) : query.data === null || query.data === undefined ? (
          <p className="scheme-dim p-4 font-mono text-xs">{t("diff.fileGone")}</p>
        ) : (
          <DiffView diff={query.data} split={split} scheme={scheme} fontSize={fontSize} />
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
  show: (detail: PaneDetail | null) => void;
  paneKey: string;
}) {
  const t = useT();
  const scheme = useDetailScheme(paneKey, "commit");
  const fontSize = useDetailFontSize();
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
        className="scheme-surface min-h-0 flex-1 overflow-auto p-3"
        // Prose and a file list rather than code, so the scheme reaches it as SURFACE colours — and as
        // the properties every child below draws from (lib/schemeSurface). Filling a scheme-coloured
        // surface with `text-fg`/`text-dim` is what made a light scheme unreadable: pale grey on
        // near-white, with the colours technically applied.
        style={surfaceStyle(scheme)}
      >
        {query.isPending ? (
          <p className="scheme-dim font-mono text-xs">{t("git.readingCommit")}</p>
        ) : query.isError ? (
          <p className="scheme-mark-del font-mono text-xs">{String(query.error)}</p>
        ) : query.data === null || query.data === undefined ? (
          <p className="scheme-dim font-mono text-xs">{t("git.commitMissing")}</p>
        ) : (
          <CommitBody rev={rev} detail={query.data} show={show} fontSize={fontSize} />
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
  fontSize,
}: {
  rev: string;
  detail: GitCommitDetail;
  show: (detail: PaneDetail | null) => void;
  fontSize: number;
}) {
  return (
    <div className="flex flex-col gap-4" style={{ fontSize: `${fontSize}px` }}>
      {detail.refs.length === 0 ? null : (
        <div className="flex flex-wrap gap-1">
          {detail.refs.map((ref) => (
            <span
              key={ref}
              className="hud-clip-sm scheme-meta px-1.5 py-0.5 font-mono text-[0.6rem]"
            >
              {ref}
            </span>
          ))}
        </div>
      )}

      {/* The whole message, wrapped — prose, unlike the code below it, and a commit body that is cut
          off is the one part of a commit nobody can reconstruct from anywhere else. */}
      <div className="font-mono leading-relaxed wrap-anywhere whitespace-pre-wrap">
        <span className="scheme-fg">{detail.summary}</span>
        {detail.body === "" ? null : <span className="scheme-dim">{`\n\n${detail.body}`}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <span className="scheme-dim text-[0.56rem] tracking-[0.12em]">
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
    <Row label={`${file.path} — ${file.status}`} onActivate={onOpen} className="gap-2 font-mono">
      <span className={`w-3 shrink-0 ${statusColour(file.status)}`} aria-hidden>
        {statusMark(file.status)}
      </span>
      <span className="scheme-dim min-w-0 flex-1 truncate">{file.path}</span>
      {file.binary ? (
        <span className="scheme-dim shrink-0 opacity-70">binary</span>
      ) : (
        <>
          <span className="scheme-mark-add shrink-0">+{file.added}</span>
          <span className="scheme-mark-del shrink-0">−{file.removed}</span>
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
      return "scheme-mark-add";
    case "deleted":
      return "scheme-mark-del";
    case "renamed":
      return "scheme-mark-alt";
    default:
      return "scheme-mark-warn";
  }
}
