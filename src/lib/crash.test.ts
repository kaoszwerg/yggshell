import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { installGlobalCrashHandlers, reportCrash } from "./crash";

// The IPC facade is the only way a UI crash reaches the durable on-device record (ADR-APP-032), so it
// is what these tests pin: every path must reach `api.reportCrash`, and none may swallow the failure.
vi.mock("../api/commands", () => ({
  api: { reportCrash: vi.fn(() => Promise.resolve("/data/crashes/crash-1.log")) },
}));
const { api } = await import("../api/commands");
const reportCrashMock = vi.mocked(api.reportCrash);

describe("reportCrash", () => {
  beforeEach(() => reportCrashMock.mockClear());

  it("forwards message and stack to the backend and returns the report path", async () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n  at somewhere";

    const path = await reportCrash("render", error);

    expect(reportCrashMock).toHaveBeenCalledWith({
      source: "render",
      message: "boom",
      stack: "Error: boom\n  at somewhere",
    });
    expect(path).toBe("/data/crashes/crash-1.log");
  });

  it("survives a non-Error throw (a string, a number, an object)", async () => {
    await reportCrash("render", "just a string");
    expect(reportCrashMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "just a string" }),
    );
  });

  it("never lets a failing IPC call mask the original crash", async () => {
    reportCrashMock.mockRejectedValueOnce(new Error("ipc is down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // Must resolve, not reject: the caller is already handling a fatal error and cannot handle a
    // second one. The report failure is logged, never swallowed (rule:logging).
    await expect(reportCrash("render", new Error("boom"))).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

describe("installGlobalCrashHandlers", () => {
  let uninstall: () => void;

  beforeEach(() => reportCrashMock.mockClear());
  afterEach(() => uninstall?.());

  it("reports an uncaught error and hands it to onFatal", async () => {
    const onFatal = vi.fn();
    uninstall = installGlobalCrashHandlers(onFatal);

    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("uncaught"), message: "uncaught" }),
    );
    await vi.waitFor(() => expect(reportCrashMock).toHaveBeenCalled());

    expect(reportCrashMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: "uncaught", message: "uncaught" }),
    );
    // The fatal screen is handed the report path, so it can tell the user where the detail is
    // (rule:crash-handling obligation 2).
    await vi.waitFor(() =>
      expect(onFatal).toHaveBeenCalledWith(
        expect.objectContaining({ message: "uncaught" }),
        "/data/crashes/crash-1.log",
      ),
    );
  });

  it("reports an unhandled promise rejection", async () => {
    const onFatal = vi.fn();
    uninstall = installGlobalCrashHandlers(onFatal);

    // jsdom does not construct a real PromiseRejectionEvent, so we dispatch the shape the handler reads.
    const event = new Event("unhandledrejection") as Event & { reason: unknown };
    event.reason = new Error("rejected");
    window.dispatchEvent(event);
    await vi.waitFor(() => expect(reportCrashMock).toHaveBeenCalled());

    expect(reportCrashMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: "unhandledrejection", message: "rejected" }),
    );
    await vi.waitFor(() => expect(onFatal).toHaveBeenCalled());
  });

  it("stops reporting once uninstalled", async () => {
    const onFatal = vi.fn();
    installGlobalCrashHandlers(onFatal)();

    // With our handler gone, nothing would consume this event and jsdom would report it as an uncaught
    // exception, failing the run. Swallow it here — the assertion is about OUR handler being detached,
    // not about jsdom's default behaviour.
    const swallow = (e: Event) => e.preventDefault();
    window.addEventListener("error", swallow);
    uninstall = () => window.removeEventListener("error", swallow);

    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("late"), message: "late", cancelable: true }),
    );

    expect(reportCrashMock).not.toHaveBeenCalled();
    expect(onFatal).not.toHaveBeenCalled();
  });
});
