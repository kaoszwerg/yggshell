import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { CONSTRUCTS, GROUPS } from "../../lib/markdownInsert";
import { useUiStore } from "../../store/ui";

describe("MarkdownToolbar", () => {
  function mount(onPick = vi.fn()) {
    useUiStore.setState({ locale: "en" });
    render(<MarkdownToolbar onPick={onPick} />);
    return onPick;
  }

  it("offers one control per element the renderer supports", () => {
    mount();

    expect(screen.getAllByRole("button")).toHaveLength(CONSTRUCTS.length);
  });

  it("names every control, since they are icons and nothing else", () => {
    mount();

    // Not one of them may fall back to an id or an empty string: an icon with no accessible name is
    // unusable with a screen reader and unlabelled on hover (ADR-APP-026, rule:i18n).
    for (const button of screen.getAllByRole("button")) {
      const name = button.getAttribute("aria-label") ?? "";
      expect(name).not.toBe("");
      expect(name).not.toMatch(/^notes\.insert\./);
    }
  });

  it("reports which construct was pressed, and nothing else", () => {
    const onPick = mount();

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0]).toMatchObject({ id: "bold" });
  });

  it("separates the groups visibly, not just in the source", () => {
    // Grouping that exists only in the data is grouping the user cannot see. One divider BETWEEN
    // groups — not before the first, which would read as a lid on the toolbar.
    const { container } = render(<MarkdownToolbar onPick={vi.fn()} />);

    expect(container.querySelectorAll("[aria-hidden].h-px")).toHaveLength(GROUPS.length - 1);
  });

  it("draws the controls in group order", () => {
    mount();

    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(
      ["Heading", "Bold", "Italic", "Strikethrough"].concat(
        ["Bulleted list", "Numbered list", "Task"],
        ["Inline code", "Code block"],
        ["Link", "Image"],
        ["Quote", "Table", "Divider"],
      ),
    );
  });

  it("is a floating surface with a position of its own", () => {
    // `.hud-popover` draws its interior with an `::before` at `inset: 1px` and sets no `position`,
    // so without one here that interior anchors to whatever is positioned above and spills across
    // it — exactly the defect the toast shipped with. The lint rule catches it too; this pins the
    // rendered result.
    const { container } = render(<MarkdownToolbar onPick={vi.fn()} />);
    const surface = container.querySelector(".hud-popover");

    expect(surface).not.toBeNull();
    expect(surface?.className).toMatch(/\babsolute\b|\bfixed\b|\brelative\b|\bsticky\b/);
  });

  it("does not take the focus away from the editor", () => {
    // The caret has to stay where it is: the whole feature is "insert where the cursor is", and a
    // button that takes focus on mousedown has destroyed that answer before the click even lands.
    // `fireEvent` returns false when a handler called preventDefault, which is the behaviour itself
    // rather than a marker attribute standing in for it.
    mount();

    for (const button of screen.getAllByRole("button")) {
      expect(fireEvent.mouseDown(button)).toBe(false);
    }
  });
});
