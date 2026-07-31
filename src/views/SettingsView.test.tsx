import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsView } from "./SettingsView";

const mutate = vi.fn();

vi.mock("../hooks/useSettings", () => ({
  useSettings: vi.fn(),
  useUpdateSettings: vi.fn(),
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

import { useSettings, useUpdateSettings } from "../hooks/useSettings";

function mockSettings(overrides: { ui_scale?: number; minimize_to_tray?: boolean } = {}) {
  vi.mocked(useSettings).mockReturnValue({
    data: { ui_scale: 1, minimize_to_tray: false, ...overrides },
  } as unknown as ReturnType<typeof useSettings>);
  vi.mocked(useUpdateSettings).mockReturnValue({
    mutate,
  } as unknown as ReturnType<typeof useUpdateSettings>);
}

/** The close-button preference lives in the Window section, so a test for it has to go there first —
 *  exactly as the user does. */
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
});
