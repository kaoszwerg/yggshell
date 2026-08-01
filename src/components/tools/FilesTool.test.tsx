import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilesTool } from "./FilesTool";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";
import { pane } from "../../test/panes";
import type { DirEntry } from "../../bindings/DirEntry";

vi.mock("../../hooks/useContentFontSize", () => ({ useContentFontSize: () => 17 }));
vi.mock("../../api/files", () => ({
  filesApi: { list: vi.fn(), reveal: vi.fn() },
}));

import { filesApi } from "../../api/files";

function entry(over: Partial<DirEntry>): DirEntry {
  return {
    name: "x",
    path: "/repo/x",
    directory: false,
    symlink: false,
    size: BigInt(0) as unknown as bigint,
    hidden: false,
    ...over,
  } as DirEntry;
}

const ROOT = [
  entry({ name: "src", path: "/repo/src", directory: true, size: null }),
  entry({ name: ".env", path: "/repo/.env", hidden: true, size: 12n }),
  entry({ name: "README.md", path: "/repo/README.md", size: 2048n }),
];

function renderTool() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FilesTool />
    </QueryClientProvider>,
  );
}

describe("FilesTool", () => {
  beforeEach(() => {
    vi.mocked(filesApi.list).mockReset();
    vi.mocked(filesApi.reveal).mockReset();
    useUiStore.setState({ locale: "en", filesShowHidden: false });
    useTerminalStore.setState({
      panes: [pane({ key: "p1", cwd: "/repo" })],
      activeKey: "p1",
    });
  });

  it("says it is waiting rather than showing an empty tree before the shell reports", async () => {
    // An empty tree reads as "this folder is empty", which is a different fact from "I do not know
    // where the terminal is yet".
    useTerminalStore.setState({ panes: [pane({ key: "p1", cwd: null })], activeKey: "p1" });
    renderTool();

    expect(await screen.findByText(/Waiting for the terminal/)).toBeInTheDocument();
    expect(filesApi.list).not.toHaveBeenCalled();
  });

  it("lists the tab's own working directory", async () => {
    vi.mocked(filesApi.list).mockResolvedValue({ entries: ROOT, truncated: false });
    renderTool();

    expect(await screen.findByText("src")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    // Root AND path are the same on the first call: the tab's directory bounds everything below it.
    expect(vi.mocked(filesApi.list).mock.calls[0]).toEqual(["/repo", "/repo"]);
  });

  it("hides dot-entries until asked, and then shows them", async () => {
    vi.mocked(filesApi.list).mockResolvedValue({ entries: ROOT, truncated: false });
    renderTool();

    await screen.findByText("src");
    expect(screen.queryByText(".env")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show hidden entries" }));
    expect(await screen.findByText(".env")).toBeInTheDocument();
  });

  it("fetches a subfolder only when it is opened, and closes it again", async () => {
    vi.mocked(filesApi.list).mockImplementation((_root, path) =>
      Promise.resolve(
        path === "/repo/src"
          ? {
              entries: [entry({ name: "main.rs", path: "/repo/src/main.rs", size: 9n })],
              truncated: false,
            }
          : { entries: ROOT, truncated: false },
      ),
    );
    renderTool();

    // The point of the tree: nothing under `src` is read until somebody asks for it. A recursive
    // fetch would have read `node_modules` before the first row was drawn.
    await screen.findByText("src");
    expect(screen.queryByText("main.rs")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "src" }));
    expect(await screen.findByText("main.rs")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "src" }));
    await waitFor(() => expect(screen.queryByText("main.rs")).toBeNull());
  });

  it("says when a listing was capped instead of quietly showing fewer files", async () => {
    // A truncation nobody mentions is a lie about what is on disk.
    vi.mocked(filesApi.list).mockResolvedValue({ entries: ROOT, truncated: true });
    renderTool();

    expect(await screen.findByText(/Too many entries/)).toBeInTheDocument();
  });

  it("names the reason a folder could not be read", async () => {
    // "Gone" and "not permitted" are different problems and only the message says which.
    vi.mocked(filesApi.list).mockRejectedValue(new Error("permission denied"));
    renderTool();

    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
  });

  it("distinguishes an empty folder from one where everything is hidden", async () => {
    vi.mocked(filesApi.list).mockResolvedValue({
      entries: [
        entry({ name: ".git", path: "/repo/.git", directory: true, hidden: true, size: null }),
      ],
      truncated: false,
    });
    renderTool();

    expect(await screen.findByText("Everything here is hidden.")).toBeInTheDocument();
  });

  it("draws its content at the terminal's own text size", async () => {
    // rule:content-size. Reported as "I don't think the agent widget honours the text size" — and
    // it did not, nor did any other tool. The Git detail panel already followed it: code is code.
    vi.mocked(filesApi.list).mockResolvedValue({ entries: ROOT, truncated: false });
    const { container } = renderTool();

    await screen.findByText("src");
    const sized = container.querySelector<HTMLElement>("[style*='font-size']");
    expect(sized?.style.fontSize).toBe("17px");
  });
});
