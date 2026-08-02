import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useTerminalStore } from "../store/terminal";
import { terminalApi } from "../api/terminal";
import { useT } from "../hooks/useT";

/**
 * Asks, when closing a tab would leave a tmux session behind.
 *
 * **Only for a close the user asked for.** A session that ended on its own goes straight through
 * `closePane`, because "end its tmux session?" about a session that is already gone is nonsense —
 * and quitting the app never comes here at all: it does not close tabs, it detaches every client and
 * ends. Quitting with four tabs open is not four questions, and must never become that.
 *
 * **Neither answer is the destructive default.** Closing has always detached, so "keep it" is what
 * the tab did yesterday; ending is the new option, and it is the one behind the danger accent and
 * away from the initial focus (`ConfirmDialog`).
 */
export function CloseTabConfirm() {
  const t = useT();
  const qc = useQueryClient();
  const closing = useTerminalStore((s) => s.closing);
  const panes = useTerminalStore((s) => s.panes);
  const closePane = useTerminalStore((s) => s.closePane);
  const cancelClose = useTerminalStore((s) => s.cancelClose);

  const end = useMutation({
    mutationFn: (name: string) => terminalApi.killSession(name),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["tmux-sessions"] }),
  });

  const pane = panes.find((p) => p.key === closing);
  const session = pane?.tmuxSession;
  if (pane === undefined || session == null) return null;

  return (
    <ConfirmDialog
      label={t("tabs.close.title")}
      question={t("tabs.close.question")}
      detail={t("tabs.close.detail", { session })}
      confirmLabel={t("tabs.close.end")}
      cancelLabel={t("tabs.close.keep")}
      onConfirm={() => {
        end.mutate(session);
        closePane(pane.key);
      }}
      onCancel={() => {
        // "Keep the session" still CLOSES the tab — that is what closing a tab has always meant.
        closePane(pane.key);
      }}
      onDismiss={() => {
        // Escape and the backdrop mean the third thing: never mind, leave the tab alone. Three
        // outcomes, two buttons — walking away has to be the one that does nothing.
        cancelClose();
      }}
    />
  );
}
