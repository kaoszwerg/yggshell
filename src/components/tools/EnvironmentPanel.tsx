import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Plus, ShieldAlert } from "lucide-react";
import { Button } from "../ui/Button";
import { Row } from "../ui/Row";
import { TextField } from "../ui/TextField";
import { environmentApi } from "../../api/environment";
import { useTerminalStore } from "../../store/terminal";
import { useT } from "../../hooks/useT";

/**
 * Which Claude account this project uses, and how to change it.
 *
 * **The construct this serves.** Several Claude accounts can be in use on one machine, one per
 * project, selected by `CLAUDE_CONFIG_DIR` in a `.envrc` that direnv loads on entering the
 * directory. Doing that by hand means three steps in two places; this is the same three steps with
 * the state visible.
 *
 * **Writing an `.envrc` and approving it is a real act**, and the interface says so rather than
 * hiding it behind a dropdown: the path that was written is reported back, an existing file is
 * backed up and preserved, and approval only ever applies to the file this app has just written
 * (`agent::direnv`).
 */
export function EnvironmentPanel() {
  const t = useT();
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);
  const client = useQueryClient();
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["environment", cwd],
    queryFn: () => (cwd === null ? null : environmentApi.status(cwd)),
    enabled: cwd !== null,
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["environment", cwd] });
    void client.invalidateQueries({ queryKey: ["agent"] });
  };

  const choose = useMutation({
    mutationFn: (home: string) =>
      cwd === null
        ? Promise.reject(new Error("no directory"))
        : environmentApi.setProject(cwd, home),
    // The path is reported because approving a file the user has not read is only defensible if they
    // are told which one it was.
    onSuccess: (path) => {
      setNote(t("env.wrote", { path }));
      refresh();
    },
    onError: (error: unknown) => setNote(String(error)),
  });

  const create = useMutation({
    mutationFn: (name: string) => environmentApi.createHome(name),
    onSuccess: (path) => {
      setNote(t("env.created", { path }));
      setNewName("");
      refresh();
    },
    onError: (error: unknown) => setNote(String(error)),
  });

  const installDirenv = useMutation({
    mutationFn: () => environmentApi.installDirenv(),
    onSuccess: (manager) => {
      setNote(t("env.installed", { manager }));
      refresh();
    },
    onError: (error: unknown) => setNote(String(error)),
  });

  if (cwd === null) return <p className="text-dim p-3 font-mono text-[11px]">{t("env.noCwd")}</p>;

  const data = status.data ?? null;

  return (
    <div className="flex flex-col gap-2 p-2">
      <p className="text-dim font-mono text-[10px] leading-relaxed">{t("env.explain")}</p>

      {data?.direnv_installed === false ? (
        <div className="flex items-center gap-2">
          <ShieldAlert size={12} className="text-gold shrink-0" aria-hidden />
          <span className="text-dim min-w-0 flex-1 font-mono text-[10px]">{t("env.noDirenv")}</span>
          <Button
            onClick={() => installDirenv.mutate()}
            disabled={installDirenv.isPending}
            className="shrink-0"
          >
            <Download size={11} aria-hidden />
            {t("env.install")}
          </Button>
        </div>
      ) : null}

      {data?.has_envrc === true && data.direnv_allowed === false ? (
        // Worth saying out loud: the declaration is correct and simply is not loading, which looks
        // exactly like the setting having no effect.
        <p className="text-gold font-mono text-[10px]">{t("env.notAllowed")}</p>
      ) : null}

      <div className="flex flex-col gap-px">
        {(data?.homes ?? []).map((home) => {
          const active = data?.declared === home.path;
          return (
            <Row
              key={home.path}
              label={home.name}
              selected={active}
              onActivate={() => choose.mutate(home.path)}
              className="gap-2 font-mono text-[11px]"
            >
              <span className="w-3 shrink-0">
                {active ? <Check size={11} className="text-green" aria-hidden /> : null}
              </span>
              <span className="text-fg min-w-0 flex-1 truncate">{home.name}</span>
              {home.used_here ? (
                <span className="text-dim/60 shrink-0 text-[10px]">{t("env.usedHere")}</span>
              ) : null}
            </Row>
          );
        })}
        {(data?.homes ?? []).length === 0 && status.isSuccess ? (
          <p className="text-dim font-mono text-[10px]">{t("env.noHomes")}</p>
        ) : null}
      </div>

      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-dim font-mono text-[10px]">{t("env.newHome")}</span>
          <TextField
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("env.newHomePlaceholder")}
            aria-label={t("env.newHome")}
          />
        </label>
        <Button
          onClick={() => create.mutate(newName)}
          disabled={newName.trim() === "" || create.isPending}
          className="shrink-0"
        >
          <Plus size={11} aria-hidden />
          {t("env.create")}
        </Button>
      </div>

      {note === null ? null : (
        // Kept until the next action rather than fading: it names a file that was written or
        // approved, which is the part the user has to be able to read at their own pace.
        <p className="text-dim border-cyan/15 border-t pt-1 font-mono text-[10px] break-all">
          {note}
        </p>
      )}
    </div>
  );
}
