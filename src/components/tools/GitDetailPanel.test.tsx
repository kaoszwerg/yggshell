import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitDetailPanel } from "./GitDetailPanel";
import { useTerminalStore } from "../../store/terminal";
import { pane } from "../../test/panes";
import type { GitDetail } from "../../store/ui";
import type { GitCommitDetail } from "../../bindings/GitCommitDetail";
import type { GitDiff } from "../../bindings/GitDiff";

vi.mock("../../api/git", () => ({
  gitApi: { fileDiff: vi.fn(), commit: vi.fn(), commitFileDiff: vi.fn() },
}));

import { gitApi } from "../../api/git";

const DIFF: GitDiff = {
  path: "src/lib/highlight.ts",
  old_path: null,
  status: "modified",
  staged: false,
  binary: false,
  added: 1,
  removed: 1,
  hunks: [
    {
      header: "@@ -1,3 +1,3 @@",
      old_start: 1,
      new_start: 1,
      lines: [
        { kind: "context", old_line: 1, new_line: 1, text: "const a = 1;" },
        { kind: "removed", old_line: 2, new_line: null, text: "const b = 2;" },
        { kind: "added", old_line: null, new_line: 2, text: "const b = 3;" },
      ],
    },
  ],
};

const COMMIT: GitCommitDetail = {
  sha: "1120952aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  short_sha: "1120952",
  summary: "feat(settings): choose which shell a terminal starts",
  body: "The gap was small; the shape of the fix is not.",
  author_name: "Steve",
  author_email: "steve@example.com",
  authored_at: "2026-07-31T15:12:00Z",
  parents: ["f7471b7bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
  refs: ["main"],
  files: [
    {
      path: "src/api/commands.ts",
      old_path: null,
      status: "modified",
      added: 4,
      removed: 1,
      binary: false,
    },
    { path: "icon.png", old_path: null, status: "added", added: 0, removed: 0, binary: true },
  ],
};

/** Put something in the one tab this suite renders — the panel belongs to a tab, not to the window. */
function showDetail(detail: GitDetail | null, cwd: string | null = "/repo") {
  useTerminalStore.setState({
    panes: [pane({ key: "p1", title: "Terminal 1", cwd, detail })],
    activeKey: "p1",
  });
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GitDetailPanel paneKey="p1" />
    </QueryClientProvider>,
  );
}

describe("GitDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitApi.fileDiff).mockResolvedValue(DIFF);
    vi.mocked(gitApi.commit).mockResolvedValue(COMMIT);
    vi.mocked(gitApi.commitFileDiff).mockResolvedValue({ ...DIFF, staged: true });
    showDetail(null);
    showDetail(null);
  });

  it("renders nothing while it is closed — the terminal is what you should be looking at", () => {
    renderPanel();
    expect(screen.queryByRole("region", { name: "Git detail" })).toBeNull();
  });

  it("stays closed when no terminal has said which repository this is", () => {
    showDetail({ kind: "file", path: "a.ts", staged: false }, null);
    renderPanel();
    expect(screen.queryByRole("region", { name: "Git detail" })).toBeNull();
    expect(gitApi.fileDiff).not.toHaveBeenCalled();
  });

  it("shows a file diff with both line numbers and its added and removed lines", async () => {
    showDetail({ kind: "file", path: "src/lib/highlight.ts", staged: false });
    renderPanel();

    expect(await screen.findByText("const b = 3;")).toBeTruthy();
    expect(screen.getByText("const b = 2;")).toBeTruthy();
    expect(screen.getByText("@@ -1,3 +1,3 @@")).toBeTruthy();
    expect(gitApi.fileDiff).toHaveBeenCalledWith("/repo", "src/lib/highlight.ts", false);
  });

  it("says which side of the change it is showing, because they are different diffs", async () => {
    showDetail({ kind: "file", path: "a.ts", staged: true });
    renderPanel();
    expect(await screen.findByText(/HEAD vs\. the index/)).toBeTruthy();
  });

  it("closes on Escape and gives the terminal back", async () => {
    showDetail({ kind: "file", path: "a.ts", staged: false });
    renderPanel();
    await screen.findByRole("region", { name: "Git detail" });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(useTerminalStore.getState().panes[0]?.detail).toBeNull();
  });

  it("closes on the × as well", async () => {
    showDetail({ kind: "file", path: "a.ts", staged: false });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Close" }));

    expect(useTerminalStore.getState().panes[0]?.detail).toBeNull();
  });

  it("takes focus, so a keystroke cannot land in a terminal the user can no longer see", async () => {
    showDetail({ kind: "file", path: "a.ts", staged: false });
    renderPanel();
    const panel = await screen.findByRole("region", { name: "Git detail" });
    await waitFor(() => expect(document.activeElement).toBe(panel));
  });

  it("shows a commit's whole message, not the summary the graph already had", async () => {
    showDetail({ kind: "commit", rev: COMMIT.sha });
    renderPanel();

    expect(await screen.findByText(/The gap was small/)).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText(/Steve/)).toBeTruthy();
  });

  it("lists a commit's files with line counts, and says 'binary' instead of a fake zero", async () => {
    showDetail({ kind: "commit", rev: COMMIT.sha });
    renderPanel();

    expect(await screen.findByText("src/api/commands.ts")).toBeTruthy();
    expect(screen.getByText("+4")).toBeTruthy();
    expect(screen.getByText("−1")).toBeTruthy();
    expect(screen.getByText("binary")).toBeTruthy();
  });

  it("opens a file from a commit, and offers the way back to it", async () => {
    showDetail({ kind: "commit", rev: COMMIT.sha });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /src\/api\/commands\.ts/ }));

    expect(useTerminalStore.getState().panes[0]?.detail).toEqual({
      kind: "commit-file",
      rev: COMMIT.sha,
      path: "src/api/commands.ts",
    });

    fireEvent.click(await screen.findByRole("button", { name: "Back to the commit" }));
    expect(useTerminalStore.getState().panes[0]?.detail).toEqual({
      kind: "commit",
      rev: COMMIT.sha,
    });
  });

  it("surfaces a backend failure instead of showing an empty panel", async () => {
    vi.mocked(gitApi.fileDiff).mockRejectedValue(new Error("git: could not read a blob"));
    showDetail({ kind: "file", path: "a.ts", staged: false });
    renderPanel();

    expect(await screen.findByText(/could not read a blob/)).toBeTruthy();
  });

  it("says so when the file has since gone, rather than rendering nothing", async () => {
    vi.mocked(gitApi.fileDiff).mockResolvedValue(null);
    showDetail({ kind: "file", path: "a.ts", staged: false });
    renderPanel();

    expect(await screen.findByText(/no longer in the repository/)).toBeTruthy();
  });
});
