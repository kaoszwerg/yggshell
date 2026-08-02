import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { useRefreshOnCommandEnd } from "./useRefreshOnCommandEnd";
import { useTerminalStore } from "../store/terminal";
import { pane } from "../test/panes";

let client: QueryClient;
let invalidate: ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The query keys invalidated so far, flattened to their first segment. */
function invalidated(): string[] {
  const calls = invalidate.mock.calls as [{ queryKey?: readonly string[] }?][];
  return calls
    .map((call) => call[0]?.queryKey?.[0])
    .filter((key): key is string => key !== undefined);
}

function setPanes(panes: ReturnType<typeof pane>[]) {
  useTerminalStore.setState({ panes, activeKey: panes[0]?.key ?? null, bootstrapped: true });
}

describe("useRefreshOnCommandEnd", () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidate = vi.spyOn(client, "invalidateQueries");
    setPanes([pane({ key: "a", activity: "idle" })]);
  });

  it("re-reads the panels a finished command can have changed", () => {
    // Activity (what is running, which ports), Files (the tree a build just rewrote) and Docker's
    // container LIST — the three that describe state the terminal produces.
    const view = renderHook(() => useRefreshOnCommandEnd(), { wrapper });

    act(() => setPanes([pane({ key: "a", activity: "running" })]));
    view.rerender();
    invalidate.mockClear();

    act(() => setPanes([pane({ key: "a", activity: "ok" })]));
    view.rerender();

    expect(invalidated()).toEqual(expect.arrayContaining(["activity", "files", "docker"]));
  });

  it("fires on a failed command too — the tree changed either way", () => {
    const view = renderHook(() => useRefreshOnCommandEnd(), { wrapper });
    act(() => setPanes([pane({ key: "a", activity: "running" })]));
    view.rerender();
    invalidate.mockClear();

    act(() => setPanes([pane({ key: "a", activity: "failed" })]));
    view.rerender();

    expect(invalidated()).toContain("files");
  });

  it("fires on the EDGE, not on the state", () => {
    // The store re-renders for a title, a directory, a bell. Checking "is it idle" rather than "did
    // it just stop" would re-read `ps` and `lsof` on every one of them.
    const view = renderHook(() => useRefreshOnCommandEnd(), { wrapper });
    act(() => setPanes([pane({ key: "a", activity: "running" })]));
    view.rerender();
    act(() => setPanes([pane({ key: "a", activity: "ok" })]));
    view.rerender();
    invalidate.mockClear();

    act(() => setPanes([pane({ key: "a", activity: "ok", title: "renamed" })]));
    view.rerender();

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("watches every tab, not just the front one", () => {
    // A build finishing in another tab creates the file you are looking at in this one, and a
    // `docker compose up` two tabs over is exactly what the container list was missing.
    setPanes([pane({ key: "a", activity: "idle" }), pane({ key: "b", activity: "running" })]);
    const view = renderHook(() => useRefreshOnCommandEnd(), { wrapper });
    invalidate.mockClear();

    act(() => setPanes([pane({ key: "a", activity: "idle" }), pane({ key: "b", activity: "ok" })]));
    view.rerender();

    expect(invalidated()).toContain("activity");
  });

  it("does not mistake a reused tab key for a command ending", () => {
    // A closed tab must not leave its last state behind: reopening the key would look like a
    // transition out of `running` that never happened.
    setPanes([pane({ key: "a", activity: "running" })]);
    const view = renderHook(() => useRefreshOnCommandEnd(), { wrapper });

    act(() => setPanes([]));
    view.rerender();
    invalidate.mockClear();

    act(() => setPanes([pane({ key: "a", activity: "idle" })]));
    view.rerender();

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("leaves the polling readers alone", () => {
    // `git` and the agent session change without a command boundary — a fetch landing, a token count
    // moving — so they poll. A trigger for them would be a second mechanism, not a better one.
    // `docker-stats` samples over time and costs ~2s a read; it has its own cadence.
    const view = renderHook(() => useRefreshOnCommandEnd(), { wrapper });
    act(() => setPanes([pane({ key: "a", activity: "running" })]));
    view.rerender();
    invalidate.mockClear();

    act(() => setPanes([pane({ key: "a", activity: "ok" })]));
    view.rerender();

    expect(invalidated()).not.toContain("git");
    expect(invalidated()).not.toContain("docker-stats");
  });
});
