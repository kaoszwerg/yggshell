import { useEffect, useRef } from "react";
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
 * A failure is not surfaced here: `notes_sync` records it, and the settings panel shows git's own
 * message. Offline is the normal case, not the error case — the notes are written locally and stay
 * readable either way (ADR-PROJ-004).
 */
export function useNotesSync({ now = false }: { now?: boolean } = {}) {
  const qc = useQueryClient();
  const last = useRef(0);

  useEffect(() => {
    const run = () => {
      const now = Date.now();
      if (now - last.current < THROTTLE_MS) return;
      last.current = now;
      void notesApi
        .sync()
        .then(() => {
          void qc.invalidateQueries({ queryKey: ["notes-content"] });
          void qc.invalidateQueries({ queryKey: ["notes-projects"] });
          void qc.invalidateQueries({ queryKey: ["notes-status"] });
        })
        .catch((error: unknown) => {
          // Logged, never thrown: an unhandled rejection here would reach `window.onerror` and put
          // the whole interface behind the fatal screen over a note that did not sync (ADR-APP-032).
          console.warn("notes sync failed", error);
        });
    };

    // `now` only where a notes surface just opened. The shell root passes nothing, so opening the app
    // never touches the network — see the note above about the Touch ID prompt.
    if (now) run();
    window.addEventListener("focus", run);
    return () => {
      window.removeEventListener("focus", run);
    };
  }, [qc, now]);
}
