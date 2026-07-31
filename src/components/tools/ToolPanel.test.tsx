import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach } from "vitest";
import { ToolPanel } from "./ToolPanel";
import { TOOL_WIDTH_MAX, TOOL_WIDTH_MIN, useUiStore } from "../../store/ui";
import { useTerminalStore } from "../../store/terminal";

const reset = (over: Partial<ReturnType<typeof useUiStore.getState>> = {}) => {
  useUiStore.setState({ view: "terminal", activeTool: null, toolWidth: 280, ...over });
  // No terminal has reported a directory, so the Git tool renders its waiting state — this suite is
  // about the column, not about what is inside it.
  useTerminalStore.setState({ panes: [], activeKey: null });
};

/** The tool inside queries the backend, so the column needs a query client to render at all. */
function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToolPanel />
    </QueryClientProvider>,
  );
}

describe("ToolPanel", () => {
  beforeEach(() => reset());

  it("renders nothing at all while it is collapsed", () => {
    renderPanel();

    expect(screen.queryByRole("complementary")).toBeNull();
    // No splitter either: a drag handle for a pane that is not there is a control that does nothing.
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("shows the chosen tool at the remembered width", () => {
    reset({ activeTool: "git", toolWidth: 320 });
    renderPanel();

    const column = screen.getByRole("complementary", { name: "Git" });
    expect(column).toBeInTheDocument();
    expect(column).toHaveStyle({ width: "320px" });
  });

  it("exposes the splitter as a window splitter with its bounds", () => {
    reset({ activeTool: "git", toolWidth: 300 });
    renderPanel();

    const splitter = screen.getByRole("separator", { name: "Git panel width" });
    expect(splitter).toHaveAttribute("aria-valuenow", "300");
    expect(splitter).toHaveAttribute("aria-valuemin", String(TOOL_WIDTH_MIN));
    expect(splitter).toHaveAttribute("aria-valuemax", String(TOOL_WIDTH_MAX));
    // Focusable, because the WAI-ARIA window-splitter pattern requires it — a handle only a mouse
    // can reach is not a control.
    expect(splitter).toHaveAttribute("tabindex", "0");
  });

  it("resizes with the arrow keys and persists the result", () => {
    reset({ activeTool: "git", toolWidth: 300 });
    renderPanel();
    const splitter = screen.getByRole("separator", { name: "Git panel width" });

    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(useUiStore.getState().toolWidth).toBe(308);

    fireEvent.keyDown(splitter, { key: "ArrowLeft", shiftKey: true });
    expect(useUiStore.getState().toolWidth).toBe(276);
  });

  it("never resizes past its bounds", () => {
    reset({ activeTool: "git", toolWidth: TOOL_WIDTH_MIN });
    renderPanel();
    const splitter = screen.getByRole("separator", { name: "Git panel width" });

    fireEvent.keyDown(splitter, { key: "ArrowLeft", shiftKey: true });
    expect(useUiStore.getState().toolWidth).toBe(TOOL_WIDTH_MIN);

    fireEvent.keyDown(splitter, { key: "End" });
    expect(useUiStore.getState().toolWidth).toBe(TOOL_WIDTH_MAX);
  });
});
