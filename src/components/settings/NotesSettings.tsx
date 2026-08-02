import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { ConfirmDialog } from "../ui/ConfirmDialog";
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
  const orphans = useQuery({
    queryKey: ["notes-orphans"],
    queryFn: notesApi.orphans,
    // **Only after a successful pull**, and that is a data-safety rule rather than a refresh policy:
    // a note written on another machine and not yet pulled still refers to its image, and this
    // machine cannot see that note. Offering to delete it would be offering to break somebody else's
    // note (ADR-PROJ-004). Local-only is fine — there is no other machine to be behind.
    enabled:
      status.data?.last_error == null &&
      (status.data?.last_sync != null || (status.data?.remote ?? "") === ""),
  });

  // Seeded from what is STORED, and written back on every edit. They were local state saved only on
  // a successful connect, which left the fields looking empty after a failed attempt — with the text
  // the user had just typed gone. A field that only remembers when everything went well is a field
  // that lies the one time it matters.
  const [remote, setRemote] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["notes-status"] });
    void qc.invalidateQueries({ queryKey: ["notes-orphans"] });
  };

  const configure = useMutation({
    mutationFn: ({ url, on }: { url: string; on: string }) =>
      notesApi.configure(url, on, status.data?.sync ?? true),
    onSuccess: refresh,
  });
  const connect = useMutation({
    mutationFn: () =>
      notesApi.connect(remote ?? status.data?.remote ?? "", branch ?? status.data?.branch ?? ""),
    onSuccess: refresh,
  });
  const reset = useMutation({
    mutationFn: notesApi.reset,
    onSuccess: () => {
      setClearing(false);
      refresh();
    },
  });
  const disconnect = useMutation({ mutationFn: notesApi.disconnect, onSuccess: refresh });
  const sync = useMutation({ mutationFn: notesApi.sync, onSuccess: refresh });
  const clean = useMutation({
    mutationFn: () => notesApi.clean((orphans.data ?? []).map((o) => o.key)),
    onSuccess: refresh,
  });

  const current = status.data;
  const orphanBytes = (orphans.data ?? []).reduce((sum, o) => sum + o.bytes, 0);
  // What the user typed against what is actually connected. Connecting again with the same URL does
  // nothing useful, and a button that stays lit after it has done its job reads as "it did not work"
  // — which is how this was reported.
  const typed = (remote ?? current?.remote ?? "").trim();
  const connected = current?.connected === true && typed !== "" && typed === current.remote.trim();

  return (
    <div className="flex flex-col gap-2 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-dim">{t("settings.notes.remote")}</span>
        <TextField
          value={remote ?? current?.remote ?? ""}
          onChange={(event) => {
            setRemote(event.target.value);
          }}
          onBlur={(event) => {
            configure.mutate({ url: event.target.value, on: branch ?? status.data?.branch ?? "" });
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
          onBlur={(event) => {
            configure.mutate({ url: remote ?? status.data?.remote ?? "", on: event.target.value });
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
          disabled={connect.isPending || connected || typed === ""}
        >
          {connected ? t("settings.notes.connected") : t("settings.notes.connect")}
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
        {/* The escape hatch adoption needs: connecting ADOPTS whatever is already in the directory
            rather than clobbering it, which is right — and leaves a directory in a state you do not
            want with no way out from inside the app. This is that way out. */}
        <Button
          variant="ghost"
          accent="danger"
          onClick={() => {
            setClearing(true);
          }}
          disabled={current?.connected !== true && current?.path === undefined}
        >
          {t("settings.notes.clear")}
        </Button>
      </div>

      {!clearing ? null : (
        <ConfirmDialog
          label={t("settings.notes.clear.title")}
          question={t("settings.notes.clear.question")}
          detail={t("settings.notes.clear.detail", { path: current?.path ?? "" })}
          confirmLabel={t("settings.notes.clear.confirm")}
          cancelLabel={t("notes.cancel")}
          onConfirm={() => {
            reset.mutate();
          }}
          onCancel={() => {
            setClearing(false);
          }}
        />
      )}

      {/* The state, said outright. "Synced" alone never answered the question the user actually has,
          which is whether this thing is hooked up at all — reported as "it does not show that it is
          connected". */}
      <p className="font-mono text-[10px]">
        <span className={connected ? "text-green" : "text-dim"}>
          {connected ? t("settings.notes.isConnected") : t("settings.notes.notConnected")}
        </span>
      </p>

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

      {connect.error === null &&
      sync.error === null &&
      clean.error === null &&
      reset.error === null ? null : (
        <p className="text-danger font-mono text-[10px]">
          {String(connect.error ?? sync.error ?? clean.error ?? reset.error)}
        </p>
      )}
    </div>
  );
}
