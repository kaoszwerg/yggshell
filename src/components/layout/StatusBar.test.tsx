import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StatusBar } from "./StatusBar";
import { formatElapsed, formatLoad, loadPressure, shortPath } from "../../lib/statusFormat";
import { APP_NAME } from "../../lib/app";
import { useUiStore } from "../../store/ui";
import { useTerminalStore } from "../../store/terminal";
import { pane } from "../../test/panes";
import { defaultLayout, makeItem } from "../../lib/statusBar";
import type { BuildInfo } from "../../bindings/BuildInfo";

vi.mock("../../api/commands", () => ({
  api: {
    buildInfo: vi.fn(),
    systemLoad: vi.fn(),
  },
}));

import { api } from "../../api/commands";

const build: BuildInfo = {
  version: "0.1.0",
  channel: "dev",
  debug: true,
  git_sha: "abc1234",
  git_dirty: false,
  commit_date: "2026-07-11T00:00:00Z",
};

function renderStatusBar(props: Parameters<typeof StatusBar>[0] = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StatusBar {...props} />
    </QueryClientProvider>,
  );
}

describe("StatusBar", () => {
  beforeEach(() => {
    useUiStore.setState({ view: "terminal", aboutOpen: false, statusLayout: defaultLayout() });
    useTerminalStore.setState({ panes: [], activeKey: null });
    vi.mocked(api.buildInfo).mockReset();
    vi.mocked(api.buildInfo).mockResolvedValue(build);
    vi.mocked(api.systemLoad).mockReset().mockResolvedValue(null);
  });

  it("opens the About dialog when the build identity is clicked", async () => {
    renderStatusBar();
    const aboutButton = await screen.findByRole("button", {
      name: (name) => name.toLowerCase().includes(APP_NAME.toLowerCase()),
    });

    fireEvent.click(aboutButton);
    expect(useUiStore.getState().aboutOpen).toBe(true);
  });

  it("shows the build version and commit once loaded", async () => {
    renderStatusBar();
    await waitFor(() => expect(api.buildInfo).toHaveBeenCalled());
    expect(await screen.findByText(/v0\.1\.0/)).toBeInTheDocument();
  });

  it("shows the scroll-to-top control only when canScrollTop is true", () => {
    const onScrollTop = vi.fn();
    renderStatusBar({ canScrollTop: true, onScrollTop });

    fireEvent.click(screen.getByRole("button", { name: "Scroll to top" }));
    expect(onScrollTop).toHaveBeenCalledTimes(1);
  });

  it("hides the scroll-to-top control when canScrollTop is false", () => {
    renderStatusBar({ canScrollTop: false });
    expect(screen.queryByRole("button", { name: "Scroll to top" })).toBeNull();
  });
});

/**
 * The bar is assembled by the user, so what it shows is a consequence of a list — not of this
 * component knowing what belongs where. These are the properties that survive any arrangement.
 */
describe("the arrangement", () => {
  it("renders only what is in the layout", () => {
    useUiStore.setState({ statusLayout: [makeItem("version")] });
    useTerminalStore.setState({
      panes: [pane({ key: "a", tmuxSession: "work" })],
      activeKey: "a",
    });
    renderStatusBar();

    expect(screen.queryByText("work")).toBeNull();
  });

  it("renders an item once it is placed", async () => {
    useUiStore.setState({ statusLayout: [makeItem("tmux")] });
    useTerminalStore.setState({
      panes: [pane({ key: "a", tmuxSession: "work" })],
      activeKey: "a",
    });
    renderStatusBar();

    expect(await screen.findByText("work")).toBeInTheDocument();
  });

  it("follows the tab in front, not whichever tab reported last", () => {
    // The whole point of a per-tab context: two tabs are two shells in two places.
    useUiStore.setState({ statusLayout: [makeItem("cwd")] });
    useTerminalStore.setState({
      panes: [pane({ key: "a", cwd: "/home/s/one" }), pane({ key: "b", cwd: "/home/s/two" })],
      activeKey: "b",
    });
    renderStatusBar();

    expect(screen.getByText("…/s/two")).toBeInTheDocument();
    expect(screen.queryByText("…/s/one")).toBeNull();
  });

  it("shows nothing for an item that has nothing to say", () => {
    // A plain shell has no tmux session. An empty slot beats a row of em-dashes.
    useUiStore.setState({ statusLayout: [makeItem("tmux"), makeItem("cwd")] });
    useTerminalStore.setState({ panes: [pane({ key: "a" })], activeKey: "a" });
    const { container } = renderStatusBar();

    expect(container.textContent?.trim()).toBe("");
  });

  it("keeps scroll-to-top even when the user has emptied the bar", async () => {
    // It is not an item, and that is deliberate: it is the only way back to the top of a long view,
    // and it appears and disappears — as an item it would shove the arrangement sideways each time.
    useUiStore.setState({ statusLayout: [] });
    renderStatusBar({ canScrollTop: true, onScrollTop: () => {} });

    expect(await screen.findByRole("button", { name: "Scroll to top" })).toBeInTheDocument();
  });

  it("survives an arrangement with several spacers and separators", () => {
    useUiStore.setState({
      statusLayout: [
        makeItem("spacer"),
        makeItem("version"),
        makeItem("separator"),
        makeItem("spacer"),
      ],
    });
    expect(() => renderStatusBar()).not.toThrow();
  });
});

