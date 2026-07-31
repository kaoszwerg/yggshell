import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ActivityLine } from "./ActivityLine";

describe("ActivityLine", () => {
  it("rests quietly when nothing is happening", () => {
    const { container } = render(<ActivityLine state="idle" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("hud-activity");
    expect(el.className).not.toContain("running");
    expect(el.dataset.activity).toBe("idle");
  });

  it("sweeps while a command is running", () => {
    const { container } = render(<ActivityLine state="running" />);
    expect((container.firstElementChild as HTMLElement).className).toContain(
      "hud-activity-running",
    );
  });

  it("shows a result while it is given one", () => {
    // The holding and the clearing are the caller's; this only renders what it is told.
    const { container, rerender } = render(<ActivityLine state="ok" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("hud-activity-ok");
    rerender(<ActivityLine state="idle" />);
    expect(el.className).not.toContain("hud-activity-ok");
    expect(el.dataset.activity).toBe("idle");
  });

  it("shows failure for a non-zero status", () => {
    const { container } = render(<ActivityLine state="failed" />);
    expect((container.firstElementChild as HTMLElement).className).toContain("hud-activity-failed");
  });

  it("treats a shell that did not say as success", () => {
    // Colouring silence red would cry wolf on every terminal whose shell is simply less talkative.
    const { container } = render(<ActivityLine state="ok" />);
    expect((container.firstElementChild as HTMLElement).className).toContain("hud-activity-ok");
  });

  it("drops a result the moment it is told something is running again", () => {
    const { container, rerender } = render(<ActivityLine state="failed" />);
    rerender(<ActivityLine state="running" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("hud-activity-running");
    expect(el.className).not.toContain("hud-activity-failed");
  });

  it("says nothing to a screen reader", () => {
    // An ambient hint. Announcing "running" for every command in every tab would be noise; what a
    // command did is in the terminal's own output.
    const { container } = render(<ActivityLine state="running" />);
    expect((container.firstElementChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
  });
});
