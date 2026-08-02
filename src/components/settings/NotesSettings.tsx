import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { notesApi } from "../../api/notes";
import { humanSize } from "../../lib/humanSize";
import { useT } from "../../hooks/useT";

/**
 * Where the notes are kept, and the sentence that has to be said where the URL is typed.
 *
 * **The app cannot verify that the repository is private.** That needs an API call with a token it
 * deliberately never holds, and a check we could not perform honestly would be worse than none
 * (ADR-CORE-004). So it says so here, at the moment of the decision, rather than in a document nobody
 * opens — and it never creates a repository, because a creation flow would have to choose a
 * visibility and choosing wrong is silent and permanent (ADR-PROJ-004).
 *
 * **Empty means local-only, and with it empty nothing leaves the device.** Naming a remote IS the
 * opt-in `rule:privacy` requires; there is no separate switch that could be on by accident.
 */
export function NotesSettings() {
  const t = useT();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["notes-status"], queryFn: notesApi.status });
  const orphans = useQuery({ queryKey: ["notes-orphans"], queryFn: notesApi.orphans });

  const [remote, setRemote] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["notes-status"] });
    void qc.invalidateQueries({ queryKey: ["notes-orphans"] });
  };

  const connect = useMutation({
    mutationFn: () => notesApi.connect(remote ?? status.data?.remote ?? "", branch ?? ""),
    onSuccess: refresh,
  });
  const disconnect = useMutation({ mutationFn: notesApi.disconnect, onSuccess: refresh });
  const sync = useMutation({ mutationFn: notesApi.sync, onSuccess: refresh });
  const clean = useMutation({
    mutationFn: () => notesApi.clean((orphans.data ?? []).map((o) => o.key)),
    onSuccess: refresh,
  });

  const current = status.data;
  const orphanBytes = (orphans.data ?? []).reduce((sum, o) => sum + o.bytes, 0);

  return (
    <div className="flex flex-col gap-2 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-dim">{t("settings.notes.remote")}</span>
        <TextField
          value={remote ?? current?.remote ?? ""}
          onChange={(event) => {
            setRemote(event.target.value);
          }}
          placeholder="git@github.com:you/notes.git"
        />
      </label>
      {/* Said HERE, not in a document nobody opens: this is the moment the decision is made. */}
      <p className="text-dim/80 text-[10px] leading-relaxed">{t("settings.notes.remoteHint")}</p>

      <label className="flex flex-col gap-1">
        <span className="text-dim">{t("settings.notes.branch")}</span>
        <TextField
          value={branch ?? current?.branch ?? ""}
          onChange={(event) => {
            setBranch(event.target.value);
          }}
          placeholder="main"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          accent="green"
          onClick={() => {
            connect.mutate();
          }}
          disabled={connect.isPending}
        >
          {t("settings.notes.connect")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            sync.mutate();
          }}
          disabled={sync.isPending || current?.connected !== true}
        >
          {t("notes.sync.now")}
        </Button>
        <Button
          variant="ghost"
          accent="danger"
          onClick={() => {
            disconnect.mutate();
          }}
          disabled={(current?.remote ?? "") === ""}
        >
          {t("settings.notes.disconnect")}
        </Button>
      </div>

      {/* The honest half of "automatic": a sync that silently stopped three days ago is the failure
          this line exists to make impossible. git's own message, verbatim — "Permission denied
          (publickey)" is actionable where "sync failed" is not. */}
      <p className="text-dim font-mono text-[10px]">
        {current?.git_available === false
          ? t("notes.sync.noGit")
          : (current?.remote ?? "") === ""
            ? t("notes.sync.localOnly")
            : current?.last_error != null
              ? current.last_error
              : current?.last_sync == null
                ? t("notes.sync.never")
                : t("notes.sync.ok")}
      </p>

      {current?.path === undefined ? null : (
        // Shown, because a directory you cannot find is a directory you cannot back up.
        <p className="text-dim/70 font-mono text-[10px] break-all">
          {t("settings.notes.path")}: {current.path}
        </p>
      )}

      {(orphans.data ?? []).length === 0 ? null : (
        <div className="border-cyan/15 mt-1 flex flex-wrap items-center gap-2 border-t pt-2">
          <span className="text-dim font-mono text-[10px]">
            {t("settings.notes.orphans", {
              count: (orphans.data ?? []).length,
              size: humanSize(orphanBytes),
            })}
          </span>
          <Button
            variant="ghost"
            accent="danger"
            onClick={() => {
              clean.mutate();
            }}
          >
            {t("settings.notes.clean")}
          </Button>
        </div>
      )}

      {connect.error === null && sync.error === null && clean.error === null ? null : (
        <p className="text-danger font-mono text-[10px]">
          {String(connect.error ?? sync.error ?? clean.error)}
        </p>
      )}
    </div>
  );
}
