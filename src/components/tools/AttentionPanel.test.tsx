import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AttentionPanel } from "./AttentionPanel";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";
import { pane } from "../../test/panes";

vi.mock("../../hooks/useAgentAttention", () => ({ useAgentAttention: vi.fn() }));
vi.mock("../../api/environment", () => ({
  environmentApi: { installHook: vi.fn(), clearAttention: vi.fn() },
}));

import { useAgentAttention } from "../../hooks/useAgentAttention";
import { environmentApi } from "../../api/environment";

function state(over: Partial<ReturnType<typeof useAgentAttention>>) {
  vi.mocked(useAgentAttention).mockReturnValue({
    installed: true,
    waiting: [],
    ready: true,
    ...over,
  });
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AttentionPanel />
    </QueryClientProvider>,
  );
}

describe("AttentionPanel", () => {
  beforeEach(() => {
    vi.mocked(useAgentAttention).mockReset();
    vi.mocked(environmentApi.installHook).mockReset();
    // Resolved, not bare: a mutation needs a promise, and a mock returning undefined never runs.
    vi.mocked(environmentApi.clearAttention).mockReset().mockResolvedValue(undefined);
    useUiStore.setState({ locale: "en" });
    useTerminalStore.setState({ panes: [pane({ key: "p1", cwd: "/repo" })], activeKey: "p1" });
  });

  it("offers the hook only while it is missing", () => {
    state({ installed: false });
    const { unmount } = renderPanel();
    expect(screen.getByRole("button", { name: "Install the hook" })).toBeInTheDocument();
    unmount();

    state({ installed: true });
    renderPanel();
    expect(screen.queryByRole("button", { name: "Install the hook" })).toBeNull();
  });

  it("says the hook only takes effect next session", async () => {
    // Claude Code reads its hooks when a session starts. Without this sentence the button looks
    // like it did nothing, and the user presses it again.
    state({ installed: false });
    vi.mocked(environmentApi.installHook).mockResolvedValue("/Users/x/.claude/settings.json");
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Install the hook" }));
    state({ installed: true });

    expect(await screen.findByText(/next Claude Code session/)).toBeInTheDocument();
  });

  it("names which directory is asking, and what it wants", () => {
    // The whole reason a hook beats a bell: the bell says "something happened somewhere".
    state({
      waiting: [
        {
          cwd: "/repo/api",
          event: "Notification",
          message: "Claude needs your permission to use Bash",
          idle: false,
        },
      ],
    });
    renderPanel();

    expect(screen.getByText("/repo/api")).toBeInTheDocument();
    expect(screen.getByText(/permission to use Bash/)).toBeInTheDocument();
  });

  it("says plainly when nothing is waiting", () => {
    // An empty panel would read as "not working" for a feature whose whole job is to be quiet.
    state({ waiting: [] });
    renderPanel();

    expect(screen.getByText("Nothing is waiting for you.")).toBeInTheDocument();
  });

  it("can be marked as seen, and offers that only when there is something to clear", async () => {
    state({ waiting: [] });
    const { unmount } = renderPanel();
    expect(screen.queryByRole("button", { name: "Mark as seen" })).toBeNull();
    unmount();

    state({ waiting: [{ cwd: "/repo", event: "Stop", message: null, idle: false }] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Mark as seen" }));
    // `mutate` dispatches; the call lands on the next tick.
    await waitFor(() => expect(environmentApi.clearAttention).toHaveBeenCalledOnce());
  });

  it("renders nothing at all before the terminal reports where it is", () => {
    state({ ready: false });
    const { container } = renderPanel();
    expect(container.firstChild).toBeNull();
  });
});
