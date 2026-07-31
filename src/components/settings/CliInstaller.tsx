import { useState } from "react";
import { Button } from "../ui/Button";
import { api } from "../../api/commands";
import { useT } from "../../hooks/useT";
import type { CliInstall } from "../../bindings/CliInstall";

/** What the button has done so far. `null` before anything has been asked of it. */
type Outcome =
  { kind: "installed"; result: CliInstall } | { kind: "failed"; reason: string } | null;

/**
 * Offer to put `ygg` on the user's `PATH`.
 *
 * **Nothing is written until this is pressed.** An app that quietly places executables on someone's
 * `PATH` because it launched is doing something they did not ask for; this is a button, the way
 * editors do it.
 *
 * The result is reported in full, including the case that matters most: **installed but not on
 * `PATH`**. That is a worse outcome than not installed at all — the user types `ygg`, gets nothing,
 * and has no reason to suspect where the problem is. So the directory is named and the fix is stated.
 */
export function CliInstaller() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const install = () => {
    setBusy(true);
    void api
      .installCli()
      .then((result) => setOutcome({ kind: "installed", result }))
      .catch((error: unknown) =>
        // Surfaced, not just logged: the user pressed a button and is owed an answer either way
        // (rule:logging — no silent failures).
        setOutcome({
          kind: "failed",
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        <Button accent="green" disabled={busy} onClick={install}>
          {busy ? t("cli.installing") : t("cli.install")}
        </Button>
      </div>

      {outcome?.kind === "installed" ? (
        <>
          <span className="text-green text-xs">
            {t("cli.installed", {
              directory: outcome.result.directory,
              names: outcome.result.names.join(", "),
            })}
          </span>
          {outcome.result.onPath ? null : (
            <span className="text-gold text-xs">
              {t("cli.notOnPath", { directory: outcome.result.directory })}
            </span>
          )}
        </>
      ) : null}

      {outcome?.kind === "failed" ? (
        <span className="text-danger text-xs">{t("cli.failed", { reason: outcome.reason })}</span>
      ) : null}

      <span className="text-dim text-xs">{t("cli.usage")}</span>
    </div>
  );
}
