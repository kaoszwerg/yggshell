import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAttentionBell } from "./useAttentionBell";
import { useTerminalStore } from "../store/terminal";
import type { AgentWaiting } from "../bindings/AgentWaiting";

vi.mock("./useAgentAttention", () => ({ useAgentAttention: vi.fn() }));
import { useAgentAttention } from "./useAgentAttention";

function waiting(items: AgentWaiting[]) {
  vi.mocked(useAgentAttention).mockReturnValue({ installed: true, waiting: items, ready: true });
}

/** Two tabs in two directories, neither of them the one in front. */
function twoTabs() {
  useTerminalStore.setState({
    activeKey: "front",
    panes: [
      { key: "front", title: "front", cwd: "/repo/front", bell: false } as never,
      { key: "other", title: "other", cwd: "/repo/other", bell: false } as never,
    ],
  });
}

const NOTIFICATION: AgentWaiting = {
  cwd: "/repo/other",
  event: "Notification",
  message: "Claude is waiting for your input",
};

describe("useAttentionBell", () => {
  beforeEach(() => {
    vi.mocked(useAgentAttention).mockReset();
    twoTabs();
  });

  it("marks the tab whose directory an agent is asking about", () => {
    // The whole point of the hook over the bell: the event carries a directory, so it can mark a tab
    // the user is NOT looking at. Without this the signal existed only inside a panel nobody had
    // open — reported as "I have never seen it point anything out to me".
    waiting([NOTIFICATION]);
    renderHook(() => useAttentionBell());

    const marked = useTerminalStore.getState().panes.find((p) => p.key === "other");
    expect(marked?.bell).toBe(true);
  });

  it("does not mark a tab for an agent that has merely FINISHED", () => {
    // `Stop` fires at the end of every single turn. Marking on it would light up every tab within
    // minutes, and a mark that is always on says nothing — it would cost the signal its meaning
    // rather than adding one. `Notification` is the agent asking for something.
    waiting([{ cwd: "/repo/other", event: "Stop", message: null }]);
    renderHook(() => useAttentionBell());

    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBe(false);
  });

  it("rings once per event, not once per poll", () => {
    // The events file is re-read every three seconds and keeps its contents until cleared. Ringing
    // on what it CONTAINS rather than on what is NEW would put the mark back the instant the user
    // visited the tab, which is a mark that cannot be dismissed.
    waiting([NOTIFICATION]);
    const { rerender } = renderHook(() => useAttentionBell());

    // The user visits the tab: the store clears the mark.
    useTerminalStore.setState({
      panes: useTerminalStore.getState().panes.map((p) => ({ ...p, bell: false })),
    });
    rerender();

    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBe(false);
  });

  it("rings again for the next question once the last one was answered", () => {
    // The backend drops a directory from the list the moment its agent carries on, so "no longer
    // listed" IS the answer arriving. A second question after that has to ring again — a signal that
    // fires only once per directory per app lifetime would be worse than none.
    waiting([NOTIFICATION]);
    const { rerender } = renderHook(() => useAttentionBell());
    useTerminalStore.setState({
      panes: useTerminalStore.getState().panes.map((p) => ({ ...p, bell: false })),
    });

    waiting([]); // answered — the agent is running again
    rerender();
    waiting([{ ...NOTIFICATION, message: "Claude needs your permission" }]);
    rerender();

    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBe(true);
  });
});
