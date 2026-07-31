import { render, act } from "@testing-library/react";
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

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: { ui_scale: 1, terminal_font_size: 13 } }),
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
function deferOpen(id: number) {
  let settle: () => void = () => {};
  const promise = new Promise<number>((resolve) => {
    settle = () => resolve(id);
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
    vi.mocked(terminalApi.open).mockResolvedValue(1);
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
    vi.mocked(terminalApi.open).mockResolvedValue(2);
    await act(async () => {
      measure?.(30, 100);
    });

    expect(terminalApi.open).toHaveBeenCalledTimes(2);
  });
});
