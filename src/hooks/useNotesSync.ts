import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notesApi } from "../api/notes";

/** The shortest gap between two automatic syncs, so focus-flapping cannot become a push loop. */
const THROTTLE_MS = 30_000;

/**
 * When the last automatic sync ran — **shared by every instance of this hook, not one per instance.**
 *
 * There are two callers: the shell root, and the notes tool when it opens. Held in a `useRef` this
 * was a throttle *per hook instance*, so one focus event started two syncs 121 µs apart — measured in
 * the maintainer's log. Both then ran `git fetch` into the same clone, which rewrites the single
 * `FETCH_HEAD`, and `git pull --rebase` refused the second with *"Cannot rebase onto multiple
 * branches"*: an error with nothing wrong behind it, shown on the badge as a sync that keeps failing.
 *
 * A module-level value is the honest shape of "the last time this application synced" — the thing
 * being throttled is the repository, and there is one of those however many components ask. The
 * backend holds a lock of its own (`commands/notes.rs`), because a throttle is an optimisation and
 * that lock is the guarantee.
 */
let lastRun = 0;

/**
 * Forget when the last sync ran.
 *
 * **Exists because the throttle is module state, and module state outlives a test.** A shared value
 * is the correct shape here — there is one repository however many components ask — but it makes one
 * test's sync the reason the next test's does not happen, which is how it first showed up: two
 * `NotesTool` tests that mount and expect a sync went red the moment the throttle stopped being
 * per-instance. A reset is the honest answer; the alternative is tests that depend on their order
 * (rule:testing).
 */
export function resetSyncThrottle(): void {
  lastRun = 0;
}

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
  const [error, setError] = useState<string | null>(null);
  const force = useRef<() => void>(() => undefined);

  useEffect(() => {
    const run = (forced = false) => {
      const at = Date.now();
      if (!forced && at - lastRun < THROTTLE_MS) return;
      lastRun = at;
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
