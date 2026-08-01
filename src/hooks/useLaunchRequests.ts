import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api/commands";
import { useTerminalStore } from "../store/terminal";
import { useUiStore } from "../store/ui";

/** The backend's name for "open a terminal here". Pinned by a test on both sides. */
export const LAUNCH_EVENT = "open-in-directory";

/**
 * Open a terminal when somebody names a directory from outside the app.
 *
 * Two routes in, and **both are needed** — this is the part that is easy to get half right:
 *
 *  - **the event**, for when the app is already running and `ygg ~/project` (or Finder) reaches it;
 *  - **the drained queue**, for a cold start. The path arrives while the webview is still loading, so
 *    the event fires into nothing. The backend keeps it, and this asks for it once, on mount.
 *
 * Draining rather than reading means a reload does not reopen terminals the user already has.
 *
 * It also switches to the terminal view: somebody who just typed `ygg` is asking to be looking at a
 * terminal, not at whichever page they left open.
 */
export function useLaunchRequests(): void {
  const openPaneIn = useTerminalStore((s) => s.openPaneIn);
  const setView = useUiStore((s) => s.setView);

  useEffect(() => {
    let cancelled = false;

    const open = (cwd: unknown) => {
      // The payload crosses IPC, so it is checked here rather than trusted. An empty string would
      // open a tab with a directory that is not one.
      if (typeof cwd !== "string" || cwd === "") return;
      openPaneIn(cwd);
      setView("terminal");
    };

    // Anything that arrived before this component existed — the cold-start case.
    void api
      .pendingLaunches()
      .then((paths) => {
        if (cancelled) return;
        for (const path of paths) open(path);
      })
      .catch((error: unknown) => {
        // Not fatal: the app is usable, one launch request was lost. Silence would be the defect
        // (rule:logging).
        console.error("could not read the queued launch requests", error);
      });

    // Held as a value rather than unwrapped in the cleanup, and called AT MOST ONCE.
    //
    // The first version did `unlisten.then((off) => off())` on the way out, with no catch. Tauri
    // keeps its listeners in a table keyed by event id and deletes the entry on unregister, so a
    // second call reads `listeners[id].handlerId` off `undefined` — and because that happened inside
    // an unhandled promise, it did not fail quietly: it reached `unhandledrejection` and put the
    // whole interface behind the fatal screen. It crashed the maintainer's app, in a release build.
    let off: (() => void) | undefined;
    let stopped = false;
    void listen<string>(LAUNCH_EVENT, (event) => open(event.payload))
      .then((fn) => {
        // Registered after the cleanup already ran — unregister immediately rather than leaking it.
        if (stopped) {
          fn();
          return;
        }
        off = fn;
      })
      .catch((error: unknown) => {
        // Not fatal: launch requests stop arriving while the app is open, and the queue still works
        // on the next start. Silence would be the defect (rule:logging).
        console.error("could not listen for launch requests", error);
      });

    return () => {
      cancelled = true;
      stopped = true;
      try {
        off?.();
      } catch (error) {
        // Already gone — a hot reload, a double cleanup. Reported, never rethrown: this runs during
        // teardown, where a throw takes the interface with it.
        console.error("could not stop listening for launch requests", error);
      }
      off = undefined;
    };
  }, [openPaneIn, setView]);
}
