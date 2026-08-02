import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useFileDropGuard } from "./useFileDropGuard";

/**
 * The guard against the one gesture that could end a working session.
 *
 * Dropping a file on the window makes the WebView navigate to it: the interface is replaced by the
 * picture, there is no way back, and quitting to escape takes every terminal, build and agent session
 * with it. Reported from a running build.
 */
function drop(type: "dragover" | "drop"): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  window.dispatchEvent(event);
  return event;
}

describe("useFileDropGuard", () => {
  it("refuses the drop that would replace the application", () => {
    renderHook(() => {
      useFileDropGuard();
    });

    expect(drop("drop").defaultPrevented).toBe(true);
  });

  it("refuses the dragover too, or the drop never lands here at all", () => {
    // Without this the browser is the one that accepts the file, and preventing the drop afterwards
    // is too late — the navigation has already been decided.
    renderHook(() => {
      useFileDropGuard();
    });

    expect(drop("dragover").defaultPrevented).toBe(true);
  });

  it("stops guarding when it unmounts, and not before", () => {
    const { unmount } = renderHook(() => {
      useFileDropGuard();
    });
    expect(drop("drop").defaultPrevented).toBe(true);

    unmount();

    expect(drop("drop").defaultPrevented).toBe(false);
  });
});
