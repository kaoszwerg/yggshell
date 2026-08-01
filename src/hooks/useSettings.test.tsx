import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { useSettings, useUpdateSettings } from "./useSettings";
import type { SettingsDto } from "../bindings/SettingsDto";

vi.mock("../api/commands", () => ({
  api: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

import { api } from "../api/commands";

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const BASE: SettingsDto = {
  ui_scale: 1,
  terminal_font_size: 13,
  terminal_shell: "",
  terminal_theme: "",
  diff_theme: "",
  commit_theme: "",
  copy_on_select: false,
  git_auto_fetch: true,
  language: "",
  terminal_font: "",
  tmux_mode: "off",
  tmux_session: "",
  minimize_to_tray: false,
};

describe("useSettings", () => {
  beforeEach(() => {
    vi.mocked(api.getSettings).mockReset();
    vi.mocked(api.updateSettings).mockReset();
    localStorage.removeItem("yggshell.settings.last-known");
  });

  it("loads the persisted settings via the settings query", async () => {
    const settings: SettingsDto = {
      ui_scale: 1.1,
      terminal_font_size: 13,
      terminal_shell: "",
      terminal_theme: "",
      diff_theme: "",
      commit_theme: "",
      copy_on_select: false,
      git_auto_fetch: true,
      language: "",
      terminal_font: "",
      tmux_mode: "off",
      tmux_session: "",
      minimize_to_tray: false,
    };
    vi.mocked(api.getSettings).mockResolvedValue(settings);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper(qc) });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(settings);
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });

  it("paints the first frame with the last known settings rather than the defaults", async () => {
    // Settings arrive over IPC, so the first render had none: the interface painted at scale 1.0 and
    // font size 13 and then jumped to the real values, on every launch. The last known copy is read
    // synchronously from localStorage so the first frame is already right.
    const stored: SettingsDto = { ...BASE, ui_scale: 1.4, terminal_font_size: 18 };
    localStorage.setItem("yggshell.settings.last-known", JSON.stringify(stored));
    const fresh: SettingsDto = { ...BASE, ui_scale: 1.5, terminal_font_size: 20 };
    vi.mocked(api.getSettings).mockResolvedValue(fresh);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper(qc) });

    // Synchronously, before any await: no loading state, no default values.
    expect(result.current.data?.ui_scale).toBe(1.4);
    expect(result.current.isLoading).toBe(false);

    // And the file still wins — the cache decides one frame, never what is true.
    await waitFor(() => expect(result.current.data?.ui_scale).toBe(1.5));
    expect(localStorage.getItem("yggshell.settings.last-known")).toContain("1.5");
  });

  it("has no head start on a first run, and does not fail for the lack of one", async () => {
    localStorage.removeItem("yggshell.settings.last-known");
    vi.mocked(api.getSettings).mockResolvedValue(BASE);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper(qc) });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("survives a corrupt cached payload instead of taking the app down", async () => {
    // It is a file on the user's disk that anything could have written.
    localStorage.setItem("yggshell.settings.last-known", "{ not json");
    vi.mocked(api.getSettings).mockResolvedValue(BASE);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper(qc) });

    await waitFor(() => expect(result.current.data).toEqual(BASE));
  });

  it("surfaces a rejected settings query as an error", async () => {
    vi.mocked(api.getSettings).mockRejectedValue(new Error("io failure"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper(qc) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("io failure");
  });
});

describe("useUpdateSettings", () => {
  beforeEach(() => {
    vi.mocked(api.getSettings).mockReset();
    vi.mocked(api.updateSettings).mockReset();
  });

  it("calls api.updateSettings with the given options and writes the result into the settings cache", async () => {
    const updated: SettingsDto = {
      ui_scale: 1.25,
      terminal_font_size: 13,
      terminal_shell: "",
      terminal_theme: "",
      diff_theme: "",
      commit_theme: "",
      copy_on_select: false,
      git_auto_fetch: true,
      language: "",
      terminal_font: "",
      tmux_mode: "off",
      tmux_session: "",
      minimize_to_tray: false,
    };
    vi.mocked(api.updateSettings).mockResolvedValue(updated);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useUpdateSettings(), { wrapper: makeWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ uiScale: 1.25 });
    });

    expect(api.updateSettings).toHaveBeenCalledWith({ uiScale: 1.25 });
    expect(qc.getQueryData(["settings"])).toEqual(updated);
  });
});
