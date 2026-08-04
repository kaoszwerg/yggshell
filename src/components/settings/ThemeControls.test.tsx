import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeControls } from "./ThemeControls";
import type { TerminalTheme } from "../../bindings/TerminalTheme";

vi.mock("../../hooks/useSettings", () => ({
  useSettings: vi.fn(),
  useUpdateSettings: vi.fn(),
  useTerminalThemes: vi.fn(),
  useImportTerminalTheme: vi.fn(),
  useSaveTerminalTheme: vi.fn(),
  useDeleteTerminalTheme: vi.fn(),
}));

import {
  useDeleteTerminalTheme,
  useImportTerminalTheme,
  useSaveTerminalTheme,
  useSettings,
  useTerminalThemes,
  useUpdateSettings,
} from "../../hooks/useSettings";

const NORD: TerminalTheme = {
  id: "nord",
  name: "Nord",
  ansi: ["#2e3440", ...Array.from({ length: 15 }, () => null)],
  builtin: false,
  background: "#2e3440",
  foreground: "#d8dee9",
  cursor: null,
  cursor_accent: null,
  selection: null,
  selection_foreground: null,
};

const update = vi.fn();
const importMutate = vi.fn();
const saveMutate = vi.fn();
const deleteMutate = vi.fn();

function setup(
  over: {
    chosen?: string;
    themes?: TerminalTheme[];
    importing?: boolean;
    importError?: unknown;
  } = {},
) {
  vi.mocked(useSettings).mockReturnValue({
    data: { terminal_theme: over.chosen ?? "" },
  } as unknown as ReturnType<typeof useSettings>);
  vi.mocked(useUpdateSettings).mockReturnValue({ mutate: update } as unknown as ReturnType<
    typeof useUpdateSettings
  >);
  vi.mocked(useTerminalThemes).mockReturnValue({
    data: over.themes ?? [NORD],
  } as unknown as ReturnType<typeof useTerminalThemes>);
  vi.mocked(useImportTerminalTheme).mockReturnValue({
    mutate: importMutate,
    isPending: over.importing ?? false,
    error: over.importError ?? null,
  } as unknown as ReturnType<typeof useImportTerminalTheme>);
  vi.mocked(useSaveTerminalTheme).mockReturnValue({
    mutate: saveMutate,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useSaveTerminalTheme>);
  vi.mocked(useDeleteTerminalTheme).mockReturnValue({
    mutate: deleteMutate,
  } as unknown as ReturnType<typeof useDeleteTerminalTheme>);
}

/** The terminal scheme buttons, which is where "Nord" means the terminal's Nord. */
const terminalGroup = () => within(screen.getByRole("group", { name: "Terminal colour scheme" }));

describe("ThemeControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it("offers Yggdrasil alongside every stored scheme", () => {
    render(<ThemeControls />);
    expect(terminalGroup().getByRole("button", { name: /^Yggdrasil/ })).toBeTruthy();
    expect(terminalGroup().getByRole("button", { name: /^Nord/ })).toBeTruthy();
  });

  it("marks the chosen one, and Yggdrasil when nothing is chosen", () => {
    render(<ThemeControls />);
    expect(
      terminalGroup()
        .getByRole("button", { name: /^Yggdrasil/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    cleanup();
    setup({ chosen: "nord" });
    render(<ThemeControls />);
    expect(
      terminalGroup().getByRole("button", { name: /^Nord/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("stores the scheme id when one is picked", () => {
    render(<ThemeControls />);
    fireEvent.click(terminalGroup().getByRole("button", { name: /^Nord/ }));
    expect(update).toHaveBeenCalledWith({ terminalTheme: "nord" });
  });

  it("imports through a control, and hands the backend no path at all", () => {
    // It was a drop zone, and it had stopped working: `dragDropEnabled: false` (set in 7d8254d so
    // the status-bar editor's own dragging worked) makes Tauri register no drag-drop handler, so the
    // event it listened for could not arrive. jsdom has no such layer, which is why the tests that
    // used to stand here were green about a feature that did not exist. A button cannot fail that
    // way — and the picker is the backend's, so no path crosses the boundary in either direction.
    render(<ThemeControls />);

    fireEvent.click(screen.getByRole("button", { name: /Import \.itermcolors/ }));

    expect(importMutate).toHaveBeenCalledWith();
  });

  it("says so when the import failed, instead of failing silently", () => {
    setup({ importError: new Error("that is not an .itermcolors file") });
    render(<ThemeControls />);

    expect(screen.getByText(/not an \.itermcolors file/)).toBeTruthy();
  });

  it("says it is working while the dialog is open", () => {
    setup({ importing: true });
    render(<ThemeControls />);

    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
  });

  it("opens an editor on a blank scheme, and on the chosen one", async () => {
    render(<ThemeControls />);
    fireEvent.click(screen.getByRole("button", { name: "New scheme" }));
    expect(screen.getByLabelText("Scheme name")).toHaveValue("New scheme");

    setup({ chosen: "nord" });
    render(<ThemeControls />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(screen.getAllByLabelText("Scheme name").at(-1)).toHaveValue("Nord"));
  });

  it("edits a colour and saves the whole scheme", () => {
    render(<ThemeControls />);
    fireEvent.click(screen.getByRole("button", { name: "New scheme" }));

    fireEvent.change(screen.getByLabelText("Scheme name"), { target: { value: "Mine" } });
    fireEvent.change(screen.getByLabelText("Background hex value"), {
      target: { value: "#101020" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(saveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Mine", background: "#101020" }),
      expect.anything(),
    );
  });

  it("will not save a scheme with no name", () => {
    render(<ThemeControls />);
    fireEvent.click(screen.getByRole("button", { name: "New scheme" }));
    fireEvent.change(screen.getByLabelText("Scheme name"), { target: { value: "  " } });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("offers no delete for a scheme that was never saved", () => {
    render(<ThemeControls />);
    fireEvent.click(screen.getByRole("button", { name: "New scheme" }));
    expect(screen.queryByRole("button", { name: "Delete this scheme" })).toBeNull();
  });

  it("deletes a stored scheme and stops pointing the setting at it", async () => {
    // A setting naming a deleted scheme would leave the terminals on something the user can no
    // longer see or choose.
    setup({ chosen: "nord" });
    render(<ThemeControls />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Delete this scheme" }));

    expect(deleteMutate).toHaveBeenCalledWith("nord", expect.anything());
  });

  it("lets diffs and commits be read in a scheme of their own", () => {
    render(<ThemeControls />);
    const diffs = within(screen.getByRole("group", { name: "Diffs colour scheme" }));

    // "Same as the terminal" is a button rather than the absence of a choice: an inheritance chain
    // nobody can see is one nobody can predict.
    expect(
      diffs.getByRole("button", { name: "Same as the terminal" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(diffs.getByRole("button", { name: /^Nord/ }));
    expect(update).toHaveBeenCalledWith({ diffTheme: "nord" });

    const commits = within(screen.getByRole("group", { name: "Commits colour scheme" }));
    expect(commits.getByRole("button", { name: "Same as diffs" })).toBeTruthy();
    fireEvent.click(commits.getByRole("button", { name: /^Nord/ }));
    expect(update).toHaveBeenCalledWith({ commitTheme: "nord" });
  });
});

// A name is not a preview: "Ayu Mirage" and "Catppuccin Mocha" tell somebody choosing between eleven
// schemes almost nothing, and a list of names makes them try each one in turn to find out.
describe("choosing a scheme by what it looks like", () => {
  it("draws each scheme in its own colours", () => {
    render(<ThemeControls />);

    const card = terminalGroup().getByRole("button", { name: /^Nord/ });
    expect(card?.getAttribute("style")).toContain("background-color");
  });

  it("keeps the scheme visible when it is the selected one", () => {
    // A card that adopted the HUD's active fill would stop showing the thing it previews at the very
    // moment it is chosen — so selection is a ring, not a fill.
    render(<ThemeControls />);
    const card = terminalGroup().getByRole("button", { name: /^Nord/ });

    fireEvent.click(card as HTMLElement);
    const after = terminalGroup().getByRole("button", { name: /^Nord/ });
    expect(after?.className).toContain("ring");
    expect(after?.getAttribute("style")).toContain("background-color");
  });

  it("names each card, since its contents are a picture", () => {
    render(<ThemeControls />);
    expect(terminalGroup().getByRole("button", { name: /^Nord/ })).toBeTruthy();
  });

  it("says which one is in use, in the name and not only in a ring", () => {
    // A cyan ring on a wall of cards that are themselves dark and often cyan-ish is exactly the work
    // these cards were supposed to remove — so the chosen one says so in words as well.
    setup({ chosen: "nord" });
    render(<ThemeControls />);

    expect(terminalGroup().getByRole("button", { name: "Nord — in use" })).toBeTruthy();
    expect(
      terminalGroup().getByRole("button", { name: "Nord — in use" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("marks exactly one card", () => {
    setup({ chosen: "nord" });
    render(<ThemeControls />);

    const marked = terminalGroup()
      .getAllByRole("button")
      .filter((b) => (b.getAttribute("aria-label") ?? "").includes("in use"));
    expect(marked).toHaveLength(1);
  });
});

it("offers the built-in scheme for diffs and commits, not only for the terminal", async () => {
  // The gap: with the terminal on another scheme there was no way to say "but draw diffs in
  // Yggdrasil" — only "follow the terminal". Those are different answers, which is exactly why the
  // built-in scheme has an id of its own: "" follows the chain, "yggdrasil" pins it.
  render(<ThemeControls />);

  const groups = await screen.findAllByRole("group");
  const diffs = groups.find((g) => g.getAttribute("aria-label")?.startsWith("Diffs"));
  expect(diffs).toBeDefined();
  expect(within(diffs as HTMLElement).getByRole("button", { name: /Yggdrasil/ })).toBeDefined();
});
