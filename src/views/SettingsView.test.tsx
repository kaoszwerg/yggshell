import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsView } from "./SettingsView";
import { useUiStore } from "../store/ui";

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
  // The real constant: the point of these tests is that the page and the terminal agree on it, and a
  // mock free to say something else would let them drift apart again without failing anything.
  DEFAULT_FONT: "MesloLGS NF",
  // The real list: the tests assert on the buttons it produces, and a mock free to say something
  // else would let the page and the shortcuts drift apart without failing anything.
  FONT_SIZES: [11, 12, 13, 14, 16, 18, 20],
  DEFAULT_FONT_SIZE: 13,
  waitForFont: () => Promise.resolve(true),
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
      git_auto_fetch: true,
      language: "",
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

function openToolsSection() {
  fireEvent.click(screen.getByRole("tab", { name: "Tools" }));
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

    it("lets the remote check be turned off", () => {
      // The one outbound connection the app makes, so it must be refusable (ADR-PROJ-002).
      mockSettings();
      render(<SettingsView />);
      openToolsSection();

      expect(
        screen.getByRole("button", { name: "Check the remote" }).getAttribute("aria-pressed"),
      ).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Stay offline" }));
      expect(mutate).toHaveBeenCalledWith({ gitAutoFetch: false });
    });
  });

  // A tab holding seven blocks separated by nothing but hairlines is a wall of text: the reader has
  // to parse every control to work out where the thing they came for is. Each block carries its own
  // heading, and each heading is a landmark, so it can be found by eye and by screen reader alike.
  describe("named sections inside each tab", () => {
    const named = (name: string) => screen.getByRole("group", { name });

    it("breaks the Terminal tab into headed blocks rather than one long page", () => {
      mockSettings();
      render(<SettingsView />);
      openTerminalSection();

      for (const name of ["Shell", "Font", "Theme", "Selection", "tmux", "Profiles"]) {
        expect(named(name)).toBeInTheDocument();
      }
      expect(screen.getAllByRole("group").length).toBeGreaterThan(3);
    });

    it("puts every block's heading above its controls, so the heading names what follows", () => {
      mockSettings();
      render(<SettingsView />);
      openTerminalSection();

      // The font control has to be inside the block called Font, not merely somewhere on the page.
      expect(
        within(named("Font")).getByRole("combobox", { name: "Terminal font" }),
      ).toBeInTheDocument();
      expect(within(named("Selection")).getByRole("button", { name: "Copy to clipboard" }));
    });

    it("keeps the remote check with the Git tool it belongs to, not under Terminal", () => {
      // It is neither terminal behaviour nor window behaviour: it is what one tool does.
      mockSettings();
      render(<SettingsView />);
      openTerminalSection();
      expect(screen.queryByRole("button", { name: "Check the remote" })).toBeNull();

      openToolsSection();
      expect(within(named("Git")).getByRole("button", { name: "Check the remote" }));
    });

    it("heads the Appearance and Window tabs too", () => {
      mockSettings();
      render(<SettingsView />);
      expect(named("Interface")).toBeInTheDocument();

      openWindowSection();
      expect(named("Close button")).toBeInTheDocument();
    });
  });

  // Reported from a screenshot: the picker showed "MesloLGS NF" and the sample below it drew empty
  // boxes where the Powerline glyphs belong. Two separate defects behind one symptom — the name in
  // the box was the PLACEHOLDER (nothing was chosen), and the unconfigured fallback was JetBrains
  // Mono, which has no such glyphs. The page was promising a font it was not using.
  describe("the font sample shows what the terminal will really use", () => {
    it("previews the bundled default when nothing has been chosen", () => {
      mockSettings({ terminal_font: "" } as never);
      render(<SettingsView />);
      openTerminalSection();

      const sample = screen.getByLabelText("Font preview");
      expect(sample.getAttribute("style")).toContain("MesloLGS NF");
    });

    it("previews the chosen font once there is one", () => {
      mockSettings({ terminal_font: "Fira Code" } as never);
      render(<SettingsView />);
      openTerminalSection();

      expect(screen.getByLabelText("Font preview").getAttribute("style")).toContain("Fira Code");
    });

    it("offers the default as the placeholder rather than as a value", () => {
      // The placeholder is what made it look chosen. It stays — it is the right thing to show — but
      // now it names the font the terminal actually falls back to.
      mockSettings({ terminal_font: "" } as never);
      render(<SettingsView />);
      openTerminalSection();

      const box = screen.getByRole("combobox", { name: "Terminal font" });
      expect(box).toHaveValue("");
      expect(box.getAttribute("placeholder")).toBe("MesloLGS NF");
    });
  });

  // The whole feature, from the outside: does the interface actually change language, and does the
  // choice reach the place it survives a restart?
  describe("two languages", () => {
    it("offers each language named in itself", () => {
      // "Deutsch", not "German": somebody who has landed in a language they cannot read needs a way
      // out, and a list written in that language is no help.
      mockSettings();
      render(<SettingsView />);

      expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Deutsch" })).toBeInTheDocument();
    });

    it("starts in English", () => {
      useUiStore.setState({ locale: "en" });
      mockSettings();
      render(<SettingsView />);

      expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(screen.getByRole("tab", { name: "Appearance" })).toBeInTheDocument();
    });

    it("redraws the interface in German when German is chosen", () => {
      useUiStore.setState({ locale: "en" });
      mockSettings();
      render(<SettingsView />);

      fireEvent.click(screen.getByRole("button", { name: "Deutsch" }));

      // Under the click, not after a round trip: the same tab list, in German.
      expect(screen.getByRole("tab", { name: "Darstellung" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Werkzeuge" })).toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "Appearance" })).toBeNull();
    });

    it("stores the choice, so it is still that language tomorrow", () => {
      // The mirror in the store is for the first frame; settings.json is what survives a restart.
      useUiStore.setState({ locale: "en" });
      mockSettings();
      render(<SettingsView />);

      fireEvent.click(screen.getByRole("button", { name: "Deutsch" }));
      expect(mutate).toHaveBeenCalledWith({ language: "de" });
    });

    it("translates deep into a page, not just the tab strip", () => {
      useUiStore.setState({ locale: "de" });
      mockSettings();
      render(<SettingsView />);
      fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));

      expect(screen.getByRole("group", { name: "Schriftart" })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Auswahl" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "In die Zwischenablage" })).toBeInTheDocument();
    });
  });

  // Reported from the running app: the About panel spelled the name YGGSHELL and had no mark at all.
  // Both are the product's identity, so both are pinned here.
  describe("the About panel", () => {
    const openAbout = () => fireEvent.click(screen.getByRole("tab", { name: "About" }));

    beforeEach(() => useUiStore.setState({ locale: "en" }));

    it("writes the name the way the product is written, not in capitals", () => {
      mockSettings();
      render(<SettingsView />);
      openAbout();

      // Small caps are built by SPLITTING the name into runs and shrinking the ones that were
      // lowercase — the text stays uppercase throughout, because the layout uppercases it anyway
      // (`lib/smallCaps`). So the property to assert is the structure, not the characters: four
      // runs, of which the ones that were lowercase are drawn smaller.
      const heading = screen.getByRole("heading", { name: "YggShell" });
      const runs = [...heading.querySelectorAll("span")];
      expect(runs.map((r) => r.textContent)).toEqual(["Y", "GG", "S", "HELL"]);
      expect(runs.filter((r) => r.getAttribute("style")?.includes("font-size"))).toHaveLength(2);
    });

    it("shows the app mark beside it", () => {
      mockSettings();
      render(<SettingsView />);
      openAbout();

      const panel = screen.getByRole("group", { name: "About" });
      // Decorative, so it has no accessible name — found as an element rather than by role.
      expect(panel.querySelector("img")).not.toBeNull();
    });
  });
});
