import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyText } from "./clipboard";
import { useToastStore } from "../store/toast";

function stubClipboard(impl: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(impl) },
    configurable: true,
  });
}

describe("copyText", () => {
  beforeEach(() => {
    useToastStore.setState({ toast: null });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("confirms what it copied", async () => {
    stubClipboard(() => Promise.resolve());

    copyText("/tmp/x", "clipboard.path");
    await vi.waitFor(() => {
      expect(useToastStore.getState().toast?.key).toBe("clipboard.path");
    });
    expect(useToastStore.getState().toast?.tone).toBe("ok");
  });

  it("SURFACES a failure instead of only logging it", async () => {
    // The defect this helper was written for. `writeText` rejects for real reasons — the document is
    // not focused, the permission was refused — and every call site used to answer that with
    // `console.warn`, which the user does not have open. A copy that silently did nothing is
    // indistinguishable from one that worked, and only the user can act on the difference
    // (rule:logging: every caught error is logged AND surfaced).
    stubClipboard(() => Promise.reject(new Error("not focused")));

    copyText("/tmp/x", "clipboard.path");
    await vi.waitFor(() => {
      expect(useToastStore.getState().toast?.key).toBe("clipboard.failed");
    });
    expect(useToastStore.getState().toast?.tone).toBe("error");
    // …and still logged, for whoever the user reports it to.
    expect(console.warn).toHaveBeenCalled();
  });

  it("passes the text through untouched", async () => {
    stubClipboard(() => Promise.resolve());

    copyText("  two  spaces\nand a newline  ", "clipboard.selection");

    const spy = vi.mocked(navigator.clipboard.writeText);
    await vi.waitFor(() => {
      expect(spy).toHaveBeenCalledWith("  two  spaces\nand a newline  ");
    });
  });
});
