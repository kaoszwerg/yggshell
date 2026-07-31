import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchableSelect } from "./SearchableSelect";

const onChange = vi.fn();

const OPTIONS = [
  { value: "MesloLGS NF", label: "MesloLGS NF", preview: { fontFamily: '"MesloLGS NF"' } },
  { value: "JetBrains Mono", label: "JetBrains Mono" },
  { value: "Menlo", label: "Menlo" },
];

beforeEach(() => onChange.mockReset());

function show(value = "") {
  render(<SearchableSelect label="Font" value={value} options={OPTIONS} onChange={onChange} />);
  return screen.getByRole("combobox", { name: "Font" });
}

describe("SearchableSelect", () => {
  it("shows the current value without filtering the list down to it", () => {
    // Opening a list and finding only what is already chosen would make it impossible to change.
    const box = show("Menlo");
    expect(box).toHaveValue("Menlo");
    fireEvent.focus(box);
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("filters as you type, case-insensitively", () => {
    const box = show();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "mono" } });

    const shown = screen.getAllByRole("option").map((o) => o.textContent);
    expect(shown.some((t) => t?.includes("JetBrains Mono"))).toBe(true);
    expect(shown.some((t) => t?.includes("Menlo"))).toBe(false);
  });

  it("reports a typed name even when it is in no list", () => {
    // The list is what this machine happens to have; a WebView cannot enumerate fonts, so refusing
    // an unknown name would refuse fonts we simply could not detect.
    const box = show();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Some Private Font" } });
    expect(onChange).toHaveBeenLastCalledWith("Some Private Font");
  });

  it("chooses an option on click", () => {
    const box = show();
    fireEvent.focus(box);
    fireEvent.click(screen.getByRole("option", { name: /Menlo/ }));
    expect(onChange).toHaveBeenLastCalledWith("Menlo");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("chooses the first match on Enter", () => {
    const box = show();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "mes" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("MesloLGS NF");
  });

  it("previews an option in its own font", () => {
    // Choosing a typeface from a list set in some other typeface is choosing blind.
    const box = show();
    fireEvent.focus(box);
    const row = screen.getByRole("option", { name: /MesloLGS NF/ });
    expect(row.querySelector("span")?.getAttribute("style")).toContain("MesloLGS NF");
  });

  it("says so when nothing matches, instead of showing an empty box", () => {
    const box = show();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "zzzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });

  it("closes on Escape and forgets what was being typed", () => {
    const box = show("Menlo");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "xyz" } });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box).toHaveValue("Menlo");
  });

  it("marks the chosen option to assistive technology", () => {
    const box = show("Menlo");
    fireEvent.focus(box);
    expect(screen.getByRole("option", { name: /Menlo/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(box.getAttribute("aria-expanded")).toBe("true");
  });
});
