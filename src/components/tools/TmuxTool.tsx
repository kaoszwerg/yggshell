import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, Trash2, Pencil, ExternalLink } from "lucide-react";
import { Row } from "../ui/Row";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { TextField } from "../ui/TextField";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { terminalApi } from "../../api/terminal";
import { useTerminalStore } from "../../store/terminal";
import { useContentFontSize } from "../../hooks/useContentFontSize";
import { useT } from "../../hooks/useT";
import type { TmuxSession } from "../../bindings/TmuxSession";

/** How often the list refreshes while the tool is on screen. */
const POLL_MS = 4_000;

/**
 * The tmux sessions this machine is running, and what to do with them.
 *
 * **Why this tool exists, and it is not tidiness.** Closing a tab *detaches* — deliberately, so a
 * build survives the window looking at it — and since a new tab no longer reuses an old session
 * (`first_free` skips what the server holds), sessions only ever accumulate. Nothing else in the app
 * clears them, and nothing else even shows them. The feature that made "new" mean new is what made
 * this necessary.
 *
 * **It polls only while it is visible**, which is the opposite trade from the attention signal: that
 * one polls in the background precisely because its job is to reach someone looking elsewhere
 * (rule:attention-signals). This is a list you are reading. A `tmux list-sessions` every four seconds
 * for a panel nobody has open is wasted battery.
 */
export function TmuxTool() {
  const t = useT();
  const fontSize = useContentFontSize();
  const qc = useQueryClient();
  const panes = useTerminalStore((s) => s.panes);
  const openPane = useTerminalStore((s) => s.openPane);
  const setActive = useTerminalStore((s) => s.setActive);
  const renamePaneSession = useTerminalStore((s) => s.renamePaneSession);

  const [ending, setEnding] = useState<TmuxSession | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const sessions = useQuery({
    queryKey: ["tmux-sessions"],
    queryFn: terminalApi.sessions,
    refetchInterval: POLL_MS,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["tmux-sessions"] });

  const end = useMutation({
    mutationFn: (name: string) => terminalApi.killSession(name),
    onSuccess: refresh,
  });

  const rename = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => terminalApi.renameSession(from, to),
    onSuccess: (_result, { from, to }) => {
      // **The step without which renaming is a defect.** A tab remembers the session it was in; left
      // pointing at a name nobody has, it would create an empty session under that name on the next
      // start while the renamed one sat orphaned — exactly what the restore exists to prevent.
      renamePaneSession(from, to);
      refresh();
    },
  });

  const list = sessions.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto" style={{ fontSize }}>
        {sessions.isPending ? (
          <Note>{t("tmux.loading")}</Note>
        ) : list.length === 0 ? (
          <Note>{t("tmux.none")}</Note>
        ) : (
          list.map((session) => (
            <SessionRow
              key={session.name}
              session={session}
              openInTab={panes.find((p) => p.tmuxSession === session.name)?.key ?? null}
              renaming={renaming === session.name}
              draft={draft}
              onDraft={setDraft}
              onAttach={() => setActive(openPane(null, null, session.name))}
              onShow={(key) => setActive(key)}
              onStartRename={() => {
                setRenaming(session.name);
                setDraft(session.name);
              }}
              onCommitRename={() => {
                const to = draft.trim();
                setRenaming(null);
                if (to !== "" && to !== session.name) rename.mutate({ from: session.name, to });
              }}
              onCancelRename={() => setRenaming(null)}
              onEnd={() => setEnding(session)}
            />
          ))
        )}
      </div>

      {end.error === null && rename.error === null ? null : (
        <p className="text-danger px-2 py-1 font-mono text-[10px]">
          {String(end.error ?? rename.error)}
        </p>
      )}

      {ending === null ? null : (
        <ConfirmDialog
          label={t("tmux.end.title")}
          question={t("tmux.end.question", { session: ending.name })}
          detail={t("tmux.end.detail", { command: ending.command, windows: ending.windows })}
          confirmLabel={t("tmux.end.confirm")}
          cancelLabel={t("tmux.rename.cancel")}
          onConfirm={() => {
            end.mutate(ending.name);
            setEnding(null);
          }}
          onCancel={() => setEnding(null)}
        />
      )}
    </div>
  );
}

function SessionRow({
  session,
  openInTab,
  renaming,
  draft,
  onDraft,
  onAttach,
  onShow,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onEnd,
}: {
  session: TmuxSession;
  /** The tab already showing it, if any — attaching a second time would be one view, not two. */
  openInTab: string | null;
  renaming: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onAttach: () => void;
  onShow: (key: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onEnd: () => void;
}) {
  const t = useT();
  // Focus moved after mount rather than with `autoFocus`: the prop is banned by jsx-a11y because it
  // steals focus on page load. Here the field appears because the user asked for it, and putting the
  // caret in it is the correct answer — the same pattern `ConfirmDialog` uses.
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) fieldRef.current?.focus();
  }, [renaming]);

  if (renaming) {
    return (
      <div className="flex items-center gap-1 px-2 py-1">
        <TextField
          ref={fieldRef}
          aria-label={t("tmux.rename.label")}
          value={draft}
          className="font-mono"
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onCancelRename();
          }}
        />
        <Button onClick={onCommitRename} className="shrink-0 px-2 py-0.5 text-[10px]">
          {t("tmux.rename.save")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Row
        label={session.name}
        onActivate={openInTab === null ? onAttach : () => onShow(openInTab)}
        className="gap-2 px-2 font-mono"
      >
        {/* Green when a client is looking at it, dim when it is running unattended — which is the
            state this whole tool is about. */}
        <Layers
          size={13}
          className={`shrink-0 ${session.attached ? "text-green" : "text-dim/60"}`}
          aria-hidden
        />
        <span className="text-fg min-w-0 flex-1 truncate">{session.name}</span>
        {openInTab === null ? null : (
          <ExternalLink size={11} className="text-cyan shrink-0" aria-hidden />
        )}
        <IconButton
          label={t("tmux.rename.action", { session: session.name })}
          variant="ghost"
          tooltip={null}
          onClick={onStartRename}
          className="h-4 w-4 shrink-0 opacity-70 hover:opacity-100"
        >
          <Pencil size={11} />
        </IconButton>
        <IconButton
          label={t("tmux.end.action", { session: session.name })}
          variant="ghost"
          accent="danger"
          tooltip={null}
          onClick={onEnd}
          className="h-4 w-4 shrink-0 opacity-70 hover:opacity-100"
        >
          <Trash2 size={11} />
        </IconButton>
      </Row>
      {/* What is in it. Names alone are useless after a crash — `yggshell`, `yggshell-2`,
          `yggshell-3` say nothing about which one holds the build. */}
      <p className="text-dim/70 truncate px-2 pb-0.5 pl-7 font-mono text-[10px]">
        {session.command || t("tmux.idle")} · {t("tmux.windows", { count: session.windows })}
      </p>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-dim p-3 text-center font-mono text-[11px]">{children}</p>;
}
