import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TerminalView } from "./TerminalView";
import { useTerminalStore } from "../store/terminal";
import { pane } from "../test/panes";

/**
 * The emulator itself is out of scope here — this file tests the wiring between a measured geometry
 * and a backend session, which is where a race lived (see "the `%` at the top of a fresh terminal").
 * So `TerminalSurface` is replaced by something that lets a test *be* the measurement.
 */
let measure: ((rows: number, cols: number) => void) | undefined;

/**
 * Every mounted pane's measurement, in mount order.
 *
 * `measure` alone holds only the LAST one — every surface that mounts overwrites it — which is fine
 * while a test has one tab and silently wrong the moment it has two: only one session would ever be
 * opened, and a test about two tabs would pass by measuring neither of them.
 */
const measures: ((rows: number, cols: number) => void)[] = [];

let surfaceProps: Record<string, unknown> = {};

vi.mock("../components/ui/TerminalSurface", () => ({
  TerminalSurface: (props: { onResize: (rows: number, cols: number) => void }) => {
    measure = props.onResize;
    measures.push(props.onResize);
    surfaceProps = props as unknown as Record<string, unknown>;
    return <div data-testid="surface" />;
  },
}));

const THEMES = [
  { id: "nord", name: "Nord", ansi: [], background: "#2e3440" },
  { id: "ayu", name: "Ayu", ansi: [], background: null },
];

// Filing a note from the terminal's context menu goes through react-query, and this suite renders
// the view bare. Mocked rather than wrapped in a provider: this is a suite about the terminal, and
// the capture has its own tests where the mutation is the subject.
vi.mock("../hooks/useCaptureNote", () => ({
  useCaptureNote: () => ({ mutate: vi.fn() }),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({
    data: { ui_scale: 1, terminal_font_size: 13, terminal_theme: "", copy_on_select: true },
  }),
  useTerminalThemes: () => ({ data: THEMES }),
  useTerminalProfiles: () => ({ data: [] }),
}));

vi.mock("../api/terminal", () => ({
  terminalApi: {
    open: vi.fn(),
    resize: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.resolve()),
    status: vi.fn(() =>
      Promise.resolve({ cwd: null, command: null, session: null, busy: false, agent_turn: null }),
    ),
    close: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => Promise.resolve(() => {})),
  },
}));

vi.mock("../api/commands", () => ({
  api: { openExternal: vi.fn(() => Promise.resolve()) },
}));

