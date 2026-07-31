import { beforeEach, describe, expect, it } from "vitest";
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
