import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTerminalStore } from "../store/terminal";

vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn().mockReturnValue({ data: null }) }));
vi.mock("../api/environment", () => ({ environmentApi: { attention: vi.fn() } }));

import { useQuery } from "@tanstack/react-query";
import { useAgentAttention } from "./useAgentAttention";

describe("useAgentAttention", () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockClear();
    useTerminalStore.setState({
      activeKey: "a",
      panes: [{ key: "a", title: "a", cwd: "/repo", bell: false } as never],
    });
  });

  it("keeps polling while the window is in the background", () => {
    // THE defect this hook existed with, and it is the one that made the whole feature look broken:
    // TanStack Query stops an interval refetch as soon as the page is `hidden`, and macOS marks a
    // window hidden when another app fully covers it. So the one signal whose entire job is to reach
    // you WHILE YOU ARE LOOKING SOMEWHERE ELSE was the one signal that slept exactly then.
    //
    // Measured, by accident and conclusively: the events had been sitting in the file for an hour
    // with the panel saying "nothing is waiting"; dragging an item in the status bar brought the
    // window forward, the interval resumed, and every event appeared at once.
    renderHook(() => useAgentAttention());

    const options = vi.mocked(useQuery).mock.calls[0]?.[0];
    expect(options?.refetchIntervalInBackground).toBe(true);
  });

  it("asks even when the tab in front has not reported a directory", () => {
    // The events are machine-wide: they are about the tabs you are NOT looking at. Gating the query
    // on the front tab's `cwd` made a question about every other tab depend on this one — a terminal
    // that had not yet said where it was silenced the signal for the whole app.
    useTerminalStore.setState({
      activeKey: "a",
      panes: [{ key: "a", title: "a", cwd: null, bell: false } as never],
    });
    renderHook(() => useAgentAttention());

    const options = vi.mocked(useQuery).mock.calls[0]?.[0];
    expect(options?.enabled).not.toBe(false);
  });
});
