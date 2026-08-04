import { describe, it, expect, vi, beforeEach } from "vitest";

const isFullscreen = vi.fn();
const setFullscreen = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen, setFullscreen }),
}));

import { toggleFullscreen } from "./fullscreen";

describe("toggleFullscreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks what the window is doing before deciding", async () => {
    // A blind `setFullscreen(true)` is not a toggle, and the menu entry says "toggle".
    isFullscreen.mockResolvedValue(false);

    await toggleFullscreen();

    expect(setFullscreen).toHaveBeenCalledWith(true);
  });

  it("comes back out again", async () => {
    isFullscreen.mockResolvedValue(true);

    await toggleFullscreen();

    expect(setFullscreen).toHaveBeenCalledWith(false);
  });

  it("rejects rather than swallowing, so both callers can report it", async () => {
    // The title bar and the menu each log it. A helper that hid the failure would leave a control
    // that appears to do nothing — which is precisely the defect it was written to remove.
    isFullscreen.mockRejectedValue(new Error("no window"));

    await expect(toggleFullscreen()).rejects.toThrow("no window");
  });
});
