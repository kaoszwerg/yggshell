import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAppMenu } from "./useAppMenu";
import { useUiStore } from "../store/ui";

/** The listener the hook installs, so a test can be the menu press. */
let onMenu: ((event: { payload: string }) => void) | undefined;
const stop = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, handler: (event: { payload: string }) => void) => {
    onMenu = handler;
    return Promise.resolve(stop);
  },
}));

const setAppMenu = vi.fn().mockResolvedValue(undefined);
vi.mock("../api/commands", () => ({
  api: { setAppMenu: (...args: unknown[]) => setAppMenu(...args) },
}));

const run = vi.fn();
vi.mock("./useRunAction", () => ({ useRunAction: () => run }));

function Harness() {
  useAppMenu();
  return null;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("useAppMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onMenu = undefined;
    useUiStore.setState({ locale: "en", aboutOpen: false });
  });

  it("describes the menu as soon as it mounts", async () => {
    mount();

    await waitFor(() => {
      expect(setAppMenu).toHaveBeenCalled();
    });
    const spec = setAppMenu.mock.calls[0]?.[0] as { labels: { about: string } };
    expect(spec.labels.about).toBe("About YggShell");
  });

  it("rebuilds it when the language changes", async () => {
    // The menu carries no words of its own, so this call is the only thing keeping it true.
    mount();
    await waitFor(() => {
      expect(setAppMenu).toHaveBeenCalledTimes(1);
    });

    useUiStore.setState({ locale: "de" });

    await waitFor(() => {
      expect(setAppMenu).toHaveBeenCalledTimes(2);
    });
    const spec = setAppMenu.mock.calls[1]?.[0] as { labels: { about: string } };
    expect(spec.labels.about).toBe("Über YggShell");
  });

  it("rebuilds it when a key is rebound", async () => {
    // Without this the menu keeps showing — and CLAIMING, since AppKit dispatches its key
    // equivalents first — a combination the user has just moved somewhere else.
    mount();
    await waitFor(() => {
      expect(setAppMenu).toHaveBeenCalledTimes(1);
    });

    // Ctrl+Shift rather than ⌘: jsdom does not report a Mac, and `sanitiseBindings` would refuse a
    // ⌘ binding there — correctly, since ⌘ does not exist on the platform this test is running as.
    useUiStore
      .getState()
      .setShortcut("newTab", { key: "y", meta: false, ctrl: true, alt: false, shift: true });

    await waitFor(() => {
      expect(setAppMenu).toHaveBeenCalledTimes(2);
    });
    const spec = setAppMenu.mock.calls[1]?.[0] as { keys: Record<string, string> };
    expect(spec.keys.newTab).toBe(["Ctrl", "Shift", "Y"].join("+"));
  });

  it("hands a press to the same runner the keyboard uses", async () => {
    mount();
    await waitFor(() => {
      expect(onMenu).toBeDefined();
    });

    onMenu?.({ payload: "newTab" });

    expect(run).toHaveBeenCalledWith("newTab");
  });

  it("opens OUR About rather than anything the system would show", async () => {
    // The whole reason the menu was rebuilt: the default one opened the system panel, which knows a
    // name and a version and nothing about the build in front of you.
    mount();
    await waitFor(() => {
      expect(onMenu).toBeDefined();
    });

    onMenu?.({ payload: "about" });

    expect(useUiStore.getState().aboutOpen).toBe(true);
  });

  it("ignores an id this build does not know instead of guessing", async () => {
    mount();
    await waitFor(() => {
      expect(onMenu).toBeDefined();
    });

    onMenu?.({ payload: "no such action" });

    expect(run).not.toHaveBeenCalled();
  });

  it("stops listening when it goes away", async () => {
    const view = mount();
    await waitFor(() => {
      expect(onMenu).toBeDefined();
    });

    view.unmount();

    await waitFor(() => {
      expect(stop).toHaveBeenCalled();
    });
  });
});
