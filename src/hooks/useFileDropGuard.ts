import { useEffect } from "react";

/**
 * Stops a dropped file from replacing the application.
 *
 * **The failure this prevents is total.** Drop an image anywhere on the window and the WebView does
 * what a browser does with a file nobody handled: it *navigates to it*. The interface is gone, the
 * picture fills the window, there is no back — and the terminals, the running builds and the agent
 * sessions behind it go with the process when the user quits to get out. Reported exactly that way:
 * "man kommt garnicht mehr heraus und muss die App beenden um wieder ein Terminal zu bekommen".
 *
 * It is the same class of defect as an `<a href>` inside a Tauri window, which `Markdown` has guarded
 * against since the first version — one navigation and the app is over. That one was foreseen and
 * this one was not, because it arrives through a channel nobody writes: the browser's default.
 *
 * **This does not take drag-and-drop away.** Tauri's own `onDragDropEvent` is a separate channel and
 * still fires — the `.itermcolors` import is driven by it, and anything else that wants dropped files
 * uses the same one. What is suppressed is only the WebView's default, which is navigation and
 * nothing else.
 *
 * On `window` with `capture`, so it holds wherever the pointer happens to be — a nested element that
 * stops propagation must not be able to open the hole again.
 */
export function useFileDropGuard(): void {
  useEffect(() => {
    // Both are needed: without `dragover` the drop is never allowed to land here, and the browser
    // takes it instead.
    const swallow = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener("dragover", swallow, true);
    window.addEventListener("drop", swallow, true);
    return () => {
      window.removeEventListener("dragover", swallow, true);
      window.removeEventListener("drop", swallow, true);
    };
  }, []);
}
