import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Disclosure } from "./Disclosure";

describe("Disclosure", () => {
  it("hides its content until it is opened", () => {
    render(
      <Disclosure summary={<span>Details</span>}>
        <p>the inside</p>
      </Disclosure>,
    );

    expect(screen.queryByText("the inside")).toBeNull();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("the inside")).toBeTruthy();
  });

  it("removes the content from the tree rather than hiding it", () => {
    // Hidden-but-present is what a native `<details>` does, and it is why `Ctrl+F` finds text that
    // is not on screen and a screen reader announces a region nobody can see.
    const { container } = render(
      <Disclosure summary={<span>Details</span>}>
        <p>the inside</p>
      </Disclosure>,
    );

    expect(container.textContent).not.toContain("the inside");
  });

  it("tells assistive technology what it controls and whether it is open", () => {
    render(
      <Disclosure summary={<span>Details</span>}>
        <p>the inside</p>
      </Disclosure>,
    );
    const control = screen.getByRole("button");

    expect(control.getAttribute("aria-expanded")).toBe("false");
    const controls = control.getAttribute("aria-controls");
    expect(controls).toBeTruthy();

    fireEvent.click(control);

    expect(control.getAttribute("aria-expanded")).toBe("true");
    // The id it names must be the region that appeared, or the announcement points at nothing.
    expect(document.getElementById(controls ?? "")?.textContent).toContain("the inside");
  });

  it("can start open", () => {
    render(
      <Disclosure summary={<span>Details</span>} defaultOpen>
        <p>the inside</p>
      </Disclosure>,
    );

    expect(screen.getByText("the inside")).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });

  it("is a real button, so the keyboard reaches it without any wiring of ours", () => {
    // The whole reason the control is a `<button>` and not a styled `<div>`: focus, Enter and Space
    // come from the platform. A div would need three handlers and a tabindex to fake it, and the
    // fake would be wrong in some browser.
    render(
      <Disclosure summary={<span>Details</span>}>
        <p>the inside</p>
      </Disclosure>,
    );
    const control = screen.getByRole("button");

    control.focus();
    expect(document.activeElement).toBe(control);
    expect(control.tagName).toBe("BUTTON");
    expect(control.getAttribute("type")).toBe("button");
  });

  it("uses no native disclosure element", () => {
    // The reason this primitive exists (ADR-APP-026). A `<details>` here would pass every other
    // test in this file and still be the thing the rule forbids.
    const { container } = render(
      <Disclosure summary={<span>Details</span>}>
        <p>x</p>
      </Disclosure>,
    );

    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("summary")).toBeNull();
  });
});
