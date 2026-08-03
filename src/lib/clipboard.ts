import { useToastStore } from "../store/toast";
import { terminalApi } from "../api/terminal";
import type { MessageKey } from "../i18n";

/**
 * Put text on the clipboard and say so.
 *
 * **Every copy in this application goes through here**, and that is the point rather than tidiness.
 * Copying is invisible — the selection looks identical before and after — so a copy that silently did
 * nothing is indistinguishable from one that worked. Before this, each of six call sites wrote its own
 * `navigator.clipboard.writeText(…).catch(console.warn)`: a failure went to a console the user does
 * not have open, which `rule:logging` calls a swallowed error however carefully it was caught.
 *
 * One helper means a new copy control cannot forget the confirmation, and cannot forget the failure
 * either. The write can fail for real reasons — the platform clipboard refused it — and the user is
 * the only one who can act on any of them.
 *
 * **It goes through the backend, never `navigator.clipboard.writeText()`.** WebKit gates that call on
 * a user gesture, and the terminal's copy-on-select has none to give: xterm calls `preventDefault()`
 * on `mousedown`, so the activation is already gone by the `mouseup` that copies. WebKit then refuses
 * **without settling the promise** — nothing reached the clipboard and neither branch below ever ran,
 * so the failure had no failure message either. Copying from a note went on working throughout,
 * because a button click IS a gesture, which is exactly what made it look like a terminal defect
 * rather than a clipboard one. The clipboard *read* was moved to the backend for the same reason in
 * 0.39.6 (`terminalApi.clipboardText`); this is the half that was left behind.
 *
 * @param text what to put on the clipboard
 * @param key which confirmation to show; the failure message is always `clipboard.failed`
 */
export function copyText(text: string, key: MessageKey): void {
  const { notify } = useToastStore.getState();
  terminalApi.writeClipboard(text).then(
    () => {
      notify(key);
    },
    (error: unknown) => {
      // Logged as well as shown: the message tells the user, the console tells whoever they report to.
      console.warn("could not copy to the clipboard", error);
      notify("clipboard.failed", "error");
    },
  );
}
