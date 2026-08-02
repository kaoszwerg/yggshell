import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function subject(over: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      label="End session"
      question="End the tmux session yggshell-3?"
      detail="Everything running in it is stopped."
      confirmLabel="End it"
      cancelLabel="Keep it"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("asks the question and says what will happen", () => {
    subject();
    expect(screen.getByText("End the tmux session yggshell-3?")).toBeTruthy();
    expect(screen.getByText("Everything running in it is stopped.")).toBeTruthy();
  });

  it("confirms only when the confirming button is pressed", () => {
    const { onConfirm, onCancel } = subject();
    fireEvent.click(screen.getByRole("button", { name: "End it" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("opens with CANCEL focused, so a stray Enter does not destroy anything", () => {
    // The key most likely to be in flight when a dialog appears is Enter — the one that just
    // triggered the action. Focusing the destructive button would turn "are you sure?" into a
    // formality that answers itself.
    subject();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep it" }));
  });

  it("cancels on Escape and on a backdrop click", () => {
    // Both ambiguous gestures take the reversible branch.
    const { onCancel, onConfirm } = subject();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("presentation"));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not cancel when the click was inside it", () => {
    // A click that lands on the panel is somebody reading, not somebody dismissing.
    const { onCancel } = subject();
    fireEvent.click(screen.getByText("End the tmux session yggshell-3?"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("is a modal dialog with a name", () => {
    subject();
    const dialog = screen.getByRole("dialog", { name: "End session" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("tells dismissing apart from cancelling, where the question has three answers", () => {
    // Closing a tab is close-and-keep, close-and-end, or don't close. Two buttons take the first
    // two; walking away has to be the third, or Escape silently performs an action the user was
    // backing out of.
    const onCancel = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ConfirmDialog
        label="Close terminal"
        question="Close and end its session?"
        confirmLabel="Close and end it"
        cancelLabel="Close, keep session"
        onConfirm={vi.fn()}
        onCancel={onCancel}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("presentation"));
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close, keep session" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("leaves out the detail line when there is nothing to add", () => {
    subject({ detail: undefined });
    expect(screen.queryByText("Everything running in it is stopped.")).toBeNull();
  });
});
