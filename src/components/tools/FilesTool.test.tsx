import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilesTool } from "./FilesTool";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";
import { pane } from "../../test/panes";
import type { DirEntry } from "../../bindings/DirEntry";

vi.mock("../../hooks/useContentFontSize", () => ({ useToolFontSize: () => 17 }));
vi.mock("../../api/files", () => ({
  filesApi: { list: vi.fn(), reveal: vi.fn(), open: vi.fn(() => Promise.resolve()) },
}));

vi.mock("../../api/terminal", () => ({
  terminalApi: { write: vi.fn(() => Promise.resolve()) },
}));

import { filesApi } from "../../api/files";
import { terminalApi } from "../../api/terminal";

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

describe("what a path can be opened as", () => {
  beforeEach(() => {
    // Cleared here, or a later test reads the call an earlier one made — which is exactly what the
    // quoting assertion did before this line existed.
    vi.clearAllMocks();
    vi.mocked(filesApi.list).mockResolvedValue({ entries: ROOT, truncated: false });
    useTerminalStore.setState({
      panes: [pane({ key: "a", cwd: "/repo", sessionId: 7 })],
      activeKey: "a",
      bootstrapped: true,
    });
  });

  it("reads a file in the panel rather than launching anything", async () => {
    // The whole reason the inline viewer exists: handing a path to the platform's default handler
    // starts an application chosen by the FILE. Here the type only picks a highlighter.
    renderTool();
    fireEvent.contextMenu(await screen.findByText("README.md"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "View here" }));

    expect(useTerminalStore.getState().panes[0]?.detail).toEqual({
      kind: "text",
      root: "/repo",
      path: "/repo/README.md",
    });
    expect(filesApi.open).not.toHaveBeenCalled();
  });

  it("offers a rendered view for markdown, and asks for it directly", async () => {
    // A document you open to READ should not have to be opened wrong first. The panel carries the
    // same switch, so the choice is not final either way.
    renderTool();
    fireEvent.contextMenu(await screen.findByText("README.md"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "View as markdown" }));

    expect(useTerminalStore.getState().panes[0]?.detail).toEqual({
      kind: "text",
      root: "/repo",
      path: "/repo/README.md",
      rendered: true,
    });
  });

  it("does not offer it for a file that has nothing to render", async () => {
    renderTool();
    fireEvent.click(await screen.findByRole("button", { name: "Show hidden entries" }));
    fireEvent.contextMenu(await screen.findByText(".env"));
    await screen.findByRole("menu");

    expect(screen.getByRole("menuitem", { name: "View here" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "View as markdown" })).toBeNull();
  });

  it("offers neither viewing nor opening for a directory", async () => {
    renderTool();
    fireEvent.contextMenu(await screen.findByText("src"));
    await screen.findByRole("menu");

    expect(screen.queryByRole("menuitem", { name: "View here" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Open with the default app" })).toBeNull();
  });

  it("opens a new terminal in the directory itself", async () => {
    renderTool();
    fireEvent.contextMenu(await screen.findByText("src"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open in a new terminal" }));

    const opened = useTerminalStore.getState().panes.at(-1);
    expect(opened?.cwd).toBe("/repo/src");
  });

  it("opens a new terminal in a FILE's parent", async () => {
    // What dropping a file on a terminal has always meant, and what `launch::resolve` does for `ygg`
    // and Finder — one behaviour, three doors.
    renderTool();
    fireEvent.contextMenu(await screen.findByText("README.md"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open in a new terminal" }));

    expect(useTerminalStore.getState().panes.at(-1)?.cwd).toBe("/repo");
  });

  it("TYPES cd into the running terminal and does not run it", async () => {
    // ADR-PROJ-001 §5: the webview does not get to decide that something executes. It writes the
    // command to the prompt; the user presses Enter. No trailing newline, ever.
    renderTool();
    fireEvent.contextMenu(await screen.findByText("src"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Type cd into this terminal" }));

    await waitFor(() => expect(terminalApi.write).toHaveBeenCalled());
    const [, text] = vi.mocked(terminalApi.write).mock.calls[0] ?? [];
    expect(text).toBe("cd '/repo/src'");
    expect(text).not.toContain("\n");
  });

  it("quotes a path so a prompt cannot be talked into anything", async () => {
    // A path is user data and this text lands at a prompt. Single quotes stop the shell interpreting
    // anything at all; the one character that cannot appear inside them is closed, escaped, reopened.
    vi.mocked(filesApi.list).mockResolvedValue({
      entries: [entry({ name: "od'd; rm -rf ~", path: "/repo/od'd; rm -rf ~", directory: true })],
      truncated: false,
    });
    renderTool();
    fireEvent.contextMenu(await screen.findByText("od'd; rm -rf ~"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Type cd into this terminal" }));

    await waitFor(() => expect(terminalApi.write).toHaveBeenCalled());
    const [, text] = vi.mocked(terminalApi.write).mock.calls[0] ?? [];
    expect(text).toBe(`cd '/repo/od'\\''d; rm -rf ~'`);
  });
});