import { terminalApi } from "../api/terminal";
import { api } from "../api/commands";

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
    measures.length = 0;
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

    it("does not let a rejected status poll escape", async () => {
      const opened = deferOpen(5);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      vi.mocked(terminalApi.status).mockRejectedValue(new Error("no terminal session 5"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await opened();
      await act(async () => {
        await Promise.resolve();
      });

      // Asked at all — the poll used to start before the session existed, so its first ask hit a
      // null id and did nothing, leaving the Git tool blank for a whole tick.
      expect(terminalApi.status).toHaveBeenCalledWith(5);
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

    it("offers the built-in scheme as a choice of its own", async () => {
      // Not the same as "follow the settings": a tab set to Yggdrasil stays on it whatever the
      // setting is later changed to, and there would be no way to say that without a named id.
      await openPicker();
      fireEvent.click(screen.getByRole("button", { name: "Yggdrasil" }));

      expect(useTerminalStore.getState().panes[0]?.themeId).toBe("yggdrasil");
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

  it("passes the copy-on-select preference down to the emulator", async () => {
    // The emulator owns the selection; the setting has to reach it or it is decoration.
    const opened = deferOpen(40);
    render(<TerminalView />);
    act(() => measure?.(30, 100));
    await opened();

    expect(surfaceProps.copyOnSelect).toBe(true);
  });

  it("routes a clicked link through the backend, never the webview", async () => {
    // ADR-PROJ-001: the webview does not get to navigate. `open_external` also refuses anything that
    // is not http(s), which is the check that matters for a URL out of somebody else's log output.
    const opened = deferOpen(41);
    render(<TerminalView />);
    act(() => measure?.(30, 100));
    await opened();

    (surfaceProps.onLink as (url: string) => void)("https://example.com");
    expect(api.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  // Restoring the workspace is only worth anything if the shells come back where they were. This
  // shipped broken once: the pane held a slot for the restored directory and nothing ever filled it.
  describe("a restored tab", () => {
    it("opens its shell in the directory it was in", async () => {
      useTerminalStore.setState({
        panes: [pane({ key: "term-0", cwd: "/Users/steve/git-projects/private/yggshell" })],
        activeKey: "term-0",
        bootstrapped: true,
      });
      const opened = deferOpen(50);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      expect(vi.mocked(terminalApi.open).mock.calls[0]?.[0]).toMatchObject({
        cwd: "/Users/steve/git-projects/private/yggshell",
      });
    });

    it("sends no directory for a tab opened in this run", async () => {
      const opened = deferOpen(51);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      expect(vi.mocked(terminalApi.open).mock.calls[0]?.[0]?.cwd).toBeUndefined();
    });

    it("does not send it AGAIN when the tab starts a second session", async () => {
      // After a tmux detach the shell decides where it is; jumping back to where the tab started
      // would undo whatever the user had done since.
      useTerminalStore.setState({
        panes: [pane({ key: "term-0", cwd: "/repo" })],
        activeKey: "term-0",
        bootstrapped: true,
      });
      const opened = deferOpen(52);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      vi.mocked(terminalApi.open).mockResolvedValue({ id: 53, tmux_session: null });
      await act(async () => {
        useTerminalStore.getState().detachToShell("term-0");
      });

      expect(vi.mocked(terminalApi.open).mock.calls.at(-1)?.[0]?.cwd).toBeUndefined();
    });

    it("returns to the tmux session it was in, by name", async () => {
      // The reason tmux is here at all. Its sessions outlive a crash on their own — but a tab that
      // comes back merely NUMBERED lands wherever its position puts it, and the backend numbers by
      // counting the tabs already open. Close one tab before the crash and this tab opens somebody
      // else's session, while the one holding the build runs on with nothing pointing at it.
      useTerminalStore.setState({
        panes: [pane({ key: "term-0", tmuxSession: "yggshell-3" })],
        activeKey: "term-0",
        bootstrapped: true,
      });
      const opened = deferOpen(54, "yggshell-3");
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      expect(vi.mocked(terminalApi.open).mock.calls[0]?.[0]).toMatchObject({
        tmuxSession: "yggshell-3",
      });
    });

    it("names the tab after the session it came back to", async () => {
      // Reported from a restored workspace: the names were carried into the BACKEND correctly and
      // then shown nowhere. Inside tmux the shell's own title (OSC 0/2) is usually swallowed and
      // never arrives, so every tab read the same word and nothing said which session it held.
      useTerminalStore.setState({
        panes: [pane({ key: "term-0", tmuxSession: "yggshell-3" })],
        activeKey: "term-0",
        bootstrapped: true,
      });
      const opened = deferOpen(59, "yggshell-3");
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      expect(useTerminalStore.getState().panes[0]?.title).toBe("yggshell-3");
    });

    it("falls back to a plain name when there is no session to name it after", async () => {
      const opened = deferOpen(60);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      expect(useTerminalStore.getState().panes[0]?.title).toBe("Terminal");
    });

    it("sends no session for a tab that has never been in tmux", async () => {
      const opened = deferOpen(55);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      expect(vi.mocked(terminalApi.open).mock.calls[0]?.[0]?.tmuxSession).toBeUndefined();
    });

    it("does not send it again when the tab asks for a NEW session", async () => {
      // A detach means "put me back in a terminal". Handing the old name back would return the user
      // to the very work they just asked to leave — the same trap as the restored directory above.
      useTerminalStore.setState({
        panes: [pane({ key: "term-0", tmuxSession: "yggshell-3" })],
        activeKey: "term-0",
        bootstrapped: true,
      });
      const opened = deferOpen(56, "yggshell-3");
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      vi.mocked(terminalApi.open).mockResolvedValue({ id: 57, tmux_session: null });
      await act(async () => {
        useTerminalStore.getState().detachToShell("term-0");
      });

      expect(vi.mocked(terminalApi.open).mock.calls.at(-1)?.[0]?.tmuxSession).toBeUndefined();
    });

    it("comes back the way it was when tabs were mixed", async () => {
      // The case a workspace is actually in: one tab in tmux, the one beside it deliberately not.
      // Each must return as itself. Putting a tmux session into a tab the user had left tmux in is
      // the app overruling a decision they made, in the place they would least think to look — and it
      // is exactly the asymmetry that appeared once the tmux half started restoring properly.
      useTerminalStore.setState({
        panes: [
          pane({ key: "term-0", tmuxSession: "yggshell", plain: false }),
          pane({ key: "term-1", tmuxSession: null, plain: true }),
        ],
        activeKey: "term-0",
        bootstrapped: true,
      });
      const opened = deferOpen(58, "yggshell");
      render(<TerminalView />);
      // BOTH panes: they are all mounted at once, and this test is about what each of them asks for.
      act(() => measures.forEach((m) => m(30, 100)));
      await opened();

      const calls = vi.mocked(terminalApi.open).mock.calls.map((c) => c[0]);
      const tmuxTab = calls.find((c) => c?.tmuxSession === "yggshell");
      const plainTab = calls.find((c) => c?.plain === true);
      expect(tmuxTab).toMatchObject({ plain: false });
      expect(plainTab?.tmuxSession).toBeUndefined();
    });
  });

  // The line along the top edge — iTerm2's idea, our treatment. Its whole value is that it says
  // "THIS terminal", so per-pane state is the part worth pinning.
  describe("the activity line", () => {
    it("follows what the shell reports, straight from OSC 133", async () => {
      const opened = deferOpen(60);
      const { container } = render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      const line = () => container.querySelector("[data-activity]") as HTMLElement;
      expect(line().dataset.activity).toBe("idle");

      act(() => (surfaceProps.onActivity as (a: unknown) => void)({ state: "running" }));
      expect(line().dataset.activity).toBe("running");

      act(() => (surfaceProps.onActivity as (a: unknown) => void)({ state: "finished", exit: 0 }));
      expect(line().dataset.activity).toBe("ok");
    });

    it("marks a failure differently from a success", async () => {
      const opened = deferOpen(61);
      const { container } = render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      act(() => (surfaceProps.onActivity as (a: unknown) => void)({ state: "finished", exit: 1 }));
      expect((container.querySelector("[data-activity]") as HTMLElement).dataset.activity).toBe(
        "failed",
      );
    });

    it("takes the tmux poll's word for it when there is no OSC 133", async () => {
      // Inside tmux the sequences are swallowed, so `busy` from `#{pane_current_command}` is all
      // there is — no exit status, just running or not.
      vi.mocked(terminalApi.status).mockResolvedValue({
        cwd: "/repo",
        command: "cargo",
        session: null,
        busy: true,
        agent_turn: null,
      });
      const opened = deferOpen(62);
      const { container } = render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();
      await act(async () => {
        await Promise.resolve();
      });

      expect((container.querySelector("[data-activity]") as HTMLElement).dataset.activity).toBe(
        "running",
      );
    });

    it("spans only the terminal, not the window", async () => {
      // The rail and the tool column are not part of what is running.
      const opened = deferOpen(63);
      const { container } = render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      const line = container.querySelector("[data-activity]") as HTMLElement;
      expect(line.className).toContain("absolute");
      expect(line.className).not.toContain("fixed");
      // Edge to edge across the terminal area: inset on either side leaves a visible stub of
      // unanimated line at each end, which reads as the animation being broken.
      expect(line.className).toContain("inset-x-0");
    });

    it("clears a held result by itself, so a signal does not become decoration", async () => {
      vi.useFakeTimers();
      const opened = deferOpen(64);
      const { container } = render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      act(() => (surfaceProps.onActivity as (a: unknown) => void)({ state: "finished", exit: 1 }));
      const line = container.querySelector("[data-activity]") as HTMLElement;
      expect(line.dataset.activity).toBe("failed");

      act(() => void vi.advanceTimersByTime(2500));
      expect(line.dataset.activity).toBe("idle");
      vi.useRealTimers();
    });
  });

  // The scheme's background has to cover the whole pane, not just the character grid: xterm paints
  // behind its cells and nothing beyond, so the padding and the sub-cell remainder showed the app's
  // own grid — the terminal looked like a rectangle floating on a different surface.
  describe("the terminal's own surface", () => {
    it("paints the scheme's background across the whole pane", async () => {
      useTerminalStore.setState({
        panes: [pane({ key: "term-0", themeId: "nord" })],
        activeKey: "term-0",
        bootstrapped: true,
      });
      const opened = deferOpen(70);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      const panel = screen.getByRole("tabpanel", { name: "Terminal" });
      expect(panel).toHaveStyle({ backgroundColor: "#2e3440" });
    });

    it("uses the HUD background when no scheme is chosen", async () => {
      const opened = deferOpen(71);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();

      const panel = screen.getByRole("tabpanel", { name: "Terminal" });
      expect(panel.style.backgroundColor).not.toBe("");
    });
  });

  describe("a tmux session the app did not start", () => {
    it("is picked up from the status poll", async () => {
      // The reported case: tmux_mode is off, the app started no session, but the user typed `tmux`
      // in the shell. Nothing told the app it happened, so the status bar showed nothing for
      // somebody who was demonstrably sitting in tmux. The backend now finds it by terminal device.
      vi.mocked(terminalApi.status).mockResolvedValue({
        cwd: null,
        command: null,
        session: "34",
        busy: false,
        agent_turn: null,
      });
      const opened = deferOpen(70);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => expect(useTerminalStore.getState().panes.at(-1)?.tmuxSession).toBe("34"));
    });

    it("is cleared again when the user leaves tmux", async () => {
      // Detaching inside the shell is the same event in reverse, and a stale name would claim a
      // session the terminal is no longer in.
      vi.mocked(terminalApi.status).mockResolvedValue({
        cwd: null,
        command: null,
        session: null,
        busy: false,
        agent_turn: null,
      });
      const opened = deferOpen(71);
      render(<TerminalView />);
      act(() => measure?.(30, 100));
      await opened();
      await act(async () => {
        await Promise.resolve();
      });

      expect(useTerminalStore.getState().panes.at(-1)?.tmuxSession).toBeNull();
    });
  });
});

describe("the activity line in a tab that runs an agent", () => {
  it("follows the agent's TURN, not the fact that a harness is open", async () => {
    // The defect: a harness IS a command that runs for hours, so `busy` says yes from the moment it
    // starts until it exits. The line reported "something is running" for an entire working day and
    // stopped only while a subshell happened to be in front — which is why it looked unrelated to
    // anything at all (reported).
    vi.mocked(terminalApi.status).mockResolvedValue({
      cwd: "/repo",
      command: "claude",
      session: "yggshell",
      busy: true,
      agent_turn: false,
    });
    const opened = deferOpen(70);
    const { container } = render(<TerminalView />);
    act(() => measure?.(30, 100));
    await opened();

    await waitFor(() =>
      expect((container.querySelector("[data-activity]") as HTMLElement).dataset.activity).toBe(
        "idle",
      ),
    );
  });

  it("runs while the turn is open", async () => {
    vi.mocked(terminalApi.status).mockResolvedValue({
      cwd: "/repo",
      command: "claude",
      session: "yggshell",
      busy: true,
      agent_turn: true,
    });
    const opened = deferOpen(71);
    const { container } = render(<TerminalView />);
    act(() => measure?.(30, 100));
    await opened();

    await waitFor(() =>
      expect((container.querySelector("[data-activity]") as HTMLElement).dataset.activity).toBe(
        "running",
      ),
    );
  });

  it("leaves a tab with no agent to the terminal's own signal", async () => {
    // `null` is NOT "an agent that is idle": confusing the two would make every plain shell look
    // permanently quiet, and a build running in one would show nothing.
    vi.mocked(terminalApi.status).mockResolvedValue({
      cwd: "/repo",
      command: "cargo",
      session: "yggshell",
      busy: true,
      agent_turn: null,
    });
    const opened = deferOpen(72);
    const { container } = render(<TerminalView />);
    act(() => measure?.(30, 100));
    await opened();

    await waitFor(() =>
      expect((container.querySelector("[data-activity]") as HTMLElement).dataset.activity).toBe(
        "running",
      ),
    );
  });
});
