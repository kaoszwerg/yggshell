import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEscapeToTerminal } from "./useEscapeToTerminal";
import { useUiStore } from "../store/ui";

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

describe("useEscapeToTerminal", () => {
  beforeEach(() => {
    useUiStore.setState({ view: "settings" });
  });

  it("leaves a full-page view on Escape", () => {
    // Reported: Settings had neither a close control nor an Escape, and Logs had neither either.
    // A view that replaces the page owes the user a way out that costs nothing to discover.
    renderHook(() => {
      useEscapeToTerminal();
    });

    press("Escape");

    expect(useUiStore.getState().view).toBe("terminal");
  });

  it("listens on the window, so it works from wherever the caret is", () => {
    // A view is left from a search box or a scrolled list that never took focus — an element-scoped
    // handler would only fire while the page itself happened to be focused.
    renderHook(() => {
      useEscapeToTerminal();
    });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(useUiStore.getState().view).toBe("terminal");
    input.remove();
  });

  it("yields to whatever inside the view owns Escape", () => {
    // An open editor, menu or dialog consumes it first; leaving the view is the second press.
    renderHook(() => {
      useEscapeToTerminal(false);
    });

    press("Escape");

    expect(useUiStore.getState().view).toBe("settings");
  });

  it("stops listening when the view goes away", () => {
    const { unmount } = renderHook(() => {
      useEscapeToTerminal();
    });
    unmount();
    useUiStore.setState({ view: "notes" });

    press("Escape");

    expect(useUiStore.getState().view).toBe("notes");
  });

  it("does not swallow other keys", () => {
    renderHook(() => {
      useEscapeToTerminal();
    });

    press("Enter");

    expect(useUiStore.getState().view).toBe("settings");
  });

  it("is not fooled by a key whose name merely starts the same way", () => {
    renderHook(() => {
      useEscapeToTerminal();
    });

    press("Esc");

    expect(useUiStore.getState().view).toBe("settings");
  });
});

// The defect was never a broken hook — it was two views that did not call one. That is pinned where
// it can actually regress: `SettingsView.test.tsx` and `LogsView.test.tsx` each press Escape and
// assert they left.
