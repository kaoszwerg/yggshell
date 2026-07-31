import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsView } from "./SettingsView";

const mutate = vi.fn();

vi.mock("../hooks/useSettings", () => ({
  useSettings: vi.fn(),
  useUpdateSettings: vi.fn(),
  useShells: vi.fn(),
}));

// The colour-scheme controls have their own suite (ThemeControls.test.tsx) and a file-drop listener
// this view is not the place to exercise.
vi.mock("../components/settings/ThemeControls", () => ({
  ThemeControls: () => <div data-testid="theme-controls" />,
}));

// Same: profiles have their own suite.
vi.mock("../components/settings/ProfileControls", () => ({
  ProfileControls: () => <div data-testid="profile-controls" />,
}));

// The About section shows the build identity, which goes through react-query. This view is not the
// place to test that plumbing — BuildIdentity owns it.
vi.mock("../hooks/useBuildInfo", () => ({
  useBuildInfo: () => ({
    data: {
      version: "0.5.1",
      channel: "dev",
      debug: true,
      git_sha: "abc1234",
      git_dirty: false,
      commit_date: "2026-07-31T00:00:00Z",
    },
  }),
}));

import { useSettings, useShells, useUpdateSettings } from "../hooks/useSettings";

const OFFERED = [
  { path: "/bin/zsh", name: "zsh", is_default: true },
  { path: "/bin/bash", name: "bash", is_default: false },
];

function mockShells(state: { data?: typeof OFFERED; isPending?: boolean; isError?: boolean } = {}) {
  vi.mocked(useShells).mockReturnValue({
    data: state.data ?? OFFERED,
    isPending: state.isPending ?? false,
    isError: state.isError ?? false,
  } as unknown as ReturnType<typeof useShells>);
}

// The font list is measured against a canvas, which jsdom does not have. What this suite is about is
// the wiring, not the detection — that has its own tests in lib/fonts.
vi.mock("../lib/fonts", () => ({
  availableFonts: () => ["MesloLGS NF", "Menlo"],
}));

function mockSettings(
  overrides: { ui_scale?: number; minimize_to_tray?: boolean; terminal_shell?: string } = {},
) {
  mockShells();
  vi.mocked(useSettings).mockReturnValue({
    data: {
      ui_scale: 1,
      minimize_to_tray: false,
      terminal_shell: "",
      terminal_font: "",
      copy_on_select: false,
      ...overrides,
    },
  } as unknown as ReturnType<typeof useSettings>);
  vi.mocked(useUpdateSettings).mockReturnValue({
    mutate,
  } as unknown as ReturnType<typeof useUpdateSettings>);
}

/** The close-button preference lives in the Window section, so a test for it has to go there first —
 *  exactly as the user does. */
function openTerminalSection() {
  fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
}

function openWindowSection() {
  fireEvent.click(screen.getByRole("tab", { name: "Window" }));
}

