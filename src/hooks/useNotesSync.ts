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
 * **At the shell root, and on window focus.** Pull on start, and again when the window comes back —
 * which is the moment the other machine's work is most likely to have arrived, and the moment before
 * you start reading. The same reasoning as the attention signal, one surface over
 * (`rule:attention-signals`): a panel that is only right when you click it is wrong the rest of the
 * time.
 *
 * **Not a timer.** Syncing spawns git and talks to a network; doing that every few minutes for
 * somebody who is not looking at their notes is the battery cost this app refuses elsewhere. Focus is
 * the signal that costs nothing when nobody is there.
 *
 * A failure is not surfaced here: `notes_sync` records it, and the settings panel shows git's own
 * message. Offline is the normal case, not the error case — the notes are written locally and stay
 * readable either way (ADR-PROJ-004).
 */
export function useNotesSync() {
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

    run();
    window.addEventListener("focus", run);
    return () => {
      window.removeEventListener("focus", run);
    };
  }, [qc]);
}
