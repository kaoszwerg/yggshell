import { AlertOctagon } from "lucide-react";
import { HudPanel } from "./ui/HudPanel";
import { Button } from "./ui/Button";
import { api } from "../api/commands";

interface FatalScreenProps {
  /** The value that was thrown. Anything is possible in JS — this is rendered defensively. */
  error: unknown;
  /** Path of the durable crash report, or `null` if the report could not be written. */
  reportPath: string | null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" ? error : String(error);
}

/**
 * The end of a render tree (ADR-CORE-037, ADR-APP-032).
 *
 * Shown when an error reached the top of the UI runtime with nobody left to handle it. It does NOT
 * offer to resume the failed tree — that tree is dead, and continuing on state nobody can vouch for is
 * exactly what `rule:crash-handling` forbids. The two exits it does offer are both clean: a full reload
 * (a brand-new UI runtime, nothing carried over) or a deliberate, non-zero process exit.
 *
 * It states where the report is, because a user who can find the file is a user who can send it.
 */
export function FatalScreen({ error, reportPath }: FatalScreenProps) {
  return (
    <div className="bg-base flex h-screen w-screen items-center justify-center p-8">
      <HudPanel accent="danger" label="FATAL ERROR" className="w-full max-w-2xl">
        <div className="flex items-start gap-4">
          <AlertOctagon size={28} strokeWidth={1.5} className="text-danger mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-fg mb-2 text-sm leading-relaxed">
              The interface hit an error it could not recover from and has stopped. Your settings
              and logs on disk are untouched.
            </p>

            <p className="text-dim mb-4 font-mono text-xs break-words">{messageOf(error)}</p>

            <p className="text-dim mb-5 text-xs leading-relaxed">
              {reportPath ? (
                <>
                  A crash report was written to{" "}
                  <span className="text-fg font-mono break-all">{reportPath}</span>. It stays on
                  this device — send it along if you report this.
                </>
              ) : (
                <>
                  The crash report could not be written. The failure is still in the application log
                  under the app data directory.
                </>
              )}
            </p>

            <div className="flex gap-3">
              <Button accent="cyan" onClick={() => window.location.reload()}>
                Restart interface
              </Button>
              <Button
                accent="danger"
                variant="ghost"
                onClick={() => {
                  // A failure to exit must not leave the user stuck on a dead screen with a dead
                  // button; it is logged and reported like anything else (rule:logging).
                  void api.exitAfterCrash().catch((e) => console.error("[crash] exit failed", e));
                }}
              >
                Quit
              </Button>
            </div>
          </div>
        </div>
      </HudPanel>
    </div>
  );
}