describe("SettingsView", () => {
  beforeEach(() => {
    mutate.mockReset();
  });

  it("groups the settings into sections, with Appearance in front", () => {
    mockSettings();
    render(<SettingsView />);

    const list = screen.getByRole("tablist", { name: "Settings sections" });
    expect(list).toHaveAttribute("aria-orientation", "vertical");
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Window" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "About" })).toBeInTheDocument();
  });

  it("shows only the selected section", () => {
    mockSettings();
    render(<SettingsView />);

    expect(screen.getByRole("button", { name: "100%" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quit app" })).toBeNull();

    openWindowSection();

    expect(screen.getByRole("button", { name: "Quit app" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "100%" })).toBeNull();
  });

  it("reaches the build identity from the About section", () => {
    // This is the one thing the old Home view was actually good for.
    mockSettings();
    render(<SettingsView />);

    fireEvent.click(screen.getByRole("tab", { name: "About" }));

    expect(screen.getByText("version")).toBeInTheDocument();
    expect(screen.getByText("commit")).toBeInTheDocument();
  });

  it("calls updateSettings with the chosen UI scale", () => {
    mockSettings();
    render(<SettingsView />);

    fireEvent.click(screen.getByRole("button", { name: "125%" }));
    expect(mutate).toHaveBeenCalledWith({ uiScale: 1.25 });
  });

  it("renders a scale button for the persisted value", () => {
    mockSettings({ ui_scale: 0.8 });
    render(<SettingsView />);
    expect(screen.getByRole("button", { name: "80%" })).toBeInTheDocument();
  });

  it("marks Quit app as pressed when minimizeToTray is false", () => {
    mockSettings({ minimize_to_tray: false });
    render(<SettingsView />);
    openWindowSection();
    expect(screen.getByRole("button", { name: "Quit app" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Minimize to tray" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks Minimize to tray as pressed when minimizeToTray is true", () => {
    mockSettings({ minimize_to_tray: true });
    render(<SettingsView />);
    openWindowSection();
    expect(screen.getByRole("button", { name: "Minimize to tray" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Quit app" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("toggles minimizeToTray via the close-button preference", () => {
    mockSettings();
    render(<SettingsView />);
    openWindowSection();

    fireEvent.click(screen.getByRole("button", { name: "Minimize to tray" }));
    expect(mutate).toHaveBeenCalledWith({ minimizeToTray: true });

    fireEvent.click(screen.getByRole("button", { name: "Quit app" }));
    expect(mutate).toHaveBeenCalledWith({ minimizeToTray: false });
  });

  it("falls back to defaults (100%, Quit app) while settings have not loaded", () => {
    vi.mocked(useSettings).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useSettings>);
    vi.mocked(useUpdateSettings).mockReturnValue({
      mutate,
    } as unknown as ReturnType<typeof useUpdateSettings>);
    render(<SettingsView />);

    expect(screen.getByRole("button", { name: "100%" })).toBeInTheDocument();

    openWindowSection();
    expect(screen.getByRole("button", { name: "Quit app" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  describe("the shell a terminal starts", () => {
    it("offers what the backend listed, plus the system default", () => {
      mockSettings();
      render(<SettingsView />);
      openTerminalSection();

      expect(screen.getByRole("button", { name: "System default" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "zsh" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "bash" })).toBeTruthy();
    });

    it("stores the PATH of the shell that was picked, never its label", () => {
      // The backend only accepts a path it offered — a label would be refused, and rightly so.
      mockSettings();
      render(<SettingsView />);
      openTerminalSection();

      fireEvent.click(screen.getByRole("button", { name: "bash" }));

      expect(mutate).toHaveBeenCalledWith({ terminalShell: "/bin/bash" });
    });

    it("marks the current choice as pressed, and the default when nothing is chosen", () => {
      mockSettings();
      render(<SettingsView />);
      openTerminalSection();

      expect(
        screen.getByRole("button", { name: "System default" }).getAttribute("aria-pressed"),
      ).toBe("true");

      cleanup();
      mockSettings({ terminal_shell: "/bin/bash" });
      render(<SettingsView />);
      openTerminalSection();

      expect(screen.getByRole("button", { name: "bash" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(
        screen.getByRole("button", { name: "System default" }).getAttribute("aria-pressed"),
      ).toBe("false");
    });

    it("says so while the list is still loading, instead of showing an empty choice", () => {
      mockSettings();
      mockShells({ isPending: true, data: [] });
      render(<SettingsView />);
      openTerminalSection();

      expect(screen.getByText(/Reading what this machine offers/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "System default" })).toBeNull();
    });

    it("says so when the list could not be read, and reassures that terminals still work", () => {
      mockSettings();
      mockShells({ isError: true, data: [] });
      render(<SettingsView />);
      openTerminalSection();

      expect(screen.getByText(/Could not read the available shells/)).toBeTruthy();
    });
  });

  // Both of these existed in the backend before they existed in the interface — the setting was
  // stored, and nothing could set it. A test that only checks the store would not have noticed.
  describe("things that must actually be reachable", () => {
    it("lets a font be chosen from the list", () => {
      mockSettings();
      render(<SettingsView />);
      openTerminalSection();

      const box = screen.getByRole("combobox", { name: "Terminal font" });
      fireEvent.focus(box);
      fireEvent.click(screen.getByRole("option", { name: /MesloLGS NF/ }));

      expect(mutate).toHaveBeenCalledWith({ terminalFont: "MesloLGS NF" });
    });

    it("lets a font be typed that the list does not have", () => {
      // A WebView cannot enumerate fonts, so the list is what could be detected — never a gate.
      mockSettings();
      render(<SettingsView />);
      openTerminalSection();

      fireEvent.change(screen.getByRole("combobox", { name: "Terminal font" }), {
        target: { value: "Some Private Font" },
      });
      expect(mutate).toHaveBeenCalledWith({ terminalFont: "Some Private Font" });
    });

    it("lets copy-on-select be switched on and off", () => {
      mockSettings();
      render(<SettingsView />);
      openTerminalSection();

      fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));
      expect(mutate).toHaveBeenCalledWith({ copyOnSelect: true });

      cleanup();
      mockSettings({ copy_on_select: true } as never);
      render(<SettingsView />);
      openTerminalSection();
      expect(
        screen.getByRole("button", { name: "Copy to clipboard" }).getAttribute("aria-pressed"),
      ).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Select only" }));
      expect(mutate).toHaveBeenCalledWith({ copyOnSelect: false });
    });
  });
});
