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

describe("telling the two kinds of rail entry apart", () => {
  it("wears the accent at rest, not only when open", () => {
    // Everything fell back to cyan until it was selected, so the one distinction that matters — a
    // view REPLACES the page, a tool opens BESIDE it — was visible only for the entry you had already
    // chosen. The colours said nothing at the moment you were deciding where to go.
    render(<Sidebar />);

    // A view you are NOT in — the one whose colour used to say nothing at all. "Terminal" is the
    // active view in a fresh store and would be green, which is the other half of the rule.
    const tool = screen.getByRole("button", { name: "Git" });
    const view = screen.getByRole("button", { name: "Logs" });

    expect(tool.className).toContain("hud-accent-purple");
    expect(view.className).toContain("hud-accent-cyan");
  });

  it("keeps green for where you ARE, on a view", () => {
    // Green is a state, not a label: a permanently green rail would say "you are here" about five
    // places at once. A tool never goes green — being a tool is not a state.
    useUiStore.setState({ view: "settings", activeTool: "git" });
    render(<Sidebar />);

    expect(screen.getByRole("button", { name: "Settings" }).className).toContain(
      "hud-accent-green",
    );
    expect(screen.getByRole("button", { name: "Git" }).className).toContain("hud-accent-purple");
  });
});
