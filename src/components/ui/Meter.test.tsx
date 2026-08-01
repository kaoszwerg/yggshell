import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Meter } from "./Meter";

describe("Meter", () => {
  it("reports its value to assistive technology, not just visually", () => {
    render(<Meter percent={58} label="Current session" />);
    const meter = screen.getByRole("meter", { name: "Current session" });

    expect(meter).toHaveAttribute("aria-valuenow", "58");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
  });

  it("changes colour as the limit approaches, so the eye does the comparing", () => {
    const { container, rerender } = render(<Meter percent={10} label="x" />);
    expect(container.innerHTML).toContain("bg-green");

    rerender(<Meter percent={75} label="x" />);
    expect(container.innerHTML).toContain("bg-gold");

    rerender(<Meter percent={95} label="x" />);
    expect(container.innerHTML).toContain("bg-danger");
  });

  it("cannot be drawn outside its own bar", () => {
    // A percentage arriving from a text report is not a number this component gets to trust.
    const { container, rerender } = render(<Meter percent={140} label="x" />);
    expect(container.querySelector<HTMLElement>("[style]")?.style.width).toBe("100%");

    rerender(<Meter percent={-20} label="x" />);
    expect(container.querySelector<HTMLElement>("[style]")?.style.width).toBe("0%");
  });
});
