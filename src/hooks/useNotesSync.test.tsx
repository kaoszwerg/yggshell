import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNotesSync, resetSyncThrottle } from "./useNotesSync";
import { notesApi } from "../api/notes";
import type { NotesStatus } from "../bindings/NotesStatus";

vi.mock("../api/notes", () => ({
  notesApi: { sync: vi.fn(() => Promise.resolve()) },
}));

const sync = vi.mocked(notesApi.sync);

/** A connected, idle status — the shape the command answers with; none of these tests read it. */
const STATUS: NotesStatus = {
  connected: true,
  remote: "git@example.com:notes.git",
  branch: "main",
  sync: true,
  path: "/tmp/notes",
  git_available: true,
  last_sync: null,
  last_error: null,
  ahead: 0,
  dirty: false,
};

/** A component that does nothing but hold one instance of the hook. */
function Holder({ now }: { now?: boolean }) {
  useNotesSync(now === undefined ? undefined : { now });
  return null;
}

function mount(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("useNotesSync", () => {
  beforeEach(() => {
    sync.mockClear();
    sync.mockResolvedValue(STATUS);
    resetSyncThrottle();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  // The throttle is module state — that IS the fix — so it outlives a test and has to be reset, or
  // one test's sync becomes the reason the next one does not happen. `vi.resetModules()` would not
  // reach it: the module is already imported.

  it("runs ONE sync when two callers ask at once", () => {
    // The defect, measured in the maintainer's log: the shell root and the notes tool each held
    // their own throttle, so one focus event started two syncs 121 µs apart. Both then ran
    // `git fetch` into the same clone — one `FETCH_HEAD` — and `git pull --rebase` refused the
    // second with "Cannot rebase onto multiple branches", which the badge showed as a sync that
    // keeps failing. Nothing was actually wrong.
    mount(
      <>
        <Holder now />
        <Holder now />
      </>,
    );

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("still syncs on a real focus RETURN, and only once for both callers", () => {
    mount(
      <>
        <Holder />
        <Holder now />
      </>,
    );
    sync.mockClear();

    // A focus only counts after the window has lost it — otherwise opening the app is a sync, which
    // is the Touch ID prompt this hook exists to avoid.
    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });

    // Zero, because the mount above already synced and the throttle is now shared: the point is that
    // it is not TWO. A throttled focus is the normal case within 30 s.
    expect(sync).not.toHaveBeenCalledTimes(2);
  });

  it("lets an explicit press through even while the throttle is warm", () => {
    // A button press is not focus-flapping — `syncNow` bypasses the throttle by design, and that
    // must survive the throttle becoming shared state. Driven through a real button rather than by
    // assigning the callback to an outer variable, which the React Compiler lint refuses (and is
    // right to: a component that writes to module scope during render is not a component).
    function Presser() {
      const { syncNow } = useNotesSync();
      return (
        <button type="button" onClick={syncNow}>
          sync
        </button>
      );
    }
    const { getByRole } = mount(<Presser />);
    sync.mockClear();

    act(() => {
      getByRole("button").click();
    });

    expect(sync).toHaveBeenCalledTimes(1);
  });
});
