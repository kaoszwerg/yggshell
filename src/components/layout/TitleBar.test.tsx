import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TitleBar } from "./TitleBar";
import { APP_NAME, APP_TAGLINE } from "../../lib/app";
import type { BuildInfo } from "../../bindings/BuildInfo";
import { clearPrimarySelection, setPrimarySelection } from "../../lib/primarySelection";
import { clearPasteTargets, registerPasteTarget } from "../../lib/terminalHandles";
import { useTerminalStore } from "../../store/terminal";
import { pane } from "../../test/panes";
import { useUiStore } from "../../store/ui";

// TitleBar imports this SVG for the app icon; the build pipeline normally provides it, jsdom needs a stub.
vi.mock("../../../src-tauri/icons/icon.svg", () => ({ default: "icon.svg" }));

vi.mock("../../api/commands", () => ({
  api: {
    buildInfo: vi.fn(),
  },
}));

vi.mock("../../hooks/useSettings", () => ({
  useTerminalProfiles: () => ({
    data: [{ id: "work", name: "Work", shell: null, cwd: null, theme: null }],
  }),
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
    // The name is rendered as small caps — several spans — so the accessible name is what carries
    // it whole. A screen reader should hear the product, not four fragments of it.
    expect(screen.getByLabelText(APP_NAME)).toBeInTheDocument();
    expect(screen.getByLabelText(APP_NAME).textContent).toBe(APP_NAME.toUpperCase());
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
        panes: [pane({ key: "term-0", title: "zsh", cwd: null })],
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
          pane({ key: "term-0", title: "zsh", cwd: null }),
          pane({ key: "term-1", title: "cargo", cwd: null }),
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
        panes: [pane({ key: "term-0", title: "zsh", cwd: null })],
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
          pane({ key: "term-0", title: "zsh", cwd: null }),
          pane({ key: "term-1", title: "cargo", cwd: null }),
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
      registerPasteTarget("term-1", { paste, clear: vi.fn() });
      setPrimarySelection("cargo test --locked");
      useTerminalStore.setState({
        panes: [
          pane({ key: "term-0", title: "zsh", cwd: null }),
          pane({ key: "term-1", title: "cargo", cwd: null }),
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
      registerPasteTarget("term-1", { paste, clear: vi.fn() });
      useTerminalStore.setState({
        panes: [
          pane({ key: "term-0", title: "zsh", cwd: null }),
          pane({ key: "term-1", title: "cargo", cwd: null }),
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

  // This menu shipped doing nothing: ContextMenu attaches its handler to whatever element it is
  // given, and `<Tabs>` — a component that does not forward unknown props to a DOM node — swallowed
  // it without a word. No error, no warning, a right-click that simply did not respond.
  describe("right-clicking the tab strip", () => {
    it("offers a new terminal and every saved profile", async () => {
      useTerminalStore.setState({
        panes: [pane({ key: "a", title: "Terminal 1", cwd: null })],
        activeKey: "a",
      });
      renderTitleBar({
        version: "0.1.0",
        channel: "dev",
        debug: true,
        git_sha: "abc1234",
        git_dirty: false,
        commit_date: "2026-07-31T00:00:00Z",
      });

      fireEvent.contextMenu(screen.getByRole("tablist", { name: "Terminals" }));

      expect(await screen.findByRole("menuitem", { name: "New terminal" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Work" })).toBeTruthy();
    });

    it("opens a tab carrying the profile that was chosen", async () => {
      useTerminalStore.setState({
        panes: [pane({ key: "a", title: "Terminal 1", cwd: null })],
        activeKey: "a",
      });
      renderTitleBar({
        version: "0.1.0",
        channel: "dev",
        debug: true,
        git_sha: "abc1234",
        git_dirty: false,
        commit_date: "2026-07-31T00:00:00Z",
      });

      fireEvent.contextMenu(screen.getByRole("tablist", { name: "Terminals" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Work" }));

      const panes = useTerminalStore.getState().panes;
      expect(panes).toHaveLength(2);
      expect(panes.at(-1)?.profileId).toBe("work");
    });
  });

  it("draws the name in small caps, following its own casing", () => {
    // `YggShell` → `Y` `GG` `S` `HELL`, with the two real capitals at full height. Driven by the
    // name, so renaming the app in app.identity.json needs no change here.
    renderTitleBar({
      version: "0.1.0",
      channel: "dev",
      debug: true,
      git_sha: "abc1234",
      git_dirty: false,
      commit_date: "2026-07-31T00:00:00Z",
    });

    const runs = Array.from(screen.getByLabelText(APP_NAME).children) as HTMLElement[];
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.map((r) => r.textContent).join("")).toBe(APP_NAME.toUpperCase());
    // The first letter is a capital in the name, so it is not shrunk; the run after it is.
    expect(runs[0]?.style.fontSize).toBe("");
    expect(runs[1]?.style.fontSize).not.toBe("");
  });
});

describe("dragging the window", () => {
  // The defect this pins: the tab strip takes every pixel it is offered — deliberately, so tabs are
  // not cut off on a wide window — and that left the app mark as the only draggable place. About
  // thirty pixels, at the far left, which is neither where anyone reaches nor discoverable at all.
  it("keeps a grab area that exists however full the strip is", () => {
    const { container } = renderTitleBar({ channel: "release" } as BuildInfo);

    const regions = container.querySelectorAll("[data-tauri-drag-region]");
    expect(regions.length).toBeGreaterThan(1);
    // One of them has a width of its own rather than being whatever the tabs left over.
    expect(container.querySelector("[data-tauri-drag-region].w-8")).not.toBeNull();
  });
});
