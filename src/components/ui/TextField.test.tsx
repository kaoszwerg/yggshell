import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TextField } from "./TextField";

describe("TextField", () => {
  it("renders a text input with the given accessible name", () => {
    render(<TextField aria-label="Search logs" placeholder="search…" />);
    const input = screen.getByRole("textbox", { name: "Search logs" });
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("placeholder", "search…");
  });

  it("is controllable and reports changes", () => {
    const onChange = vi.fn();
    render(<TextField aria-label="Search logs" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search logs" }), {
      target: { value: "error" },
    });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("drops the native focus outline in favour of the HUD focus ring", () => {
    render(<TextField aria-label="Search logs" />);
    const input = screen.getByRole("textbox", { name: "Search logs" });
    expect(input.className).toContain("outline-none");
    expect(input.className).toContain("focus:ring-1");
  });
});

it("draws a placeholder so it cannot be mistaken for a value", () => {
  // Reported: "the placeholders you put in the fields are not recognisable as placeholders, I keep
  // thinking those are configured values." A placeholder at the same weight as a value reads as one,
  // and the field then looks configured when it is empty — so nobody fills in what they believe is
  // already set.
  const { container } = render(<TextField placeholder="work" aria-label="Account" />);
  const input = container.querySelector("input");

  expect(input?.className).toContain("placeholder:text-dim/50");
  expect(input?.className).toContain("placeholder:italic");
});
