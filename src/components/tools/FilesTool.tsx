import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Link2 } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { ContextMenu } from "../ui/ContextMenu";
import { Row } from "../ui/Row";
import { filesApi } from "../../api/files";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";
import { useT } from "../../hooks/useT";
import { useContentFontSize } from "../../hooks/useContentFontSize";
import { humanSize } from "../../lib/humanSize";
import type { DirEntry } from "../../bindings/DirEntry";

/** How deep a nested folder is indented, in pixels per level. */
const INDENT = 12;

/**
 * The file browser — the tree of the terminal tab's own working directory.
 *
 * **Rooted at the tab, and it follows the tab.** The root is the directory the shell reports over
 * OSC 7, the same source the Git tool uses, so a `cd` moves the tree rather than leaving it pointing
 * at wherever the app started. That is also the security boundary: the backend refuses to list
 * anything outside it, so this cannot become a way to walk the filesystem (rule:security).
 *
 * **One directory per open, never a recursive walk.** A tree that fetched everything up front would
 * read `node_modules` before it drew a single row, and would be stale the moment a file changed.
 * Each folder is fetched when it is expanded and refetched when it is reopened.
 *
 * **What it does with a file is deliberately small**: reveal it in the file manager, copy its path.
 * Both are things you would otherwise leave the app for. It does not open, rename, move or delete —
 * a file manager sitting next to an agent that edits files is a combination nobody asked for, and
 * the same reason the Git tool is read-only.
 */

/**
 * How often an open directory re-reads while it is on screen.
 *
 * A build, a `git checkout` or an `rm` rewrites a tree without telling anyone, and a file list that
 * is minutes old is worse than none — it looks current. Four seconds while visible; nothing while
 * the panel is closed or the window hidden.
 */
const REFRESH_MS = 4_000;

export function FilesTool() {
  const t = useT();
  const root = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);
  const showHidden = useUiStore((s) => s.filesShowHidden);
  const fontSize = useContentFontSize();
  const toggleHidden = useUiStore((s) => s.toggleFilesHidden);

  if (root === null) {
    return (
      <Empty>
        {t("files.waitingForCwd")}
        <br />
        <span className="text-dim/70">{t("git.noOsc7")}</span>
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-cyan/15 flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <Folder size={13} className="text-cyan shrink-0" aria-hidden />
        <span className="text-fg min-w-0 flex-1 truncate font-mono text-[11px]" dir="rtl">
          {root}
        </span>
        <IconButton
          label={showHidden ? t("files.hideHidden") : t("files.showHidden")}
          onClick={toggleHidden}
          variant="ghost"
          active={showHidden}
          className="h-5 w-5 shrink-0"
        >
          {showHidden ? <FolderOpen size={12} aria-hidden /> : <Folder size={12} aria-hidden />}
        </IconButton>
      </header>
      <div
        className="min-h-0 flex-1 overflow-auto py-1"
        // Content, not chrome: the tree is the same kind of reading as a terminal.
        style={{ fontSize: `${fontSize}px` }}
      >
        <Directory root={root} path={root} depth={0} showHidden={showHidden} />
      </div>
    </div>
  );
}

/**
 * One directory's contents.
 *
 * Recursive as a *component*, not as a fetch: an expanded child renders another `Directory`, which
 * runs its own query. Collapsing one unmounts it and its children, so a deep tree costs nothing once
 * it is closed again.
 */
function Directory({
  root,
  path,
  depth,
  showHidden,
}: {
  root: string;
  path: string;
  depth: number;
  showHidden: boolean;
}) {
  const t = useT();
  const query = useQuery({
    queryKey: ["files", root, path],
    queryFn: () => filesApi.list(root, path),
    // A directory the terminal is writing to changes without asking anyone. Only while the panel is
    // mounted and the window visible — TanStack stops an interval on both.
    refetchInterval: REFRESH_MS,
  });

  if (query.isPending) {
    return <Note depth={depth}>{t("files.reading")}</Note>;
  }
  if (query.isError) {
    // Named, not swallowed: a folder that vanished and a folder we may not read are different
    // problems, and only the message says which (rule:logging).
    return <Note depth={depth}>{String(query.error)}</Note>;
  }

  const all = query.data?.entries ?? [];
  const entries = showHidden ? all : all.filter((entry) => !entry.hidden);

  if (entries.length === 0) {
    return <Note depth={depth}>{all.length === 0 ? t("files.empty") : t("files.allHidden")}</Note>;
  }

  return (
    <>
      {entries.map((entry) => (
        <Entry key={entry.path} entry={entry} root={root} depth={depth} showHidden={showHidden} />
      ))}
      {query.data?.truncated === true ? <Note depth={depth}>{t("files.truncated")}</Note> : null}
    </>
  );
}

/** One row: a file, or a folder that can be opened. */
function Entry({
  entry,
  root,
  depth,
  showHidden,
}: {
  entry: DirEntry;
  root: string;
  depth: number;
  showHidden: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const activate = useCallback(() => {
    if (entry.directory) setOpen((was) => !was);
  }, [entry.directory]);

  const Icon = entry.symlink ? Link2 : entry.directory ? (open ? FolderOpen : Folder) : File;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <>
      <ContextMenu
        label={t("files.actions", { name: entry.name })}
        items={[
          {
            id: "reveal",
            label: t("files.reveal"),
            onSelect: () => {
              // try/catch AND .catch: an IPC call can fail synchronously when the bridge is absent
              // and asynchronously when the backend refuses — an escape from here reaches
              // `window.onerror` and puts the fatal screen over the interface (ADR-APP-032).
              try {
                void filesApi.reveal(root, entry.path).catch((error: unknown) => {
                  console.error("could not reveal", entry.path, error);
                });
              } catch (error) {
                console.error("could not reveal", entry.path, error);
              }
            },
          },
          {
            id: "copy",
            label: t("files.copyPath"),
            onSelect: () => {
              navigator.clipboard.writeText(entry.path).catch((error: unknown) => {
                console.warn("could not copy the path", error);
              });
            },
          },
        ]}
      >
        <Row
          label={entry.name}
          onActivate={activate}
          className="gap-1 font-mono text-[11px]"
          style={{ paddingLeft: `${depth * INDENT + 4}px` }}
        >
          {entry.directory ? (
            <Chevron size={11} className="text-dim shrink-0" aria-hidden />
          ) : (
            <span className="w-[11px] shrink-0" aria-hidden />
          )}
          <Icon
            size={11}
            className={`shrink-0 ${entry.directory ? "text-cyan" : "text-dim"}`}
            aria-hidden
          />
          <span className={`min-w-0 flex-1 truncate ${entry.hidden ? "text-dim" : "text-fg"}`}>
            {entry.name}
          </span>
          {entry.size === null || entry.size === undefined ? null : (
            <span className="text-dim/60 shrink-0 text-[10px]">{humanSize(entry.size)}</span>
          )}
        </Row>
      </ContextMenu>
      {entry.directory && open ? (
        <Directory root={root} path={entry.path} depth={depth + 1} showHidden={showHidden} />
      ) : null}
    </>
  );
}

function Note({ depth, children }: { depth: number; children: React.ReactNode }) {
  return (
    <p
      className="text-dim py-1 font-mono text-[10px]"
      style={{ paddingLeft: `${depth * INDENT + 20}px` }}
    >
      {children}
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-dim p-3 text-center font-mono text-[11px]">{children}</p>;
}
