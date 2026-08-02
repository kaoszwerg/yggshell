import { useToastStore } from "../store/toast";
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
 * either. `writeText` rejects for real reasons — the document is not focused, the permission was
 * refused — and the user is the only one who can act on any of them.
 *
 * @param text what to put on the clipboard
 * @param key which confirmation to show; the failure message is always `clipboard.failed`
 */
export function copyText(text: string, key: MessageKey): void {
  const { notify } = useToastStore.getState();
  navigator.clipboard.writeText(text).then(
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
