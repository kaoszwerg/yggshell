import { beforeEach, describe, expect, it } from "vitest";
import { pane } from "../test/panes";
import { useTerminalStore } from "./terminal";

const reset = () => useTerminalStore.setState({ panes: [], activeKey: null, bootstrapped: false });

describe("useTerminalStore", () => {
  beforeEach(reset);

  it("starts with nothing open", () => {
    const { panes, activeKey } = useTerminalStore.getState();
    expect(panes).toEqual([]);
    expect(activeKey).toBeNull();
  });

  it("opens a pane, focuses it, and gives it a distinct key", () => {
    const first = useTerminalStore.getState().openPane();
    const second = useTerminalStore.getState().openPane();

    expect(first).not.toBe(second);
    expect(useTerminalStore.getState().panes.map((p) => p.key)).toEqual([first, second]);
    expect(useTerminalStore.getState().activeKey).toBe(second);
  });

  it("bootstraps exactly one terminal, however often it is called", () => {
    // The view calls this on mount, and React re-mounts it whenever the user leaves and comes back.
    useTerminalStore.getState().bootstrap();
    useTerminalStore.getState().bootstrap();
    useTerminalStore.getState().bootstrap();

    expect(useTerminalStore.getState().panes).toHaveLength(1);
  });

  it("does not reopen a terminal after the last one is closed", () => {
    useTerminalStore.getState().bootstrap();
    const only = useTerminalStore.getState().panes[0]?.key ?? "";

    useTerminalStore.getState().closePane(only);
    useTerminalStore.getState().bootstrap();

    // Driving this off `panes.length` instead of a one-shot flag would make closing the last tab
    // impossible — it would spring straight back.
    expect(useTerminalStore.getState().panes).toEqual([]);
    expect(useTerminalStore.getState().activeKey).toBeNull();
  });

  it("hands focus to the tab on the right when the active one closes", () => {
    const a = useTerminalStore.getState().openPane();
    const b = useTerminalStore.getState().openPane();
    const c = useTerminalStore.getState().openPane();
    useTerminalStore.getState().setActive(b);

    useTerminalStore.getState().closePane(b);

    expect(useTerminalStore.getState().activeKey).toBe(c);
    expect(useTerminalStore.getState().panes.map((p) => p.key)).toEqual([a, c]);
  });

  it("falls back to the tab on the left when the last one closes", () => {
    const a = useTerminalStore.getState().openPane();
    const b = useTerminalStore.getState().openPane();

    useTerminalStore.getState().closePane(b);

    expect(useTerminalStore.getState().activeKey).toBe(a);
  });

  it("leaves the focus alone when a background tab closes", () => {
    const a = useTerminalStore.getState().openPane();
    const b = useTerminalStore.getState().openPane();
    useTerminalStore.getState().setActive(b);

    useTerminalStore.getState().closePane(a);

    expect(useTerminalStore.getState().activeKey).toBe(b);
  });

  it("renames one pane without touching the others", () => {
    const a = useTerminalStore.getState().openPane();
    const b = useTerminalStore.getState().openPane();

    useTerminalStore.getState().setTitle(a, "cargo watch");

    // Looked up rather than indexed into a built object: a computed member access is an
    // object-injection sink and the gate runs at --max-warnings 0.
    const titleOf = (key: string) =>
      useTerminalStore.getState().panes.find((p) => p.key === key)?.title;
    expect(titleOf(a)).toBe("cargo watch");
    expect(titleOf(b)).toBe("Terminal");
  });

  it("ignores a close for a pane that is already gone", () => {
    const a = useTerminalStore.getState().openPane();

    useTerminalStore.getState().closePane("term-does-not-exist");

    // A session can end at the same moment its tab is closed by hand; the second one must be a
    // no-op rather than an error or a focus jump.
    expect(useTerminalStore.getState().panes.map((p) => p.key)).toEqual([a]);
    expect(useTerminalStore.getState().activeKey).toBe(a);
  });
});

/**
 * What the tab in front is doing, so something other than that tab can say so.
 *
 * It used to live inside the pane component as React state, which was fine while the only thing
 * showing it was the pane itself. The status bar is not the pane — and in a tabbed, multiplexed app
 * this is per-tab state like every other, not one activity for the window.
 */
