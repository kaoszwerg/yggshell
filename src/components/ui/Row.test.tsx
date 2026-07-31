import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Row } from "./Row";

const onActivate = vi.fn();

beforeEach(() => onActivate.mockReset());

describe("Row", () => {
  it("is a real button, so it is in the tab order and announced as one", () => {
    render(
      <Row label="src/main.ts" onActivate={onActivate}>
        <span>src/main.ts</span>
      </Row>,
    );
    const row = screen.getByRole("button", { name: "src/main.ts" });
    expect(row.tagName).toBe("BUTTON");
    expect(row.getAttribute("type")).toBe("button");
  });

  it("activates on a click", () => {
    render(
      <Row label="a" onActivate={onActivate}>
        a
      </Row>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("activates on Enter and Space, and on nothing else", () => {
    render(
      <Row label="a" onActivate={onActivate}>
        a
      </Row>,
    );
    const row = screen.getByRole("button");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onActivate).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(row, { key: "a" });
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("marks what is being shown with aria-current, not aria-selected", () => {
    // `aria-selected` belongs to a listbox; this is a list of links to a detail view.
    const { rerender } = render(
      <Row label="a" onActivate={onActivate}>
        a
      </Row>,
    );
    expect(screen.getByRole("button").getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-selected")).toBeNull();

    rerender(
      <Row label="a" selected onActivate={onActivate}>
        a
      </Row>,
    );
    expect(screen.getByRole("button").getAttribute("aria-current")).toBe("true");
  });

  it("takes an accessible name of its own, because the visible text is usually truncated", () => {
    render(
      <Row label="src-tauri/src/terminal/shell_integration.rs" onActivate={onActivate}>
        <span className="truncate">shell_integration.rs</span>
      </Row>,
    );
    expect(
      screen.getByRole("button", { name: "src-tauri/src/terminal/shell_integration.rs" }),
    ).toBeTruthy();
  });
});
