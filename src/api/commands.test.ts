import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { api } from "./commands";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = invoke as unknown as Mock;

describe("api", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("appVersion calls app_version with no args", async () => {
    mockInvoke.mockResolvedValue("0.1.0");
    await expect(api.appVersion()).resolves.toBe("0.1.0");
    expect(mockInvoke).toHaveBeenCalledWith("app_version");
  });

  it("buildInfo calls build_info with no args", async () => {
    const build = {
      version: "0.1.0",
      channel: "dev",
      debug: true,
      git_sha: "abc1234",
      git_dirty: false,
      commit_date: "2026-07-11T00:00:00Z",
    };
    mockInvoke.mockResolvedValue(build);
    await expect(api.buildInfo()).resolves.toEqual(build);
    expect(mockInvoke).toHaveBeenCalledWith("build_info");
  });

  it("getRecentLogs calls get_recent_logs with no args", async () => {
    mockInvoke.mockResolvedValue([]);
    await expect(api.getRecentLogs()).resolves.toEqual([]);
    expect(mockInvoke).toHaveBeenCalledWith("get_recent_logs");
  });

  it("getSettings calls get_settings with no args", async () => {
    const settings = { ui_scale: 1, minimize_to_tray: false };
    mockInvoke.mockResolvedValue(settings);
    await expect(api.getSettings()).resolves.toEqual(settings);
    expect(mockInvoke).toHaveBeenCalledWith("get_settings");
  });

  /** The response shape is not what these tests are about — the request payload is. */
  const settings = () => ({
    ui_scale: 1,
    terminal_font_size: 13,
    tmux_mode: "off" as const,
    tmux_session: "",
    minimize_to_tray: false,
  });

  describe("updateSettings", () => {
    // Every field travels on every call, absent ones as null: the backend treats null as "leave it
    // alone", so a payload that simply omits a key would be indistinguishable from one that never
    // knew about it (rule:testing — the contract is pinned on the side that produces it).
    it("pins the payload shape: uiScale sent, the rest default to null", async () => {
      mockInvoke.mockResolvedValue({
        ui_scale: 1.25,
        terminal_font_size: 13,
        minimize_to_tray: false,
      });
      await api.updateSettings({ uiScale: 1.25 });
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
        uiScale: 1.25,
        terminalFontSize: null,
        terminalShell: null,
        terminalTheme: null,
        tmuxMode: null,
        tmuxSession: null,
        minimizeToTray: null,
      });
    });

    it("carries the terminal text size without touching the UI scale", async () => {
      // The two are independent settings; a call that changed one must not carry a value for the
      // other, or "independent" would only be true in the settings copy.
      mockInvoke.mockResolvedValue({
        ui_scale: 1,
        terminal_font_size: 18,
        minimize_to_tray: false,
      });
      await api.updateSettings({ terminalFontSize: 18 });
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
        uiScale: null,
        terminalFontSize: 18,
        terminalShell: null,
        terminalTheme: null,
        tmuxMode: null,
        tmuxSession: null,
        minimizeToTray: null,
      });
    });

    it("carries the chosen colour scheme by id", async () => {
      // An id, not a palette: the scheme itself lives in a file the backend owns, and sending the
      // colours would make the settings a second copy of it.
      await api.updateSettings({ terminalTheme: "nord" });
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
        uiScale: null,
        terminalFontSize: null,
        terminalShell: null,
        terminalTheme: "nord",
        tmuxMode: null,
        tmuxSession: null,
        minimizeToTray: null,
      });
    });

    it("carries the chosen shell as the path the backend offered", async () => {
      // A LABEL must never be what travels: the backend accepts only a path it listed itself
      // (ADR-PROJ-001 §5), so sending `"bash"` would be refused — correctly, and confusingly.
      await api.updateSettings({ terminalShell: "/bin/bash" });
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
        uiScale: null,
        terminalFontSize: null,
        terminalShell: "/bin/bash",
        terminalTheme: null,
        tmuxMode: null,
        tmuxSession: null,
        minimizeToTray: null,
      });
    });

    it("pins the payload shape: minimizeToTray sent, the rest default to null", async () => {
      mockInvoke.mockResolvedValue(settings());
      await api.updateSettings({ minimizeToTray: true });
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
        uiScale: null,
        terminalFontSize: null,
        terminalShell: null,
        terminalTheme: null,
        tmuxMode: null,
        tmuxSession: null,
        minimizeToTray: true,
      });
    });

    it("sends every field as null when no options are given", async () => {
      mockInvoke.mockResolvedValue({
        ui_scale: 1,
        terminal_font_size: 13,
        minimize_to_tray: false,
      });
      await api.updateSettings({});
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
        uiScale: null,
        terminalFontSize: null,
        terminalShell: null,
        terminalTheme: null,
        tmuxMode: null,
        tmuxSession: null,
        minimizeToTray: null,
      });
    });

    it("carries the tmux preference on its own", async () => {
      // tmux is three separate decisions; a call that changes the mode must not silently carry a
      // session name the user did not touch.
      mockInvoke.mockResolvedValue(settings());
      await api.updateSettings({ tmuxMode: "attach-or-create" });
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
        uiScale: null,
        terminalFontSize: null,
        terminalShell: null,
        terminalTheme: null,
        tmuxMode: "attach-or-create",
        tmuxSession: null,
        minimizeToTray: null,
      });
    });

    it("sends every field when all are given", async () => {
      mockInvoke.mockResolvedValue({
        ui_scale: 0.8,
        terminal_font_size: 20,
        minimize_to_tray: true,
      });
      await api.updateSettings({
        uiScale: 0.8,
        terminalFontSize: 20,
        terminalShell: "/bin/zsh",
        terminalTheme: "nord",
        minimizeToTray: true,
      });
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
        uiScale: 0.8,
        terminalFontSize: 20,
        terminalShell: "/bin/zsh",
        terminalTheme: "nord",
        tmuxMode: null,
        tmuxSession: null,
        minimizeToTray: true,
      });
    });
  });

  it("openExternal calls open_external with the url", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await api.openExternal("https://example.com");
    expect(mockInvoke).toHaveBeenCalledWith("open_external", { url: "https://example.com" });
  });
});