describe("formatting", () => {
  it("reads an elapsed time at a glance", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_000)).toBe("0:07");
    expect(formatElapsed(71_000)).toBe("1:11");
    expect(formatElapsed(3_764_000)).toBe("1:02:44");
    // A clock that ran backwards (a suspend, a corrected system time) must not print "-1:-3".
    expect(formatElapsed(-5_000)).toBe("0:00");
  });

  it("shortens a path to the part that identifies it", () => {
    expect(shortPath("/home/s/git/yggshell")).toBe("…/git/yggshell");
    expect(shortPath("/home/s")).toBe("/home/s");
    expect(shortPath("/home/steve/x", "/home/steve")).toBe("~/x");
  });
});

describe("formatting the system load", () => {
  it("shortens it to one decimal, which is all a strip this size can use", () => {
    expect(formatLoad(1.42)).toBe("1.4");
    expect(formatLoad(0)).toBe("0.0");
    expect(formatLoad(12.98)).toBe("13.0");
  });

  it("judges load against the number of cores, not on its own", () => {
    // 8 is idle on a 16-core machine and desperate on a 4-core one. Without the division the colour
    // would say something different on every machine.
    expect(loadPressure(8, 16)).toBe("calm");
    expect(loadPressure(8, 4)).toBe("saturated");
    expect(loadPressure(10, 16)).toBe("busy");
  });

  it("survives a core count of zero rather than dividing by it", () => {
    expect(loadPressure(1, 0)).toBe("saturated");
  });
});

describe("the system load item", () => {
  it("shows the one-minute load when the platform has one", async () => {
    vi.mocked(api.systemLoad).mockResolvedValue({ one: 2.4, five: 1.9, fifteen: 1.2, cores: 10 });
    useUiStore.setState({ statusLayout: [makeItem("load")] });
    renderStatusBar();

    expect(await screen.findByText("2.4")).toBeInTheDocument();
  });

  it("shows nothing at all where the platform has no load average", async () => {
    // Windows has none — not a smaller number, none. A zero there would read as an idle machine.
    vi.mocked(api.systemLoad).mockResolvedValue(null);
    useUiStore.setState({ statusLayout: [makeItem("load")] });
    const { container } = renderStatusBar();

    await waitFor(() => expect(api.systemLoad).toHaveBeenCalled());
    expect(container.textContent?.trim()).toBe("");
  });

  it("colours the number by the ratio, not by the raw figure", async () => {
    // 8 on 16 cores is calm; the same 8 on 4 cores is not. Colouring by the bare number would say
    // something different on every machine.
    vi.mocked(api.systemLoad).mockResolvedValue({ one: 8, five: 8, fifteen: 8, cores: 16 });
    useUiStore.setState({ statusLayout: [makeItem("load")] });
    const { unmount } = renderStatusBar();
    expect((await screen.findByText("8.0")).className).toContain("text-fg");
    unmount();

    vi.mocked(api.systemLoad).mockResolvedValue({ one: 8, five: 8, fifteen: 8, cores: 4 });
    renderStatusBar();
    expect((await screen.findByText("8.0")).className).toContain("text-danger");
  });
});
