import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ColorField } from "./ColorField";

const onChange = vi.fn();

beforeEach(() => onChange.mockReset());

function renderField(value: string | null = "#00e5ff") {
  render(<ColorField label="Background" value={value} fallback="#0a0a0f" onChange={onChange} />);
  return {
    swatch: screen.getByLabelText("Background") as HTMLInputElement,
    hex: screen.getByLabelText("Background hex value") as HTMLInputElement,
  };
}

describe("ColorField", () => {
  it("shows the colour in both halves", () => {
    const { swatch, hex } = renderField();
    expect(swatch.value).toBe("#00e5ff");
    expect(hex.value).toBe("#00e5ff");
  });

  it("shows the fallback in the swatch while the theme does not define the colour", () => {
    // An imported scheme that never mentioned this colour keeps the HUD's — the field must show
    // what will actually be used, not an empty square.
    const { swatch, hex } = renderField(null);
    expect(swatch.value).toBe("#0a0a0f");
    expect(hex.value).toBe("");
    expect(hex.getAttribute("placeholder")).toBe("#0a0a0f");
  });

  it("reports what the picker produced", () => {
    const { swatch } = renderField();
    fireEvent.change(swatch, { target: { value: "#FF3366" } });
    expect(onChange).toHaveBeenCalledWith("#ff3366");
  });

  it("accepts a typed hex value, with or without the hash", () => {
    const { hex } = renderField();
    fireEvent.change(hex, { target: { value: "#b44aff" } });
    expect(onChange).toHaveBeenLastCalledWith("#b44aff");

    fireEvent.change(hex, { target: { value: "00ff88" } });
    expect(onChange).toHaveBeenLastCalledWith("#00ff88");
  });

  it("does not report a half-typed colour", () => {
    // Reporting it would repaint every terminal on each keystroke, through colours nobody chose.
    const { hex } = renderField();
    fireEvent.change(hex, { target: { value: "#" } });
    fireEvent.change(hex, { target: { value: "#b4" } });
    fireEvent.change(hex, { target: { value: "#b44af" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a half-typed value visible instead of snapping the caret back", () => {
    const { hex } = renderField();
    fireEvent.change(hex, { target: { value: "#b44" } });
    expect(hex.value).toBe("#b44");
  });

  it("clearing the field means 'this scheme does not define it', not black", () => {
    const { hex } = renderField();
    fireEvent.change(hex, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("refuses nonsense on blur rather than passing it on", () => {
    const { hex } = renderField();
    fireEvent.blur(hex, { target: { value: "javascript:alert(1)" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the native picker invisible — it is the mechanism, not the look", () => {
    const { swatch } = renderField();
    expect(swatch.className).toContain("opacity-0");
    expect(swatch.type).toBe("color");
  });
});
