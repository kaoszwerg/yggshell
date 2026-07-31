// Where a paste can be delivered, per open terminal.
//
// The title bar has to be able to paste into a terminal it does not render — a middle-click on a tab
// pastes into *that* tab. Routing it through the emulator rather than straight down the IPC is what
// keeps the paste bracketed, so a multi-line paste does not execute line by line as it arrives; that
// means the title bar needs the pane's handle, and the pane is somewhere else entirely.
//
// A plain module-level map rather than a store: nothing renders from it, and a Zustand subscription
// for a lookup table that only two event handlers touch would be ceremony (rule:frontend-architecture
// — the store is for state the UI renders).

/** The one thing a caller outside the pane needs from a live terminal. */
export interface PasteTarget {
  paste: (text: string) => void;
}

const targets = new Map<string, PasteTarget>();

/** Called by a pane when its emulator is ready, and again with `undefined` when it goes away. */
export function registerPasteTarget(key: string, target: PasteTarget | undefined): void {
  if (target) targets.set(key, target);
  else targets.delete(key);
}

/** Deliver text to one terminal. Silently does nothing for a pane that is already gone — a tab can
 *  close between the click and the paste, and that is not a failure worth reporting. */
export function pasteInto(key: string, text: string): void {
  if (text === "") return;
  targets.get(key)?.paste(text);
}

/** Test seam — the module holds process-global state. */
export function clearPasteTargets(): void {
  targets.clear();
}
