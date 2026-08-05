import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MenuButton } from "./MenuButton";

const ITEMS = [
  { id: "all", label: "All projects", onSelect: vi.fn() },
  { id: "one", label: "github.com/a/b", onSelect: vi.fn() },
];

describe("MenuButton", () => {
  it("shows what is chosen, without anything having to be opened", () => {
    // The whole point, and the defect it was built for: the notes tool named its project only in a
    // kebab's `aria-label`, so the one way to find out where you were filing was to open the menu.
    render(<MenuButton label="Project: github.com/a/b" text="b" items={ITEMS} />);

    expect(screen.getByRole("button", { name: "Project: github.com/a/b" }).textContent).toContain(
      "b",
    );
  });

  it("opens the same menu the ⋮ used to", () => {
    render(<MenuButton label="Project: b" text="b" items={ITEMS} />);

    fireEvent.click(screen.getByRole("button", { name: "Project: b" }));

    expect(screen.getByRole("menuitem", { name: "All projects" })).toBeTruthy();
  });

  it("keeps the full name in the accessible one when the visible text is shortened", () => {
    // `github.com/kaoszwerg/yggshell` is the key; `yggshell` is what anybody reads. The long form
    // cannot go in a tooltip: `Tooltip` and `ContextMenu` both attach by cloning their child, so
    // whichever wraps the other clones a COMPONENT and its handlers vanish without a word — the trap
    // `KebabMenu` documents, met from the other side, and found by this test rather than by eye.
    render(<MenuButton label="Project: github.com/a/b" text="b" items={ITEMS} />);

    const button = screen.getByRole("button", { name: "Project: github.com/a/b" });
    // And never the native `title` attribute, which is stock chrome (ADR-APP-026).
    expect(button.getAttribute("title")).toBeNull();
    expect(button.textContent).toBe("b");
  });
});
