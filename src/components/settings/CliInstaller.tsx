import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { api } from "../../api/commands";
import { useT } from "../../hooks/useT";
import type { CliInstall } from "../../bindings/CliInstall";

/** What the panel knows. `checking` is the moment before the first answer arrives. */
type State =
  | { kind: "checking" }
  | { kind: "installed"; result: CliInstall }
  | { kind: "absent" }
  | { kind: "failed"; reason: string };

/**
 * Offer to put `ygg` on the user's `PATH` — and say whether it is already there.
 *
 * **Nothing is written until the button is pressed.** An app that quietly places executables on
 * someone's `PATH` because it launched is doing something they did not ask for.
 *
 * **The state is asked for, not remembered.** A button that looks identical whether or not the job
 * is done invites pressing it again, and again — which is exactly what happened. The answer is read
 * from the filesystem on every visit, because the user can delete the script and a remembered "yes"
 * would then be a lie.
 *
 * The case that matters most is **installed but not on `PATH`**: worse than not installed at all,
 * because the user types `ygg`, gets nothing, and has no reason to suspect where the problem is.
 */
export function CliInstaller() {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "checking" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .cliStatus()
      .then((result) => {
        if (cancelled) return;
        setState(result === null ? { kind: "absent" } : { kind: "installed", result });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Reported rather than shown as "not installed": claiming it is absent when we simply could
        // not look would send the user to install a second copy over their own.
        setState({ kind: "failed", reason: messageOf(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const install = () => {
    setBusy(true);
    void api
      .installCli()
      .then((result) => setState({ kind: "installed", result }))
      .catch((error: unknown) => setState({ kind: "failed", reason: messageOf(error) }))
      .finally(() => setBusy(false));
  };

  const installed = state.kind === "installed";

  return (
    <div className="flex flex-col gap-1.5">
      {/* The state is stated BEFORE the button, so it is read before the click rather than after. */}
      {state.kind === "checking" ? (
        <span className="text-dim text-xs">{t("cli.checking")}</span>
      ) : null}
      {state.kind === "absent" ? (
        <span className="text-dim text-xs">{t("cli.notInstalled")}</span>
      ) : null}
      {installed ? (
        <>
          <span className="text-green text-xs">
            {t("cli.alreadyInstalled", {
              directory: state.result.directory,
              names: state.result.names.join(", "),
            })}
          </span>
          {state.result.onPath ? null : (
            <span className="text-gold text-xs">
              {t("cli.notOnPath", { directory: state.result.directory })}
            </span>
          )}
        </>
      ) : null}
      {state.kind === "failed" ? (
        <span className="text-danger text-xs">{t("cli.failed", { reason: state.reason })}</span>
      ) : null}

      <div className="flex flex-wrap gap-1">
        <Button
          accent={installed ? "cyan" : "green"}
          disabled={busy || state.kind === "checking"}
          onClick={install}
        >
          {busy ? t("cli.installing") : installed ? t("cli.reinstall") : t("cli.install")}
        </Button>
      </div>

      <span className="text-dim text-xs">{t("cli.usage")}</span>
    </div>
  );
}

/** A message a person can act on, whatever the backend threw. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
