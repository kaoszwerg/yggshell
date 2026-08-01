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
      { key: "front", title: "front", cwd: "/repo/front", bell: null } as never,
      { key: "other", title: "other", cwd: "/repo/other", bell: null } as never,
    ],
  });
}

const NOTIFICATION: AgentWaiting = {
  cwd: "/repo/other",
  event: "Notification",
  message: "Claude is waiting for your input",
  idle: true,
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
    expect(marked?.bell).toBe("done");
  });

  it("does not mark a tab for an agent that has merely FINISHED", () => {
    // `Stop` fires at the end of every single turn. Marking on it would light up every tab within
    // minutes, and a mark that is always on says nothing — it would cost the signal its meaning
    // rather than adding one. `Notification` is the agent asking for something.
    waiting([{ cwd: "/repo/other", event: "Stop", message: null, idle: false }]);
    renderHook(() => useAttentionBell());

    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBeNull();
  });

  it("rings once per event, not once per poll", () => {
    // The events file is re-read every three seconds and keeps its contents until cleared. Ringing
    // on what it CONTAINS rather than on what is NEW would put the mark back the instant the user
    // visited the tab, which is a mark that cannot be dismissed.
    waiting([NOTIFICATION]);
    const { rerender } = renderHook(() => useAttentionBell());

    // The user visits the tab: the store clears the mark.
    useTerminalStore.setState({
      panes: useTerminalStore.getState().panes.map((p) => ({ ...p, bell: null })),
    });
    rerender();

    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBeNull();
  });

  it("takes its own mark off again when the agent carries on", () => {
    // Reported: "die attention von dsp ist weg, aber der gelbe kreis ist noch am tab von dsp". The
    // terminal bell keeps its mark until the tab is visited because a `\a` carries nothing that could
    // later say "never mind". An agent's question DOES: the harness's next event proves it carried
    // on. Leaving the dot up then points at a tab where nothing is waiting.
    waiting([NOTIFICATION]);
    const { rerender } = renderHook(() => useAttentionBell());
    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBe("done");

    waiting([]); // the agent is running again
    rerender();

    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBeNull();
  });

  it("marks a blocked agent differently from one that has merely finished", () => {
    // The whole point. Both arrive as `Notification`, and shipping them as one gold dot meant the
    // panel said "waiting for your input" — the harness's own wording — about a timer noticing the
    // prompt had gone quiet. The user could not tell "answer me" from "I am done" without opening
    // the tab, which is the work the mark exists to save.
    waiting([{ ...NOTIFICATION, idle: false, message: "Claude needs your permission" }]);
    const view = renderHook(() => useAttentionBell());
    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBe("action");

    // And a change of kind REPLACES the mark rather than being dropped as "already marked": what the
    // agent wants from you has changed, and the old colour would answer last minute's question.
    waiting([{ ...NOTIFICATION, idle: true }]);
    view.rerender();
    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBe("done");
  });

  it("never takes off a mark it did not set", () => {
    // A terminal bell is somebody else's signal and has no resolution to observe. Clearing it here
    // would silently swallow a `\a` that nobody has looked at yet.
    useTerminalStore.setState({
      panes: useTerminalStore.getState().panes.map((p) => ({ ...p, bell: "action" as const })),
    });
    waiting([]);
    renderHook(() => useAttentionBell());

    // Still "action" — the mark it found, untouched. Not "done", which is what this hook would
    // have set.
    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBe("action");
  });

  it("rings again for the next question once the last one was answered", () => {
    // The backend drops a directory from the list the moment its agent carries on, so "no longer
    // listed" IS the answer arriving. A second question after that has to ring again — a signal that
    // fires only once per directory per app lifetime would be worse than none.
    waiting([NOTIFICATION]);
    const { rerender } = renderHook(() => useAttentionBell());
    useTerminalStore.setState({
      panes: useTerminalStore.getState().panes.map((p) => ({ ...p, bell: null })),
    });

    waiting([]); // answered — the agent is running again
    rerender();
    waiting([{ ...NOTIFICATION, message: "Claude needs your permission" }]);
    rerender();

    expect(useTerminalStore.getState().panes.find((p) => p.key === "other")?.bell).toBe("done");
  });
});
