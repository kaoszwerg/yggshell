// The X11 PRIMARY selection, emulated for this app.
//
// On Unix, selecting text *is* the copy — it lands in PRIMARY — and a middle-click pastes it. That is
// the muscle memory anyone using a terminal on Linux or a BSD brings with them, and it is entirely
// separate from the clipboard that Ctrl+C fills.
//
// A WebView cannot reach the real PRIMARY: `navigator.clipboard` maps to CLIPBOARD only, on every
// platform. So this holds an app-scoped stand-in — text selected in one YggShell terminal can be
// middle-click pasted into another. Text selected in *another application* cannot, and that limit is
// the browser's, not a shortcut taken here.
//
// Deliberately not React state: nothing renders it, and a store subscription for a string that only
// two event handlers ever touch would be ceremony.

let primary = "";

/** Called when a selection is made — selecting is the copy, exactly as on X11. */
export function setPrimarySelection(text: string): void {
  // An empty or whitespace-only selection is what a stray click produces. Letting it through would
  // silently wipe a selection the user made a moment ago and still intends to paste.
  if (text.trim() === "") return;
  primary = text;
}

/** What a middle-click should paste. Empty when nothing has been selected yet. */
export function readPrimarySelection(): string {
  return primary;
}

/** Test seam — the module holds process-global state, so a test must be able to start from zero. */
export function clearPrimarySelection(): void {
  primary = "";
}