describe("what a tab is running", () => {
  beforeEach(() => {
    useTerminalStore.setState({
      panes: [pane({ key: "a" }), pane({ key: "b" })],
      activeKey: "a",
    });
  });

  const paneA = () => useTerminalStore.getState().panes.find((p) => p.key === "a");

  it("starts idle, with nothing claimed about a command", () => {
    expect(paneA()?.activity).toBe("idle");
    expect(paneA()?.command).toBeNull();
    expect(paneA()?.activitySince).toBeNull();
  });

  it("records what started, and when", () => {
    useTerminalStore.getState().setPaneActivity("a", "running", "cargo");
    expect(paneA()?.activity).toBe("running");
    expect(paneA()?.command).toBe("cargo");
    expect(paneA()?.activitySince).toBeTypeOf("number");
  });

  it("keeps the start time across repeats, so a duration does not reset every poll", () => {
    // tmux is polled on a timer and reports "still running" over and over. Stamping each of those
    // would peg the elapsed time at zero and make the whole display useless.
    useTerminalStore.getState().setPaneActivity("a", "running", "cargo");
    const started = paneA()?.activitySince;
    useTerminalStore.getState().setPaneActivity("a", "running", "cargo");
    expect(paneA()?.activitySince).toBe(started);
  });

  it("restamps when a different command starts", () => {
    useTerminalStore.getState().setPaneActivity("a", "running", "cargo");
    const started = paneA()?.activitySince ?? 0;
    useTerminalStore.getState().setPaneActivity("a", "running", "vim");
    expect(paneA()?.activitySince).toBeGreaterThanOrEqual(started);
    expect(paneA()?.command).toBe("vim");
  });

  it("forgets the command once nothing is running", () => {
    useTerminalStore.getState().setPaneActivity("a", "running", "cargo");
    useTerminalStore.getState().setPaneActivity("a", "idle", null);
    expect(paneA()?.command).toBeNull();
    expect(paneA()?.activitySince).toBeNull();
  });

  it("belongs to one tab, never to the window", () => {
    useTerminalStore.getState().setPaneActivity("a", "running", "cargo");
    const b = useTerminalStore.getState().panes.find((p) => p.key === "b");
    expect(b?.activity).toBe("idle");
    expect(b?.command).toBeNull();
  });

  it("is not persisted — a restored tab is not running what it ran last week", () => {
    useTerminalStore.getState().setPaneActivity("a", "running", "cargo");
    const stored: unknown = JSON.parse(window.localStorage.getItem("app-terminals") ?? "{}");
    const panes = (stored as { state?: { panes?: Record<string, unknown>[] } }).state?.panes ?? [];
    for (const p of panes) {
      expect(p).not.toHaveProperty("activity");
      expect(p).not.toHaveProperty("command");
    }
  });
});

/**
 * Opening a tab somewhere specific, for `ygg <dir>` and Finder's "Open With".
 *
 * The distinction from `openPane` is the whole point: an ordinary new tab starts wherever the shell
 * would, and this one starts where somebody named — so the directory has to survive all the way to
 * the shell rather than being a title the tab merely displays.
 */
describe("opening a tab in a named directory", () => {
  beforeEach(reset);

  it("opens a tab that already knows where it is", () => {
    const key = useTerminalStore.getState().openPaneIn("/home/s/project");
    const opened = useTerminalStore.getState().panes.find((p) => p.key === key);
    expect(opened?.cwd).toBe("/home/s/project");
  });

  it("focuses it, because the user just asked for it", () => {
    useTerminalStore.getState().openPane();
    const key = useTerminalStore.getState().openPaneIn("/home/s/project");
    expect(useTerminalStore.getState().activeKey).toBe(key);
  });

  it("opens a second tab for a second request, rather than reusing the first", () => {
    // Two `ygg` invocations are two pieces of work. Reusing a tab would take the user away from
    // whatever is running in it.
    const first = useTerminalStore.getState().openPaneIn("/a");
    const second = useTerminalStore.getState().openPaneIn("/b");
    expect(second).not.toBe(first);
    expect(useTerminalStore.getState().panes).toHaveLength(2);
  });

  it("does not persist the directory as a profile decision", () => {
    // It is where this tab started, not a preference — the next ordinary tab must not inherit it.
    useTerminalStore.getState().openPaneIn("/a");
    const key = useTerminalStore.getState().openPane();
    expect(useTerminalStore.getState().panes.find((p) => p.key === key)?.cwd).toBeNull();
  });
});

describe("the bell", () => {
  it("marks a tab that rang while you were somewhere else", () => {
    // The classic terminal signal, and the only one that survives tmux — measured: tmux registers a
    // bell and forwards it, while it swallows OSC sequences whole.
    useTerminalStore.setState({
      panes: [pane({ key: "a" }), pane({ key: "b" })],
      activeKey: "a",
    });

    useTerminalStore.getState().ringBell("b");
    expect(useTerminalStore.getState().panes.find((p) => p.key === "b")?.bell).toBe("action");
  });

  it("never marks the tab you are already looking at", () => {
    // A mark you would clear in the same breath is noise, and a bell is rung by an ambiguous
    // completion as often as by anything worth crossing the room for.
    useTerminalStore.setState({ panes: [pane({ key: "a" })], activeKey: "a" });

    useTerminalStore.getState().ringBell("a");
    expect(useTerminalStore.getState().panes[0]?.bell).toBeNull();
  });

  it("clears the mark when the tab is visited", () => {
    // The mark exists to say "look here" and has served its purpose the moment you do; needing a
    // second gesture to dismiss it would make it a chore.
    useTerminalStore.setState({
      panes: [pane({ key: "a" }), pane({ key: "b", bell: "action" })],
      activeKey: "a",
    });

    useTerminalStore.getState().setActive("b");
    expect(useTerminalStore.getState().panes.find((p) => p.key === "b")?.bell).toBeNull();
  });

  it("leaves other tabs' marks alone when one is visited", () => {
    useTerminalStore.setState({
      panes: [pane({ key: "a", bell: "action" }), pane({ key: "b", bell: "action" })],
      activeKey: "c",
    });

    useTerminalStore.getState().setActive("b");
    expect(useTerminalStore.getState().panes.find((p) => p.key === "a")?.bell).toBe("action");
  });
});
