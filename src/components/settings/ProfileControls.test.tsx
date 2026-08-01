import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProfileControls } from "./ProfileControls";
import type { TerminalProfile } from "../../bindings/TerminalProfile";

vi.mock("../../hooks/useSettings", () => ({
  useTerminalProfiles: vi.fn(),
  useSaveTerminalProfile: vi.fn(),
  useDeleteTerminalProfile: vi.fn(),
  useShells: vi.fn(),
  useTerminalThemes: vi.fn(),
}));

import {
  useDeleteTerminalProfile,
  useSaveTerminalProfile,
  useShells,
  useTerminalProfiles,
  useTerminalThemes,
} from "../../hooks/useSettings";

const WORK: TerminalProfile = {
  id: "work",
  name: "Work",
  shell: "/bin/bash",
  cwd: "/repo",
  theme: "nord",
  tmux: null,
};

const saveMutate = vi.fn();
const deleteMutate = vi.fn();

function setup(profiles: TerminalProfile[] = [WORK]) {
  vi.mocked(useTerminalProfiles).mockReturnValue({ data: profiles } as unknown as ReturnType<
    typeof useTerminalProfiles
  >);
  vi.mocked(useSaveTerminalProfile).mockReturnValue({
    mutate: saveMutate,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useSaveTerminalProfile>);
  vi.mocked(useDeleteTerminalProfile).mockReturnValue({
    mutate: deleteMutate,
  } as unknown as ReturnType<typeof useDeleteTerminalProfile>);
  vi.mocked(useShells).mockReturnValue({
    data: [
      { path: "/bin/zsh", name: "zsh", is_default: true },
      { path: "/bin/bash", name: "bash", is_default: false },
    ],
  } as unknown as ReturnType<typeof useShells>);
  vi.mocked(useTerminalThemes).mockReturnValue({
    data: [{ id: "nord", name: "Nord", ansi: [], background: null }],
  } as unknown as ReturnType<typeof useTerminalThemes>);
}

describe("ProfileControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it("says so plainly when there are none yet", () => {
    setup([]);
    render(<ProfileControls />);
    expect(screen.getByText("None yet.")).toBeTruthy();
  });

  it("lists the saved profiles", () => {
    render(<ProfileControls />);
    expect(screen.getByRole("button", { name: "Work" })).toBeTruthy();
  });

  it("starts a new profile overriding nothing", () => {
    // Everything is an override, and Settings holds the defaults — pre-filling would silently freeze
    // today's setting into the profile.
    render(<ProfileControls />);
    fireEvent.click(screen.getByRole("button", { name: "New profile" }));

    // One per override group — shell, colour scheme, tmux — and every one of them pressed. Asserted
    // as "at least one, and all of them on" rather than a count: a group added later must arrive on
    // Default too, and a hard number would fail here and be corrected to the new number without
    // anyone checking the thing this test is actually about.
    const defaults = screen.getAllByRole("button", { name: "Default" });
    expect(defaults.length).toBeGreaterThan(0);
    for (const button of defaults) expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("lets a profile decide whether its tabs use tmux", () => {
    // What makes a mixed workspace possible: a global setting can only say "all tabs" or "no tabs",
    // so the per-tab answer has to live where the other per-tab overrides already are.
    render(<ProfileControls />);
    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Off" }));

    expect(screen.getByRole("button", { name: "Off" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens a saved profile with its overrides showing", () => {
    render(<ProfileControls />);
    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(screen.getByLabelText("Profile name")).toHaveValue("Work");
    expect(screen.getByRole("button", { name: "bash" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Nord" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Start in")).toHaveValue("/repo");
  });

  it("saves a profile with the shell PATH, not its label", () => {
    render(<ProfileControls />);
    fireEvent.click(screen.getByRole("button", { name: "New profile" }));

    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Fish" } });
    fireEvent.click(screen.getByRole("button", { name: "bash" }));
    fireEvent.change(screen.getByLabelText("Start in"), { target: { value: "/tmp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(saveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Fish", shell: "/bin/bash", cwd: "/tmp" }),
      expect.anything(),
    );
  });

  it("can drop an override back to the default", () => {
    render(<ProfileControls />);
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Default" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(saveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ shell: null }),
      expect.anything(),
    );
  });

  it("will not save a profile with no name", () => {
    render(<ProfileControls />);
    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: " " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("offers no delete for a profile that was never saved", () => {
    render(<ProfileControls />);
    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();

    cleanup();
    render(<ProfileControls />);
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.getByRole("button", { name: /Delete/ })).toBeTruthy();
  });

  it("deletes a saved profile", () => {
    render(<ProfileControls />);
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(deleteMutate).toHaveBeenCalledWith("work", expect.anything());
  });
});
