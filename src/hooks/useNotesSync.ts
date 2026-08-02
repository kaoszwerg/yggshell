import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notesApi } from "../api/notes";

/** The shortest gap between two automatic syncs, so focus-flapping cannot become a push loop. */
const THROTTLE_MS = 30_000;

/**
 * Keep the notes in step, without anybody pressing anything.
 *
 * **The visible "last synced" is the honest half of "automatic"** — and until this hook existed there
 * was no automatic half at all: the notes synced only when somebody opened Settings and pressed. A
 * feature whose whole promise is "any machine running YggShell has them" cannot be one you have to
 * remember to run.
 *
 * **NEVER at startup**, and that is a correction rather than a nicety. The first version pulled on
 * mount, and on a machine whose ssh key lives in the keychain that put a **Touch ID prompt in front
 * of the app before it had opened** — a system dialog between the user and their terminal, caused by
 * a feature they were not using at that moment. Reported from a running build.
 *
 * `BatchMode` stops git and ssh *asking for a passphrase*; it does nothing about the platform's own
 * keychain, which is a different mechanism and outside this app's reach. The only reliable way not to
 * raise that dialog is not to talk to the network until the user is doing something that needs it.
 *
 * **So: on window focus, and when a notes surface opens.** Both are moments the user has arrived at
 * their notes, and neither is the moment they are trying to get a shell.
 *
 * **Not a timer either.** Syncing spawns git and talks to a network; doing that every few minutes for
 * somebody who is not looking at their notes is the battery cost this app refuses elsewhere.
 *
 * **A failure comes back to the caller, and it is shown.** It used to go to `console.warn` and
 * nowhere else, on the reasoning that offline is normal rather than exceptional. That reasoning holds
 * for one failed attempt and collapses for a permanent one: the sync failed on *every* attempt for
 * days — an adopted clone has no upstream, so `git pull` refused — and the only visible effect was
 * notes that were not on the other machine and a note from the repository that never appeared. The
 * app looked healthy the entire time. Whoever is looking at their notes is exactly who needs to know
 * (rule:logging: logged AND surfaced), so the last failure is returned and the tool prints it.
 */
export function useNotesSync({ now = false }: { now?: boolean } = {}): {
  error: string | null;
  /** Sync because the user asked, ignoring the throttle — a button press is not focus-flapping. */
  syncNow: () => void;
} {
  const qc = useQueryClient();
  const last = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const force = useRef<() => void>(() => undefined);

  useEffect(() => {
    const run = (forced = false) => {
      const now = Date.now();
      if (!forced && now - last.current < THROTTLE_MS) return;
      last.current = now;
      void notesApi
        .sync()
        .then(() => {
          setError(null);
          void qc.invalidateQueries({ queryKey: ["notes-content"] });
          void qc.invalidateQueries({ queryKey: ["notes-projects"] });
          void qc.invalidateQueries({ queryKey: ["notes-status"] });
        })
        .catch((failure: unknown) => {
          // Caught, never thrown: an unhandled rejection here would reach `window.onerror` and put
          // the whole interface behind the fatal screen over a note that did not sync (ADR-APP-032).
          // Caught is not swallowed, though — it goes to the console AND back to the caller.
          console.warn("notes sync failed", failure);
          setError(failure instanceof Error ? failure.message : String(failure));
        });
    };

    force.current = () => {
      run(true);
    };

    // **"On focus" means COMING BACK, not arriving.** A window is focused the moment it opens, so
    // listening for focus alone made this a startup sync after all — which is the very thing it was
    // written to avoid, and it showed: the app flashed up, vanished, and returned three seconds
    // later while git ran. A focus only counts once the window has lost it at least once.
    let left = false;
    const onBlur = () => {
      left = true;
    };
    const onFocus = () => {
      if (!left) return;
      run();
    };
    window.addEventListener("blur", onBlur);

    // `now` only where a notes surface just opened. The shell root passes nothing, so opening the app
    // never touches the network — see the note above about the Touch ID prompt.
    if (now) run();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [qc, now]);

  return {
    error,
    syncNow: () => {
      force.current();
    },
  };
}
