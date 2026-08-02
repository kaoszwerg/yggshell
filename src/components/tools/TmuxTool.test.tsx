import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TmuxTool } from "./TmuxTool";
import { useTerminalStore } from "../../store/terminal";
import { pane } from "../../test/panes";
import type { TmuxSession } from "../../bindings/TmuxSession";

vi.mock("../../hooks/useContentFontSize", () => ({ useContentFontSize: () => 17 }));

vi.mock("../../api/terminal", () => ({
  terminalApi: {
    sessions: vi.fn(),
    killSession: vi.fn(() => Promise.resolve()),
    renameSession: vi.fn(() => Promise.resolve()),
  },
}));

import { terminalApi } from "../../api/terminal";

function session(name: string, over: Partial<TmuxSession> = {}): TmuxSession {
  return { name, windows: 2, attached: false, command: "zsh", ...over };
}

function renderTool() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TmuxTool />
    </QueryClientProvider>,
  );
}

describe("TmuxTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTerminalStore.setState({ panes: [], activeKey: null, bootstrapped: true, closing: null });
    vi.mocked(terminalApi.sessions).mockResolvedValue([session("yggshell"), session("build")]);
  });

  it("says what is in a session, because the names do not", async () => {
    // After a crash the names are `yggshell`, `yggshell-2`, `yggshell-3` and none of them says which
    // one holds the build. What it is running is what makes "end it or attach" a decision.
    vi.mocked(terminalApi.sessions).mockResolvedValue([session("build", { command: "cargo" })]);
    renderTool();

    expect(await screen.findByText("build")).toBeTruthy();
    expect(screen.getByText(/cargo/)).toBeTruthy();
  });

  it("draws its content at the terminal's text size", async () => {
    // rule:content-size — a panel drawn at a hard-coded size overrules the setting the user changed
    // precisely so they could read it.
    const { container } = renderTool();
    await screen.findByText("yggshell");

    const sized = container.querySelector<HTMLElement>("[style*='font-size']");
    expect(sized?.style.fontSize).toBe("17px");
  });

  it("opens a tab attached to the session that was picked", async () => {
    renderTool();
    fireEvent.click(await screen.findByText("build"));

    const panes = useTerminalStore.getState().panes;
    expect(panes).toHaveLength(1);
    expect(panes[0]?.tmuxSession).toBe("build");
  });

  it("shows the tab a session is already in, rather than attaching twice", async () => {
    // Two clients on one session share ONE view of it. Opening a second tab would look like a second
    // terminal and be the same window.
    useTerminalStore.setState({
      panes: [pane({ key: "a", tmuxSession: "build" })],
      activeKey: null,
    });
    renderTool();
    fireEvent.click(await screen.findByText("build"));

    expect(useTerminalStore.getState().panes).toHaveLength(1);
    expect(useTerminalStore.getState().activeKey).toBe("a");
  });

  it("asks before ending a session, and says what stops", async () => {
    renderTool();
    fireEvent.click(await screen.findByRole("button", { name: "End build" }));

    expect(screen.getByRole("dialog", { name: "End session" })).toBeTruthy();
    expect(screen.getByText(/Everything running in it stops/)).toBeTruthy();
    expect(terminalApi.killSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "End it" }));
    await waitFor(() => expect(terminalApi.killSession).toHaveBeenCalledWith("build"));
  });

  it("ends nothing when the question is dismissed", async () => {
    renderTool();
    fireEvent.click(await screen.findByRole("button", { name: "End build" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(terminalApi.killSession).not.toHaveBeenCalled();
  });

  it("carries a tab across when its session is renamed", async () => {
    // **The step without which renaming is a defect.** A tab left pointing at a name nobody has would
    // create an empty session under it on the next start, while the renamed one sat orphaned — the
    // very thing the restore exists to prevent.
    useTerminalStore.setState({
      panes: [pane({ key: "a", tmuxSession: "build" })],
      activeKey: "a",
    });
    renderTool();

    fireEvent.click(await screen.findByRole("button", { name: "Rename build" }));
    const field = screen.getByLabelText("Session name");
    fireEvent.change(field, { target: { value: "deploy" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });

    expect(terminalApi.renameSession).toHaveBeenCalledWith("build", "deploy");
    await waitFor(() => expect(useTerminalStore.getState().panes[0]?.tmuxSession).toBe("deploy"));
  });

  it("renames nothing when the name was not changed", async () => {
    renderTool();
    fireEvent.click(await screen.findByRole("button", { name: "Rename build" }));
    fireEvent.keyDown(screen.getByLabelText("Session name"), { key: "Enter" });

    expect(terminalApi.renameSession).not.toHaveBeenCalled();
  });

  it("says so when nothing is running", async () => {
    vi.mocked(terminalApi.sessions).mockResolvedValue([]);
    renderTool();
    expect(await screen.findByText("No tmux session is running.")).toBeTruthy();
  });

  it("surfaces a refusal instead of swallowing it", async () => {
    // rule:logging — an error is logged AND surfaced. A row that quietly stays after "end it" is the
    // failure this replaces.
    vi.mocked(terminalApi.killSession).mockRejectedValue(new Error("no such session"));
    renderTool();
    fireEvent.click(await screen.findByRole("button", { name: "End build" }));
    fireEvent.click(screen.getByRole("button", { name: "End it" }));

    expect(await screen.findByText(/no such session/)).toBeTruthy();
  });
});
