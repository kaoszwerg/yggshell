import { render, act, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TerminalView } from "./TerminalView";
import { useTerminalStore } from "../store/terminal";

/**
 * The emulator itself is out of scope here — this file tests the wiring between a measured geometry
 * and a backend session, which is where a race lived (see "the `%` at the top of a fresh terminal").
 * So `TerminalSurface` is replaced by something that lets a test *be* the measurement.
 */
let measure: ((rows: number, cols: number) => void) | undefined;

vi.mock("../components/ui/TerminalSurface", () => ({
  TerminalSurface: (props: { onResize: (rows: number, cols: number) => void }) => {
    measure = props.onResize;
    return <div data-testid="surface" />;
  },
}));

const THEMES = [
  { id: "nord", name: "Nord", ansi: [], background: null },
  { id: "ayu", name: "Ayu", ansi: [], background: null },
];

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: { ui_scale: 1, terminal_font_size: 13, terminal_theme: "" } }),
  useTerminalThemes: () => ({ data: THEMES }),
  useTerminalProfiles: () => ({ data: [] }),
}));

vi.mock("../api/terminal", () => ({
  terminalApi: {
    open: vi.fn(),
    resize: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.resolve()),
    cwd: vi.fn(() => Promise.resolve(null)),
    close: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => Promise.resolve(() => {})),
  },
}));

import { terminalApi } from "../api/terminal";

/** Hands back the `open` promise's resolver, so a test decides exactly when the session exists. */
function deferOpen(id: number, tmuxSession: string | null = null) {
  let settle: () => void = () => {};
  const promise = new Promise<{ id: number; tmux_session: string | null }>((resolve) => {
    settle = () => resolve({ id, tmux_session: tmuxSession });
  });
  vi.mocked(terminalApi.open).mockReturnValue(promise);
  return async () => {
    settle();
    await act(async () => {
      await promise;
    });
  };
}

