import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";
import { pane } from "../../test/panes";
import type { EnvironmentStatus } from "../../bindings/EnvironmentStatus";

vi.mock("../../api/environment", () => ({
  environmentApi: {
    status: vi.fn(),
    setProject: vi.fn(),
    createHome: vi.fn(),
    installDirenv: vi.fn(),
  },
}));

import { environmentApi } from "../../api/environment";

const STATUS: EnvironmentStatus = {
  homes: [
    { path: "/Users/steve/.claude", name: ".claude", used_here: false },
    { path: "/Users/steve/.claude-privat", name: ".claude-privat", used_here: true },
  ],
  declared: "/Users/steve/.claude-privat",
  has_envrc: true,
  direnv_installed: true,
  direnv_allowed: true,
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EnvironmentPanel />
    </QueryClientProvider>,
  );
}

describe("EnvironmentPanel", () => {
  beforeEach(() => {
    vi.mocked(environmentApi.status).mockReset();
    vi.mocked(environmentApi.setProject).mockReset();
    vi.mocked(environmentApi.createHome).mockReset();
    vi.mocked(environmentApi.installDirenv).mockReset();
    useUiStore.setState({ locale: "en" });
    useTerminalStore.setState({ panes: [pane({ key: "p1", cwd: "/repo" })], activeKey: "p1" });
  });

  it("marks the account this project is actually pointed at", async () => {
    vi.mocked(environmentApi.status).mockResolvedValue(STATUS);
    renderPanel();

    const row = await screen.findByRole("button", { name: ".claude-privat" });
    // `aria-current`, not `aria-selected`: the row marks what is in effect (Row).
    expect(row).toHaveAttribute("aria-current", "true");
  });

  it("names the file it wrote, because that is the condition of approving it", async () => {
    // Approving an .envrc spends direnv's own safety. It is defensible only if the app wrote the
    // file itself AND tells the user which one — so the path is reported, not swallowed.
    vi.mocked(environmentApi.status).mockResolvedValue(STATUS);
    vi.mocked(environmentApi.setProject).mockResolvedValue("/repo/.envrc");
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: ".claude" }));

    expect(await screen.findByText(/\/repo\/\.envrc/)).toBeInTheDocument();
    expect(vi.mocked(environmentApi.setProject).mock.calls[0]).toEqual([
      "/repo",
      "/Users/steve/.claude",
    ]);
  });

  it("offers to install direnv only when it is missing", async () => {
    vi.mocked(environmentApi.status).mockResolvedValue(STATUS);
    const { unmount } = renderPanel();
    await screen.findByRole("button", { name: ".claude" });
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    unmount();

    vi.mocked(environmentApi.status).mockResolvedValue({ ...STATUS, direnv_installed: false });
    renderPanel();
    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("says when a declaration exists but direnv is not allowed to load it", async () => {
    // Worth saying out loud: this looks exactly like the setting having had no effect.
    vi.mocked(environmentApi.status).mockResolvedValue({ ...STATUS, direnv_allowed: false });
    renderPanel();

    expect(await screen.findByText(/not been allowed to load/)).toBeInTheDocument();
  });

  it("creates a new account and says where, without touching a credential", async () => {
    vi.mocked(environmentApi.status).mockResolvedValue(STATUS);
    vi.mocked(environmentApi.createHome).mockResolvedValue("/Users/steve/.claude-work");
    renderPanel();

    fireEvent.change(await screen.findByLabelText("New account"), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText(/signs in there on first use/)).toBeInTheDocument();
    expect(vi.mocked(environmentApi.createHome).mock.calls[0]?.[0]).toBe("work");
  });

  it("surfaces a failure instead of appearing to have worked", async () => {
    vi.mocked(environmentApi.status).mockResolvedValue(STATUS);
    vi.mocked(environmentApi.setProject).mockRejectedValue(new Error("permission denied"));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: ".claude" }));
    await waitFor(() => expect(screen.getByText(/permission denied/)).toBeInTheDocument());
  });
});
