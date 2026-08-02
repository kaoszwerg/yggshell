import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloseTabConfirm } from "./CloseTabConfirm";
import { useTerminalStore } from "../store/terminal";
import { pane } from "../test/panes";

vi.mock("../api/terminal", () => ({
  terminalApi: { killSession: vi.fn(() => Promise.resolve()) },
}));

import { terminalApi } from "../api/terminal";

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CloseTabConfirm />
    </QueryClientProvider>,
  );
}

/** A workspace with one tab in tmux and one plain, and nothing being closed yet. */
function workspace() {
  useTerminalStore.setState({
    panes: [pane({ key: "a", tmuxSession: "yggshell-3" }), pane({ key: "b" })],
    activeKey: "a",
    closing: null,
    bootstrapped: true,
  });
}

describe("closing a tab that holds a tmux session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace();
  });

  it("asks nothing at all when there is no session to leave behind", () => {
    // A plain shell dies with the tab. There is nothing to decide, so there is no question — and a
    // question with one possible answer is a chore, not a safeguard.
    useTerminalStore.getState().requestClosePane("b");

    expect(useTerminalStore.getState().panes.map((p) => p.key)).toEqual(["a"]);
    expect(useTerminalStore.getState().closing).toBeNull();
  });

  it("asks when the tab holds one, and names it", () => {
    useTerminalStore.getState().requestClosePane("a");
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Close terminal" })).toBeTruthy();
    expect(screen.getByText(/yggshell-3/)).toBeTruthy();
    // Still open: nothing happens until the question is answered.
    expect(useTerminalStore.getState().panes).toHaveLength(2);
  });

  it("closes the tab and leaves the session running", () => {
    // What closing a tab has always meant, and it stays the default: the cancel button, which is
    // also what the dialog opens focused on.
    useTerminalStore.getState().requestClosePane("a");
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Close, keep session" }));

    expect(useTerminalStore.getState().panes.map((p) => p.key)).toEqual(["b"]);
    expect(terminalApi.killSession).not.toHaveBeenCalled();
  });

  it("closes the tab and ends the session when that is what was asked", async () => {
    useTerminalStore.getState().requestClosePane("a");
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Close and end it" }));

    await waitFor(() => expect(terminalApi.killSession).toHaveBeenCalledWith("yggshell-3"));
    expect(useTerminalStore.getState().panes.map((p) => p.key)).toEqual(["b"]);
  });

  it("leaves the tab alone when the question is walked away from", () => {
    // THREE outcomes, two buttons. Escape and the backdrop are the third — never mind — and not a
    // silent "close, keep", which would perform an action the user was backing out of.
    useTerminalStore.getState().requestClosePane("a");
    renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(useTerminalStore.getState().panes).toHaveLength(2);
    expect(useTerminalStore.getState().closing).toBeNull();
    expect(terminalApi.killSession).not.toHaveBeenCalled();
  });

  it("renders nothing while no close is pending", () => {
    const { container } = renderDialog();
    expect(container.firstChild).toBeNull();
  });
});