describe("TerminalView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    measure = undefined;
    useTerminalStore.setState({ panes: [], activeKey: null, bootstrapped: false });
    vi.mocked(terminalApi.open).mockResolvedValue({ id: 1, tmux_session: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the session from the first measurement, with that geometry", async () => {
    const opened = deferOpen(1);
    render(<TerminalView />);

    act(() => measure?.(30, 100));
    await opened();

    expect(terminalApi.open).toHaveBeenCalledTimes(1);
    expect(vi.mocked(terminalApi.open).mock.calls[0]?.[0]).toMatchObject({ rows: 30, cols: 100 });
  });

  it("does not open a second session when a measurement lands mid-open", async () => {
    const opened = deferOpen(1);
    render(<TerminalView />);

    act(() => measure?.(30, 100));
    act(() => measure?.(30, 80));
    await opened();

    expect(terminalApi.open).toHaveBeenCalledTimes(1);
  });

  it("applies a geometry measured while the session was still opening", async () => {
    // The race that produced a stray `%` on the first line: the settings query resolves a moment
    // after the terminal mounts, the font size changes, the pane re-measures — and that measurement
    // used to be dropped because the open call had not come back yet. The shell then drew its first
    // prompt for a window WIDER than the one on screen, its end-of-line mark wrapped onto a second
    // line, and the erase that should have removed it cleared the wrong line.
    const opened = deferOpen(7);
    render(<TerminalView />);

    act(() => measure?.(30, 100));
    act(() => measure?.(24, 80));
    await opened();

    expect(terminalApi.resize).toHaveBeenCalledWith(7, 24, 80);
  });

  it("does not resize when the geometry never moved during the open", async () => {
    const opened = deferOpen(7);
    render(<TerminalView />);

    act(() => measure?.(30, 100));
    act(() => measure?.(30, 100));
    await opened();

    expect(terminalApi.resize).not.toHaveBeenCalled();
  });

  it("passes later measurements straight to the live session", async () => {
    const opened = deferOpen(7);
    render(<TerminalView />);

    act(() => measure?.(30, 100));
    await opened();
    act(() => measure?.(40, 120));

    expect(terminalApi.resize).toHaveBeenCalledWith(7, 40, 120);
  });

  it("lets a failed open be retried by the next measurement", async () => {
    vi.mocked(terminalApi.open).mockRejectedValueOnce(new Error("no shell"));
    render(<TerminalView />);

    await act(async () => {
      measure?.(30, 100);
    });
    vi.mocked(terminalApi.open).mockResolvedValue({ id: 2, tmux_session: null });
    await act(async () => {
      measure?.(30, 100);
    });

    expect(terminalApi.open).toHaveBeenCalledTimes(2);
  });

  // The tmux-detach regression, pinned. A session ends underneath a pending call constantly — the
  // user typed `exit`, tmux detached, the tab closed a keystroke ago — and the backend answers
  // "no terminal session N". Those rejections used to be discarded with `void`, which means they
  // reached the app's global handler and became a FATAL SCREEN over the whole interface.
  describe("a session that ends underneath a pending call", () => {
    it("does not let a rejected resize escape", async () => {
      const opened = deferOpen(3);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      vi.mocked(terminalApi.resize).mockRejectedValueOnce(new Error("no terminal session 3"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await act(async () => {
        measure?.(40, 120);
      });

      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("does not let a rejected close escape when the tab goes away", async () => {
      const opened = deferOpen(4);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      vi.mocked(terminalApi.close).mockRejectedValueOnce(new Error("no terminal session 4"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const key = useTerminalStore.getState().panes[0]?.key ?? "";
      await act(async () => {
        useTerminalStore.getState().closePane(key);
      });

      expect(terminalApi.close).toHaveBeenCalledWith(4);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("does not let a rejected working-directory poll escape", async () => {
      const opened = deferOpen(5);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      vi.mocked(terminalApi.cwd).mockRejectedValue(new Error("no terminal session 5"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await opened();
      await act(async () => {
        await Promise.resolve();
      });

      // Asked at all — the poll used to start before the session existed, so its first ask hit a
      // null id and did nothing, leaving the Git tool blank for a whole tick.
      expect(terminalApi.cwd).toHaveBeenCalledWith(5);
      // …and the rejection was handled. vitest fails a run on an unhandled one, so reaching here is
      // the proof; the warning is what makes it visible rather than silent.
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  it("opens with the profile its tab was created for — a reference, never a command line", async () => {
    // ADR-PROJ-001 §5: the webview may say WHICH profile, never what to run. The backend turns the
    // id into a program, which is the whole difference between choosing and executing.
    useTerminalStore.setState({ panes: [], activeKey: null, bootstrapped: true });
    useTerminalStore.getState().openPane("work");

    const opened = deferOpen(9);
    render(<TerminalView />);
    act(() => measure?.(30, 100));
    await opened();

    expect(vi.mocked(terminalApi.open).mock.calls[0]?.[0]).toMatchObject({ profile: "work" });
  });

  it("opens with no profile when the tab was not given one", async () => {
    const opened = deferOpen(10);
    render(<TerminalView />);
    act(() => measure?.(30, 100));
    await opened();

    expect(vi.mocked(terminalApi.open).mock.calls[0]?.[0]).toMatchObject({ profile: null });
  });

  // The session belongs to the TAB, not to the React component. Anything else means a shell dies for
  // a reason the user never asked for.
  describe("what ends a session, and what must not", () => {
    it("closes the session when the tab is removed", async () => {
      const opened = deferOpen(11);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      const key = useTerminalStore.getState().panes[0]?.key ?? "";
      await act(async () => {
        useTerminalStore.getState().closePane(key);
      });

      expect(terminalApi.close).toHaveBeenCalledWith(11);
    });

    it("does NOT close it when the view merely unmounts", async () => {
      // Navigating to Settings or Logs unmounts this view, and StrictMode unmounts it in
      // development for its own reasons. Either one used to take every running shell down with it —
      // a build, an agent, an ssh session, gone because somebody looked at a preferences page.
      const opened = deferOpen(12);
      const view = render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      await act(async () => {
        view.unmount();
      });

      expect(terminalApi.close).not.toHaveBeenCalled();
      expect(useTerminalStore.getState().panes).toHaveLength(1);
    });

    it("survives a mount, unmount and mount without losing its tabs", async () => {
      // Exactly what StrictMode does to every component in development.
      const opened = deferOpen(13);
      const first = render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();
      const before = useTerminalStore.getState().panes.map((p) => p.key);

      await act(async () => {
        first.unmount();
      });
      render(<TerminalView />);

      expect(terminalApi.close).not.toHaveBeenCalled();
      expect(useTerminalStore.getState().panes.map((p) => p.key)).toEqual(before);
    });
  });

  // A shell is decided once, when the process starts. A colour scheme is decided every frame — the
  // emulator is repainted live. Treating them the same made "give this tab another scheme" mean
  // "open another tab", which is a different request.
  describe("the colour scheme of one tab", () => {
    /** Open the picker on an already-rendered pane. */
    async function reopenPicker() {
      fireEvent.contextMenu(screen.getByTestId("surface"));
      fireEvent.click(await screen.findByRole("menuitem", { name: /Colour scheme/ }));
      return screen.findByRole("group", { name: "Colour scheme for this terminal" });
    }

    async function openPicker() {
      const opened = deferOpen(20);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();
      return reopenPicker();
    }

    it("is reachable from the terminal's own context menu", async () => {
      const picker = await openPicker();
      expect(picker).toBeTruthy();
      expect(screen.getByRole("button", { name: "Nord" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Ayu" })).toBeTruthy();
    });

    it("stores the choice on that tab alone", async () => {
      await openPicker();
      fireEvent.click(screen.getByRole("button", { name: "Ayu" }));

      const pane = useTerminalStore.getState().panes[0];
      expect(pane?.themeId).toBe("ayu");
    });

    it("can be handed back to the settings", async () => {
      await openPicker();
      fireEvent.click(screen.getByRole("button", { name: "Ayu" }));
      await reopenPicker();
      fireEvent.click(screen.getByRole("button", { name: "Follow the settings" }));

      expect(useTerminalStore.getState().panes[0]?.themeId).toBeNull();
    });

    it("closes on Escape without changing anything", async () => {
      await openPicker();
      fireEvent.keyDown(window, { key: "Escape" });

      expect(screen.queryByRole("group", { name: "Colour scheme for this terminal" })).toBeNull();
      expect(useTerminalStore.getState().panes[0]?.themeId).toBeNull();
    });
  });

  // Detaching from tmux is not the end of anything: the session keeps running, and the user asked to
  // be back in a terminal. Closing the tab took away the one thing they had not asked to lose.
  describe("detaching from tmux", () => {
    /** The exit the backend reports; `onExit` was captured when the view mounted. */
    function exit(payload: { id: number; code: number | null; tmux_client: boolean }) {
      const handler = vi.mocked(terminalApi.onExit).mock.calls[0]?.[0];
      act(() => handler?.(payload));
    }

    it("puts a plain shell in the same tab instead of closing it", async () => {
      const opened = deferOpen(30);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();
      const key = useTerminalStore.getState().panes[0]?.key;
      vi.mocked(terminalApi.open).mockResolvedValue({ id: 31, tmux_session: null });

      exit({ id: 30, code: 0, tmux_client: true });

      const pane = useTerminalStore.getState().panes[0];
      expect(pane?.key).toBe(key);
      expect(pane?.plain).toBe(true);
      expect(pane?.generation).toBe(1);
    });

    it("opens that replacement session without tmux", async () => {
      const opened = deferOpen(32);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();
      vi.mocked(terminalApi.open).mockResolvedValue({ id: 33, tmux_session: null });

      await act(async () => {
        exit({ id: 32, code: 0, tmux_client: true });
      });

      const last = vi.mocked(terminalApi.open).mock.calls.at(-1)?.[0];
      expect(last).toMatchObject({ plain: true, rows: 30, cols: 100 });
    });

    it("still closes the tab when the SHELL exits", async () => {
      const opened = deferOpen(34);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      exit({ id: 34, code: 0, tmux_client: false });

      expect(useTerminalStore.getState().panes).toHaveLength(0);
    });

    it("still closes the tab when the tmux client dies badly", async () => {
      // A detach is a clean exit. A client that died is a failure, and the tab goes with it rather
      // than silently becoming something else.
      const opened = deferOpen(35);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      exit({ id: 35, code: 1, tmux_client: true });

      expect(useTerminalStore.getState().panes).toHaveLength(0);
    });
  });
});
