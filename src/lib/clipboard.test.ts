import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyText } from "./clipboard";
import { useToastStore } from "../store/toast";
import { terminalApi } from "../api/terminal";

vi.mock("../api/terminal", () => ({
  terminalApi: { writeClipboard: vi.fn(() => Promise.resolve()) },
}));

const writeClipboard = vi.mocked(terminalApi.writeClipboard);

describe("copyText", () => {
  beforeEach(() => {
    useToastStore.setState({ toast: null });
    writeClipboard.mockReset();
    writeClipboard.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("confirms what it copied", async () => {
    copyText("/tmp/x", "clipboard.path");
    await vi.waitFor(() => {
      expect(useToastStore.getState().toast?.key).toBe("clipboard.path");
    });
    expect(useToastStore.getState().toast?.tone).toBe("ok");
  });

  it("SURFACES a failure instead of only logging it", async () => {
    // The defect this helper was written for. The write fails for real reasons, and every call site
    // used to answer that with `console.warn`, which the user does not have open. A copy that
    // silently did nothing is indistinguishable from one that worked, and only the user can act on
    // the difference (rule:logging: every caught error is logged AND surfaced).
    writeClipboard.mockRejectedValue(new Error("refused"));

    copyText("/tmp/x", "clipboard.path");
    await vi.waitFor(() => {
      expect(useToastStore.getState().toast?.key).toBe("clipboard.failed");
    });
    expect(useToastStore.getState().toast?.tone).toBe("error");
    // …and still logged, for whoever the user reports it to.
    expect(console.warn).toHaveBeenCalled();
  });

  it("passes the text through untouched", async () => {
    copyText("  two  spaces\nand a newline  ", "clipboard.selection");

    await vi.waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith("  two  spaces\nand a newline  ");
    });
  });

  it("goes through the BACKEND, never the webview's own clipboard", async () => {
    // The defect: `navigator.clipboard.writeText()` is gated on a user gesture in WebKit, and
    // copy-on-select in the terminal has none — xterm calls `preventDefault()` on `mousedown`, so
    // the activation is gone by the `mouseup` that copies. WebKit refused it WITHOUT settling the
    // promise, so nothing was copied and no failure message appeared either. Copying from a note
    // kept working, because a button click is a gesture.
    //
    // Asserting the negative is the point: a future call site that "simplifies" this back to the
    // webview API would pass every other test in this file.
    const webview = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: webview },
      configurable: true,
    });

    copyText("selection", "clipboard.selection");

    await vi.waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith("selection");
    });
    expect(webview).not.toHaveBeenCalled();
  });
});
