import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useShortcuts } from "./useShortcuts";
import { useSettings, useUpdateSettings } from "./useSettings";
import { useTerminalStore } from "../store/terminal";
import { useUiStore } from "../store/ui";
import { registerPasteTarget, clearPasteTargets } from "../lib/terminalHandles";
import { defaultBindings } from "../lib/shortcuts";
import { pane } from "../test/panes";

vi.mock("./useSettings", () => ({ useSettings: vi.fn(), useUpdateSettings: vi.fn() }));

const mutate = vi.fn();

/** Press a combination on the window, the way the browser would deliver it. */
function press(key: string, mods: Partial<KeyboardEvent> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

const keys = () => useTerminalStore.getState().panes.map((p) => p.key);

describe("useShortcuts", () => {
  beforeEach(() => {
    mutate.mockReset();
    clearPasteTargets();
    vi.mocked(useSettings).mockReturnValue({
      data: { terminal_font_size: 13 },
    } as unknown as ReturnType<typeof useSettings>);
    vi.mocked(useUpdateSettings).mockReturnValue({
      mutate,
    } as unknown as ReturnType<typeof useUpdateSettings>);
    useUiStore.setState({ shortcuts: defaultBindings(true), view: "terminal", activeTool: null });
    useTerminalStore.setState({
      panes: [pane({ key: "a" }), pane({ key: "b" }), pane({ key: "c" })],
      activeKey: "a",
      bootstrapped: true,
    });
  });

  // The property everything else depends on: a terminal emulator that eats its own control keys is
  // not a terminal. Ctrl+C must reach the shell as SIGINT, always.
  it("never swallows a key the shell needs", () => {
    for (const [key, mods] of [
      ["c", { ctrlKey: true }],
      ["d", { ctrlKey: true }],
      ["z", { ctrlKey: true }],
      ["r", { ctrlKey: true }],
      ["l", { ctrlKey: true }],
      ["t", {}],
    ] as const) {
      const event = press(key, mods);
      expect(event.defaultPrevented, `Ctrl/plain ${key} must reach the terminal`).toBe(false);
    }
    expect(keys()).toHaveLength(3);
  });

  it("opens a tab", () => {
    renderHook(() => useShortcuts());
    press("t", { metaKey: true });
    expect(keys()).toHaveLength(4);
  });

  it("closes the tab in front, and only that one", () => {
    renderHook(() => useShortcuts());
    press("w", { metaKey: true });
    expect(keys()).toEqual(["b", "c"]);
  });

  it("steps to the next tab, wrapping at the end", () => {
    // A tab strip is a ring; "next" on the last tab doing nothing is a key that silently fails.
    renderHook(() => useShortcuts());
    useTerminalStore.setState({ activeKey: "c" });
    press("]", { metaKey: true, shiftKey: true });
    expect(useTerminalStore.getState().activeKey).toBe("a");
  });

  it("steps to the previous tab, wrapping at the start", () => {
    renderHook(() => useShortcuts());
    press("[", { metaKey: true, shiftKey: true });
    expect(useTerminalStore.getState().activeKey).toBe("c");
  });

  it("jumps to a tab by number", () => {
    renderHook(() => useShortcuts());
    press("2", { metaKey: true });
    expect(useTerminalStore.getState().activeKey).toBe("b");
  });

  it("does nothing for a number with no tab behind it", () => {
    renderHook(() => useShortcuts());
    press("9", { metaKey: true });
    expect(useTerminalStore.getState().activeKey).toBe("a");
  });

  it("brings the terminal forward when a tab is chosen from another view", () => {
    // Switching to a tab while the settings page is open and staying on the settings page would be
    // a shortcut that appears to do nothing.
    useUiStore.setState({ view: "settings" });
    renderHook(() => useShortcuts());
    press("2", { metaKey: true });
    expect(useUiStore.getState().view).toBe("terminal");
  });

  it("steps the font size through the sizes the settings page offers", () => {
    renderHook(() => useShortcuts());
    press("=", { metaKey: true });
    expect(mutate).toHaveBeenCalledWith({ terminalFontSize: 14 });

    mutate.mockReset();
    press("-", { metaKey: true });
    expect(mutate).toHaveBeenCalledWith({ terminalFontSize: 12 });
  });

  it("accepts the plus key however the layout reports it", () => {
    renderHook(() => useShortcuts());
    press("+", { metaKey: true, shiftKey: true });
    expect(mutate).toHaveBeenCalledWith({ terminalFontSize: 14 });
  });

  it("stops at the ends rather than wrapping the font size", () => {
    // Wrapping from 20px to 11px on one extra press is a surprise nobody wants mid-session.
    vi.mocked(useSettings).mockReturnValue({
      data: { terminal_font_size: 20 },
    } as unknown as ReturnType<typeof useSettings>);
    renderHook(() => useShortcuts());
    press("=", { metaKey: true });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("resets the font size", () => {
    vi.mocked(useSettings).mockReturnValue({
      data: { terminal_font_size: 20 },
    } as unknown as ReturnType<typeof useSettings>);
    renderHook(() => useShortcuts());
    press("0", { metaKey: true });
    expect(mutate).toHaveBeenCalledWith({ terminalFontSize: 13 });
  });

  it("clears the terminal in front", () => {
    const clear = vi.fn();
    registerPasteTarget("a", { paste: vi.fn(), clear });
    renderHook(() => useShortcuts());

    press("k", { metaKey: true });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("opens settings and logs", () => {
    renderHook(() => useShortcuts());
    press(",", { metaKey: true });
    expect(useUiStore.getState().view).toBe("settings");

    press("l", { metaKey: true });
    expect(useUiStore.getState().view).toBe("logs");
  });

  it("toggles the Git tool", () => {
    renderHook(() => useShortcuts());
    press("g", { metaKey: true });
    expect(useUiStore.getState().activeTool).toBe("git");

    press("g", { metaKey: true });
    expect(useUiStore.getState().activeTool).toBeNull();
  });

  it("asks the visible pane to open its search", () => {
    const heard = vi.fn();
    window.addEventListener("yggshell:find", heard);
    renderHook(() => useShortcuts());

    press("f", { metaKey: true });
    expect(heard).toHaveBeenCalled();
    window.removeEventListener("yggshell:find", heard);
  });

  it("follows a rebinding", () => {
    // The whole point of making them configurable: the runner reads the store, it does not know the
    // defaults.
    useUiStore.setState({
      shortcuts: {
        ...defaultBindings(true),
        newTab: { key: "n", meta: true, ctrl: false, alt: false, shift: false },
      },
    });
    renderHook(() => useShortcuts());

    press("t", { metaKey: true });
    expect(keys()).toHaveLength(3);
    press("n", { metaKey: true });
    expect(keys()).toHaveLength(4);
  });

  it("lets an unbound combination through untouched", () => {
    renderHook(() => useShortcuts());
    const event = press("q", { metaKey: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening when it goes away", () => {
    const { unmount } = renderHook(() => useShortcuts());
    unmount();
    press("t", { metaKey: true });
    expect(keys()).toHaveLength(3);
  });
});
