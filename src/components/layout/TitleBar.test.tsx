import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TitleBar } from "./TitleBar";
import { APP_NAME, APP_TAGLINE } from "../../lib/app";
import type { BuildInfo } from "../../bindings/BuildInfo";
import { clearPrimarySelection, setPrimarySelection } from "../../lib/primarySelection";
import { clearPasteTargets, registerPasteTarget } from "../../lib/terminalHandles";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";

// TitleBar imports this SVG for the app icon; the build pipeline normally provides it, jsdom needs a stub.
vi.mock("../../../src-tauri/icons/icon.svg", () => ({ default: "icon.svg" }));

vi.mock("../../api/commands", () => ({
  api: {
    buildInfo: vi.fn(),
  },
}));

const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize, toggleMaximize, close, label: "main" }),
}));

import { api } from "../../api/commands";

function renderTitleBar(build: BuildInfo) {
  vi.mocked(api.buildInfo).mockResolvedValue(build);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TitleBar />
    </QueryClientProvider>,
  );
}

const devBuild: BuildInfo = {
  version: "0.1.0",
  channel: "dev",
  debug: true,
  git_sha: "abc1234",
  git_dirty: false,
  commit_date: "2026-07-11T00:00:00Z",
};

describe("TitleBar", () => {
  beforeEach(() => {
    minimize.mockReset();
    toggleMaximize.mockReset();
    close.mockReset();
    vi.mocked(api.buildInfo).mockReset();
  });

  it("shows the app name and a dev badge for a dev build", async () => {
    renderTitleBar(devBuild);
    expect(await screen.findByText("Dev")).toBeInTheDocument();
    expect(screen.getAllByText(APP_NAME, { exact: false }).length).toBeGreaterThan(0);
  });

  it("hides the dev badge for a release build", async () => {
    renderTitleBar({ ...devBuild, channel: "release" });
    await waitFor(() => expect(api.buildInfo).toHaveBeenCalled());
    expect(screen.queryByText("Dev")).toBeNull();
  });

  it("wires the window controls to the Tauri window API", () => {
    renderTitleBar(devBuild);

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(minimize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    expect(toggleMaximize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  describe("terminal tabs", () => {
    beforeEach(() => {
      useTerminalStore.setState({ panes: [], activeKey: null, bootstrapped: false });
      useUiStore.setState({ view: "logs" });
      clearPrimarySelection();
      clearPasteTargets();
    });

    it("shows the tagline while no terminal is open", () => {
      renderTitleBar(devBuild);

      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.getByText(APP_TAGLINE)).toBeInTheDocument();
    });

    it("gives the tabs the tagline's space once a terminal exists", () => {
      // Screen space in a terminal belongs to the terminal (ADR-PROJ-001): the tabs cost no extra
      // height precisely because they take the room the tagline was using.
      useTerminalStore.setState({
        panes: [{ key: "term-0", title: "zsh", cwd: null, profileId: null }],
        activeKey: "term-0",
      });
      renderTitleBar(devBuild);

      expect(screen.getByRole("tablist", { name: "Terminals" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "zsh" })).toBeInTheDocument();
      expect(screen.queryByText(APP_TAGLINE)).toBeNull();
    });

    it("switches to the terminal view when a tab is clicked from elsewhere", () => {
      useTerminalStore.setState({
        panes: [
          { key: "term-0", title: "zsh", cwd: null, profileId: null },
          { key: "term-1", title: "cargo", cwd: null, profileId: null },
        ],
        activeKey: "term-0",
      });
      renderTitleBar(devBuild);

      fireEvent.click(screen.getByRole("tab", { name: "cargo" }));

      // Reaching for a tab is asking to SEE that terminal — selecting it while the user is looking
      // at Settings would do nothing visible at all.
      expect(useTerminalStore.getState().activeKey).toBe("term-1");
      expect(useUiStore.getState().view).toBe("terminal");
    });

    it("opens a terminal from the add control and shows it", () => {
      useTerminalStore.setState({
        panes: [{ key: "term-0", title: "zsh", cwd: null, profileId: null }],
        activeKey: "term-0",
      });
      renderTitleBar(devBuild);

      fireEvent.click(screen.getByRole("button", { name: "New terminal" }));

      expect(useTerminalStore.getState().panes).toHaveLength(2);
      expect(useUiStore.getState().view).toBe("terminal");
    });

    it("closes a terminal from its tab without switching to it", () => {
      useTerminalStore.setState({
        panes: [
          { key: "term-0", title: "zsh", cwd: null, profileId: null },
          { key: "term-1", title: "cargo", cwd: null, profileId: null },
        ],
        activeKey: "term-0",
      });
      renderTitleBar(devBuild);

      fireEvent.click(screen.getByRole("button", { name: "Close cargo" }));

      expect(useTerminalStore.getState().panes.map((p) => p.key)).toEqual(["term-0"]);
      expect(useUiStore.getState().view).toBe("logs");
    });

    it("pastes into a terminal on middle-click, and never closes it", () => {
      // Middle-click means paste everywhere in this app — on the tab exactly as inside the terminal.
      // One gesture that closes here and pastes there is how a user loses a running process.
      const paste = vi.fn();
      registerPasteTarget("term-1", { paste });
      setPrimarySelection("cargo test --locked");
      useTerminalStore.setState({
        panes: [
          { key: "term-0", title: "zsh", cwd: null, profileId: null },
          { key: "term-1", title: "cargo", cwd: null, profileId: null },
        ],
        activeKey: "term-0",
      });
      renderTitleBar(devBuild);

      fireEvent(
        screen.getByRole("tab", { name: "cargo" }),
        new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
      );

      expect(paste).toHaveBeenCalledExactlyOnceWith("cargo test --locked");
      expect(useTerminalStore.getState().panes).toHaveLength(2);
      // Brought to the front first: text landing in a terminal the user cannot see is alarming.
      expect(useTerminalStore.getState().activeKey).toBe("term-1");
      expect(useUiStore.getState().view).toBe("terminal");
    });

    it("still shows the tab on middle-click when nothing is selected", () => {
      const paste = vi.fn();
      registerPasteTarget("term-1", { paste });
      useTerminalStore.setState({
        panes: [
          { key: "term-0", title: "zsh", cwd: null, profileId: null },
          { key: "term-1", title: "cargo", cwd: null, profileId: null },
        ],
        activeKey: "term-0",
      });
      renderTitleBar(devBuild);

      fireEvent(
        screen.getByRole("tab", { name: "cargo" }),
        new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
      );

      expect(paste).not.toHaveBeenCalled();
      expect(useTerminalStore.getState().activeKey).toBe("term-1");
    });
  });
});
