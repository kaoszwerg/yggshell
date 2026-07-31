import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { Sidebar } from "./Sidebar";
import { useUiStore } from "../../store/ui";

describe("Sidebar", () => {
  beforeEach(() => {
    useUiStore.setState({ view: "terminal", aboutOpen: false });
  });

  it("exposes the primary navigation landmark with Terminal, Logs and Settings", () => {
    render(<Sidebar />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terminal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("marks the active view as the current page", () => {
    render(<Sidebar />);
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Logs" })).not.toHaveAttribute("aria-current");
  });

  it("switches the active view when a nav button is clicked", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Logs" }));
    expect(useUiStore.getState().view).toBe("logs");
    expect(screen.getByRole("button", { name: "Logs" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(useUiStore.getState().view).toBe("settings");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks a tool in a colour no view uses", () => {
    // A tool is a different KIND of thing from a view — it opens beside what you are doing instead
    // of replacing it. Green already means "the view you are in", so an active tool must not look
    // like one.
    useUiStore.setState({ view: "terminal", activeTool: "git" });
    render(<Sidebar />);

    const git = screen.getByRole("button", { name: "Git" });
    const terminal = screen.getByRole("button", { name: "Terminal" });
    expect(git.className).toContain("purple");
    expect(git.className).not.toContain("green");
    expect(terminal.className).toContain("green");
  });
});
