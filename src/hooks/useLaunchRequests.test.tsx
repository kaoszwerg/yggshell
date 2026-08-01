import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LAUNCH_EVENT, useLaunchRequests } from "./useLaunchRequests";
import { useTerminalStore } from "../store/terminal";
import { useUiStore } from "../store/ui";
import { api } from "../api/commands";

vi.mock("../api/commands", () => ({ api: { pendingLaunches: vi.fn() } }));

/** The listener the hook registers, captured so a test can fire the event at it. */
let handler: ((event: { payload: string }) => void) | null = null;
const off = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, cb: (event: { payload: string }) => void) => {
    handler = cb;
    return Promise.resolve(off);
  }),
}));

import { listen } from "@tauri-apps/api/event";

const cwds = () => useTerminalStore.getState().panes.map((p) => p.cwd);

describe("useLaunchRequests", () => {
  beforeEach(() => {
    handler = null;
    off.mockReset();
    vi.mocked(api.pendingLaunches).mockReset().mockResolvedValue([]);
    useTerminalStore.setState({ panes: [], activeKey: null, bootstrapped: true });
    useUiStore.setState({ view: "settings" });
  });

  it("listens on the name the backend emits", () => {
    // A contract between two runtimes: a reword on either side would silently stop the feature, so
    // the string is pinned here and in the Rust module's own test.
    renderHook(() => useLaunchRequests());
    expect(vi.mocked(listen).mock.calls[0]?.[0]).toBe("open-in-directory");
    expect(LAUNCH_EVENT).toBe("open-in-directory");
  });

  it("opens a terminal where the event says", async () => {
    renderHook(() => useLaunchRequests());
    await waitFor(() => expect(handler).not.toBeNull());

    handler?.({ payload: "/home/s/project" });
    expect(cwds()).toEqual(["/home/s/project"]);
  });

  it("brings the terminal view forward, because that is what was asked for", async () => {
    renderHook(() => useLaunchRequests());
    await waitFor(() => expect(handler).not.toBeNull());

    handler?.({ payload: "/home/s/project" });
    expect(useUiStore.getState().view).toBe("terminal");
  });

  it("opens what arrived before the interface existed", async () => {
    // The cold-start case, and the one that is easy to miss: `ygg .` starts the app, and the event
    // fires while the webview is still loading — into nobody.
    vi.mocked(api.pendingLaunches).mockResolvedValue(["/queued/one", "/queued/two"]);
    renderHook(() => useLaunchRequests());

    await waitFor(() => expect(cwds()).toEqual(["/queued/one", "/queued/two"]));
  });

  it("ignores a payload that is not a usable directory", async () => {
    // It crosses IPC, so it is checked rather than trusted.
    renderHook(() => useLaunchRequests());
    await waitFor(() => expect(handler).not.toBeNull());

    handler?.({ payload: "" });
    handler?.({ payload: 42 as unknown as string });
    expect(useTerminalStore.getState().panes).toHaveLength(0);
  });

  it("survives the queue being unreadable", async () => {
    // One lost launch request must not take the interface down with it.
    vi.mocked(api.pendingLaunches).mockRejectedValue(new Error("no backend"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    renderHook(() => useLaunchRequests());

    await waitFor(() => expect(logged).toHaveBeenCalled());
    expect(useTerminalStore.getState().panes).toHaveLength(0);
    logged.mockRestore();
  });

  it("stops listening when it goes away", async () => {
    const { unmount } = renderHook(() => useLaunchRequests());
    await waitFor(() => expect(handler).not.toBeNull());

    unmount();
    await waitFor(() => expect(off).toHaveBeenCalled());
  });
});

/**
 * The crash this hook caused in a release build, and the shape of it.
 *
 * The cleanup did `unlisten.then((off) => off())` with no catch. Tauri keeps its listeners in a table
 * keyed by event id and deletes the entry on unregister, so a second call reads
 * `listeners[id].handlerId` off `undefined`. Inside an unhandled promise that does not fail quietly:
 * it reaches `unhandledrejection`, which this app turns into the fatal screen (ADR-APP-032).
 */
describe("tearing the listener down", () => {
  beforeEach(() => {
    handler = null;
    off.mockReset();
    vi.mocked(api.pendingLaunches).mockReset().mockResolvedValue([]);
    useTerminalStore.setState({ panes: [], activeKey: null, bootstrapped: true });
  });

  it("unregisters at most once, however often the cleanup runs", async () => {
    const { unmount } = renderHook(() => useLaunchRequests());
    await waitFor(() => expect(handler).not.toBeNull());

    unmount();
    await waitFor(() => expect(off).toHaveBeenCalledTimes(1));
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("survives an unregister that throws, instead of taking the interface with it", async () => {
    // Teardown is the worst possible place to throw: it runs while React is dismantling the tree.
    off.mockImplementation(() => {
      throw new Error("listener already gone");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderHook(() => useLaunchRequests());
    await waitFor(() => expect(handler).not.toBeNull());

    expect(() => unmount()).not.toThrow();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("does not leave a listener behind when it arrives after the cleanup", async () => {
    // The mount/cleanup/mount that React does in development: the first `listen` can resolve after
    // its own effect is already gone, and the listener it hands over would otherwise leak.
    let resolveListen: (fn: () => void) => void = () => {};
    vi.mocked(listen).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListen = resolve as (fn: () => void) => void;
        }) as ReturnType<typeof listen>,
    );

    const { unmount } = renderHook(() => useLaunchRequests());
    unmount();
    resolveListen(off);

    await waitFor(() => expect(off).toHaveBeenCalledTimes(1));
  });

  it("reports a listener that could not be registered rather than crashing", async () => {
    vi.mocked(listen).mockImplementationOnce(() => Promise.reject(new Error("no ipc")));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    renderHook(() => useLaunchRequests());

    await waitFor(() => expect(logged).toHaveBeenCalled());
    logged.mockRestore();
  });
});
