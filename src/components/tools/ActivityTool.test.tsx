import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityTool } from "./ActivityTool";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";
import { pane } from "../../test/panes";
import type { TerminalActivity } from "../../bindings/TerminalActivity";

vi.mock("../../hooks/useContentFontSize", () => ({ useContentFontSize: () => 17 }));
vi.mock("../../api/terminal", () => ({ terminalApi: { activity: vi.fn() } }));

import { terminalApi } from "../../api/terminal";

const ACTIVITY: TerminalActivity = {
  via_tmux: false,
  processes: [
    { pid: 100, parent: 1, depth: 0, state: "Ss", elapsed: "01:00:00", command: "/bin/zsh" },
    { pid: 101, parent: 100, depth: 1, state: "S", elapsed: "00:30:00", command: "npm run dev" },
    {
      pid: 102,
      parent: 101,
      depth: 2,
      state: "R",
      elapsed: "00:29:59",
      command: "node vite --port 5173",
    },
  ],
  ports: [{ port: 5173, pid: 102, command: "node", address: "*" }],
};

function renderTool() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ActivityTool />
    </QueryClientProvider>,
  );
}

describe("ActivityTool", () => {
  beforeEach(() => {
    vi.mocked(terminalApi.activity).mockReset();
    useUiStore.setState({ locale: "en" });
    useTerminalStore.setState({
      panes: [pane({ key: "p1", sessionId: 7 })],
      activeKey: "p1",
    });
  });

  it("says there is nothing to read rather than asking about a session that is not there", async () => {
    useTerminalStore.setState({ panes: [pane({ key: "p1", sessionId: null })], activeKey: "p1" });
    renderTool();

    expect(await screen.findByText(/no terminal running/)).toBeInTheDocument();
    expect(terminalApi.activity).not.toHaveBeenCalled();
  });

  it("shows the whole command line, not just the program", async () => {
    // `node` alone answers nothing: the point of the tool is knowing WHICH node process this is.
    vi.mocked(terminalApi.activity).mockResolvedValue(ACTIVITY);
    renderTool();

    expect(await screen.findByText("node vite --port 5173")).toBeInTheDocument();
    expect(screen.getByText("npm run dev")).toBeInTheDocument();
  });

  it("shows a listening port with the address it is bound to", async () => {
    // `*` and `127.0.0.1` are the difference between reachable from the network and not.
    vi.mocked(terminalApi.activity).mockResolvedValue(ACTIVITY);
    renderTool();

    expect(await screen.findByText("5173")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("says whether the tree is the tab's own or the whole tmux session", async () => {
    // Inside tmux the roots come from tmux, so what is shown is the session rather than this tab —
    // a difference the user has to be told about, not left to infer.
    vi.mocked(terminalApi.activity).mockResolvedValue({ ...ACTIVITY, via_tmux: true });
    renderTool();

    expect(await screen.findByText("The whole tmux session")).toBeInTheDocument();
  });

  it("reads only when asked, never on a timer", async () => {
    // Two process spawns per read. A panel nobody is looking at must not be doing this every few
    // seconds — the refresh button is the contract.
    vi.mocked(terminalApi.activity).mockResolvedValue(ACTIVITY);
    renderTool();

    await screen.findByText("npm run dev");
    expect(terminalApi.activity).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(terminalApi.activity).toHaveBeenCalledTimes(2);
  });

  it("distinguishes nothing listening from nothing running", async () => {
    vi.mocked(terminalApi.activity).mockResolvedValue({
      via_tmux: false,
      processes: ACTIVITY.processes,
      ports: [],
    });
    renderTool();

    expect(await screen.findByText("Nothing is listening.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing is running.")).toBeNull();
  });

  it("names a failure instead of showing an empty panel", async () => {
    vi.mocked(terminalApi.activity).mockRejectedValue(new Error("ps not permitted"));
    renderTool();

    expect(await screen.findByText(/ps not permitted/)).toBeInTheDocument();
  });

  it("offers no way to end a process", async () => {
    // Deliberate: the terminal is right there and has every signal a process understands. A kill
    // button in a panel beside an agent that starts processes is the combination this app declines.
    vi.mocked(terminalApi.activity).mockResolvedValue(ACTIVITY);
    renderTool();

    await screen.findByText("npm run dev");
    const labels = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? "");
    expect(labels.some((l) => /kill|stop|terminate|end/i.test(l))).toBe(false);
  });

  it("draws its content at the terminal's own text size", async () => {
    // rule:content-size — a process list reads like a terminal.
    vi.mocked(terminalApi.activity).mockResolvedValue(ACTIVITY);
    const { container } = renderTool();

    await screen.findByText("npm run dev");
    const sized = container.querySelector<HTMLElement>("[style*='font-size']");
    expect(sized?.style.fontSize).toBe("17px");
  });
});

describe("keeping itself current", () => {
  it("re-reads on a timer while it is on screen", async () => {
    // The panel is meant to be read at a glance. Behind a refresh button it was only ever right at
    // the moment you clicked — and wrong, convincingly, every moment after. A dev server that opens a
    // port ten seconds into a run crosses no command boundary, so a trigger alone cannot catch it.
    vi.useFakeTimers();
    try {
      useTerminalStore.setState({
        panes: [pane({ key: "a", sessionId: 1 })],
        activeKey: "a",
        bootstrapped: true,
      });
      vi.mocked(terminalApi.activity).mockResolvedValue(ACTIVITY);
      renderTool();
      await vi.advanceTimersByTimeAsync(0);
      const first = vi.mocked(terminalApi.activity).mock.calls.length;

      await vi.advanceTimersByTimeAsync(11_000);

      expect(vi.mocked(terminalApi.activity).mock.calls.length).toBeGreaterThan(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the tree guides", () => {
  it("draws the elbow short on a last child and full height otherwise", async () => {
    // The computed guide has to REACH THE DOM. A value that is computed correctly and never rendered
    // looks identical from the outside — the same trap rule:content-size pins per tool. The logic
    // itself is covered in lib/processTree.test.ts, where it belongs.
    useUiStore.setState({ locale: "en" });
    useTerminalStore.setState({ panes: [pane({ key: "p1", sessionId: 7 })], activeKey: "p1" });
    vi.mocked(terminalApi.activity).mockResolvedValue(ACTIVITY);
    const { container } = renderTool();
    await screen.findByText("npm run dev");

    // One guide cell per level of depth: the fixture is zsh -> npm -> node, so three cells in all.
    expect(container.querySelectorAll("[style*='width: 10px']").length).toBe(3);
    // A straight chain, so every row is its parent's last child and every elbow is half height. A
    // full-height one here would mean a sibling the fixture does not have.
    expect(container.querySelector(".h-1\\/2")).toBeTruthy();
  });
});
