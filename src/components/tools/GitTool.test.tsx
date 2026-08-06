import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitTool } from "./GitTool";
import { useTerminalStore } from "../../store/terminal";
import { GIT_SPLIT_MAX, GIT_SPLIT_MIN, useUiStore } from "../../store/ui";
import type { GitSnapshot } from "../../bindings/GitSnapshot";

vi.mock("../../api/git", () => ({
  gitApi: { snapshot: vi.fn() },
}));

// A fixed, unusual size so the assertion cannot pass by coincidence (rule:content-size).
vi.mock("../../hooks/useContentFontSize", () => ({ useToolFontSize: () => 17 }));

import { gitApi } from "../../api/git";

const SNAPSHOT: GitSnapshot = {
  remote: null,
  root: "/repo",
  detached: false,
  branch: "main",
  head: "1120952",
  ahead: 2,
  behind: 0,
  changes: [
    { path: "src/views/TerminalView.tsx", status: "modified", staged: false },
    { path: "src-tauri/src/settings.rs", status: "modified", staged: true },
  ],
  commits: [
    {
      sha: "1120952aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      short_sha: "1120952",
      summary: "feat(settings): choose which shell a terminal starts",
      parents: ["f7471b7bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      refs: ["main"],
      author: "Steve",
      when: "2026-07-31T15:12:00Z",
    },
    {
      sha: "f7471b7bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      short_sha: "f7471b7",
      summary: "fix(terminal): stop dropping a resize measured during the open",
      parents: [],
      refs: [],
      author: "Steve",
      when: "2026-07-30T09:00:00Z",
    },
  ],
};

function renderTool() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GitTool />
    </QueryClientProvider>,
  );
}

/** The tool reads the ACTIVE terminal's directory — that is how it follows a `cd`. */
function terminalIn(cwd: string | null) {
  useTerminalStore.setState({
    panes: [{ key: "p1", title: "Terminal 1", cwd: cwd ?? undefined }] as never,
    activeKey: "p1",
  });
}

describe("GitTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ gitSplit: 45 });
    vi.mocked(gitApi.snapshot).mockResolvedValue(SNAPSHOT);
    terminalIn("/repo");
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("draws its content at the tool's font size", async () => {
    // **The test rule:content-size requires per tool, and the one this tool never had.** Its sizes
    // were written in `rem` — resolved against the document root — so it followed the WebView zoom
    // and nothing else, while the other seven followed the terminal. Missed on two separate rounds
    // because a search for the hook could not find the one file that never imported it.
    const { container } = renderTool();
    await screen.findByLabelText("Changed files");

    const sized = [...container.querySelectorAll<HTMLElement>("[style*='font-size']")];
    expect(sized.length).toBeGreaterThan(0);
    for (const region of sized) expect(region.style.fontSize).toBe("17px");
  });

  it("waits, visibly, until a terminal has said where it is", () => {
    terminalIn(null);
    renderTool();

    expect(screen.getByText(/Waiting for the terminal to report where it is/)).toBeTruthy();
    expect(gitApi.snapshot).not.toHaveBeenCalled();
  });

  it("gives changes and history a scroll region each, so neither pushes the other away", async () => {
    renderTool();

    const changes = await screen.findByLabelText("Changed files");
    const history = screen.getByLabelText("Commit history");
    expect(changes.className).toContain("overflow-y-auto");
    expect(history.className).toContain("overflow-y-auto");
    // Both must be allowed to shrink below their content, or the scroll never engages.
    expect(changes.className).toContain("min-h-0");
    expect(history.className).toContain("min-h-0");
  });

  it("puts a horizontal splitter between them at the remembered share", async () => {
    useUiStore.setState({ gitSplit: 62 });
    renderTool();

    const splitter = await screen.findByRole("separator", { name: "Changes and history" });
    expect(splitter.getAttribute("aria-orientation")).toBe("horizontal");
    expect(splitter.getAttribute("aria-valuenow")).toBe("62");
    expect(splitter.getAttribute("aria-valuemin")).toBe(String(GIT_SPLIT_MIN));
    expect(splitter.getAttribute("aria-valuemax")).toBe(String(GIT_SPLIT_MAX));
    expect(screen.getByLabelText("Changed files")).toHaveStyle({ flex: "0 0 62%" });
  });

  it("remembers a dragged divider in the store, so it survives a re-render and a restart", async () => {
    renderTool();
    const splitter = await screen.findByRole("separator", { name: "Changes and history" });

    fireEvent.keyDown(splitter, { key: "ArrowDown" });

    expect(useUiStore.getState().gitSplit).toBe(53);
    expect(splitter.getAttribute("aria-valuenow")).toBe("53");
  });

  it("keeps the branch out of the split — it is a fixed header, not a region", async () => {
    renderTool();

    // "main" itself appears twice — as the branch and as a ref label in the graph — so the header
    // is identified by its own caption instead.
    const header = await screen.findByText("BRANCH");
    expect(screen.getByLabelText("Changed files").contains(header)).toBe(false);
    expect(screen.getByLabelText("Commit history").contains(header)).toBe(false);
    // …and it must not be inside the flexible body at all, so it never shrinks or scrolls away.
    expect(header.closest('[data-region="body"]')).toBeNull();
  });

  it("shows the changes and the history it was given", async () => {
    renderTool();

    expect(await screen.findByText("src/views/TerminalView.tsx")).toBeTruthy();
    expect(screen.getByText("src-tauri/src/settings.rs")).toBeTruthy();
    expect(screen.getByText("1120952")).toBeTruthy();
    expect(screen.getByText(/choose which shell a terminal starts/)).toBeTruthy();
  });
});
