import { useEffect, useRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";
import { APP_NAME } from "./lib/app";

vi.mock("./api/commands", () => ({
  api: {
    appVersion: vi.fn().mockResolvedValue("0.1.0"),
    // The app root asks for launch requests queued before the interface existed (`ygg <dir>` on a
    // cold start). Nothing queued here.
    pendingLaunches: vi.fn().mockResolvedValue([]),
    buildInfo: vi.fn().mockResolvedValue({
      version: "0.1.0",
      channel: "dev",
      debug: true,
      git_sha: "abc1234",
      git_dirty: false,
      commit_date: "2026-07-11T00:00:00Z",
    }),
    getSettings: vi.fn().mockResolvedValue({ ui_scale: 1 }),
    updateSettings: vi.fn(),
    getRecentLogs: vi.fn().mockResolvedValue([]),
    openExternal: vi.fn(),
  },
}));

// The TitleBar imports an SVG that the build pipeline normally provides; in jsdom we stub it.
vi.mock("../src-tauri/icons/icon.svg", () => ({ default: "icon.svg" }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    label: "main",
  }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  // `onDragDropEvent` is here because Settings' Appearance section — the one that renders by
  // default — carries the theme import drop target. It was reached only from the Terminal section
  // until colour schemes moved, so this mock did not need it before.
  getCurrentWebview: () => ({
    setZoom: vi.fn().mockResolvedValue(undefined),
    onDragDropEvent: vi.fn().mockResolvedValue(() => undefined),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock("./api/terminal", () => ({
  terminalApi: {
    open: vi.fn().mockResolvedValue(1),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ cwd: null, command: null, session: null, busy: false }),
    close: vi.fn().mockResolvedValue(undefined),
    onExit: vi.fn().mockResolvedValue(() => undefined),
  },
}));

vi.mock("./api/git", () => ({
  gitApi: { snapshot: vi.fn().mockResolvedValue(null) },
}));

// The real emulator measures 0×0 in jsdom and never reports a geometry, so no session would ever be
// opened and this suite would pass while testing nothing. This stand-in measures once per mount,
// exactly as the real one does — which is what makes a remount visible as a second `open`.
vi.mock("./components/ui/TerminalSurface", () => ({
  TerminalSurface: (props: { onResize: (rows: number, cols: number) => void }) => {
    const reported = useRef(false);
    useEffect(() => {
      if (reported.current) return;
      reported.current = true;
      props.onResize(30, 100);
    }, [props]);
    return <div data-testid="surface" />;
  },
}));

import { terminalApi } from "./api/terminal";
import { useUiStore } from "./store/ui";
import { useTerminalStore } from "./store/terminal";

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App shell", () => {
  // Every test here renders the whole app, and the app opens a terminal on its own. Without this the
  // call counts below would be the suite's running total rather than this test's.
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ view: "terminal", activeTool: null });
    useTerminalStore.setState({ panes: [], activeKey: null, bootstrapped: false });
  });

  it("renders the HUD title bar with the app name", async () => {
    renderApp();
    expect(await screen.findAllByText(APP_NAME, { exact: false })).toBeTruthy();
  });

  it("shows the primary navigation rail", () => {
    renderApp();
    expect(screen.getByLabelText("Primary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terminal" })).toBeInTheDocument();
    expect(screen.getByLabelText("Logs")).toBeInTheDocument();
    expect(screen.getByLabelText("Settings")).toBeInTheDocument();
  });

  // The bug this pins: navigating to Settings unmounted the terminal view, whose panes closed their
  // sessions on unmount — so a glance at a preferences page killed every running shell, and coming
  // back left an empty workspace. A view is a place you look, not a reason to take a build down.
  describe("navigating away from the terminal", () => {
    it("keeps every terminal alive and open", async () => {
      renderApp();

      await act(async () => {
        useTerminalStore.getState().openPane();
      });
      const before = useTerminalStore.getState().panes.map((p) => p.key);
      expect(before.length).toBeGreaterThan(0);

      await act(async () => {
        fireEvent.click(screen.getByLabelText("Settings"));
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText("Logs"));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
      });

      expect(terminalApi.close).not.toHaveBeenCalled();
      expect(useTerminalStore.getState().panes.map((p) => p.key)).toEqual(before);
      // …and no SECOND session for the same tab. Unmounting the view destroys each emulator and
      // resets the pane's session id, so coming back would open a fresh PTY while the first one kept
      // running with nobody reading it — an orphan per navigation, and a lost scrollback each time.
      expect(terminalApi.open).toHaveBeenCalledTimes(before.length);
    });
  });
});
