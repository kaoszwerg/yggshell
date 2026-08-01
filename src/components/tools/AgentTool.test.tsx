import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentTool } from "./AgentTool";
import { useUiStore } from "../../store/ui";
import type { AgentSession } from "../../bindings/AgentSession";

vi.mock("../../hooks/useContentFontSize", () => ({ useContentFontSize: () => 17 }));
vi.mock("../../hooks/useAgentSession", () => ({ useAgentSession: vi.fn() }));
// The account panel rides along inside the tool — the two answer one question ("what agent is here")
// and switching the account is part of it, so it needs the query client too.
vi.mock("../../api/environment", () => ({
  environmentApi: { status: vi.fn().mockResolvedValue(null) },
}));

import { useAgentSession } from "../../hooks/useAgentSession";

const SESSION: AgentSession = {
  session_id: "d56b6f22",
  model: "claude-opus-5",
  branch: "main",
  last_at: new Date(Date.now() - 90_000).toISOString(),
  context_tokens: 529_709n as unknown as bigint,
  output_tokens: 55_356n as unknown as bigint,
  turns: 44,
  home: "/Users/steve/.claude-privat",
};

function renderTool() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AgentTool />
    </QueryClientProvider>,
  );
}

function state(over: Partial<ReturnType<typeof useAgentSession>>) {
  vi.mocked(useAgentSession).mockReturnValue({
    session: SESSION,
    isPending: false,
    ready: true,
    ...over,
  });
}

describe("AgentTool", () => {
  beforeEach(() => {
    useUiStore.setState({ locale: "en" });
    vi.mocked(useAgentSession).mockReset();
  });

  it("names which account the session belongs to", async () => {
    // The point of the whole exercise: several Claude homes can be in use on one machine, and
    // "which account am I signed in as here" is what a shared machine makes hard to answer.
    state({});
    renderTool();

    expect(await screen.findByText(".claude-privat")).toBeInTheDocument();
  });

  it("shows the context as a count and never as a percentage", async () => {
    // The transcript records how many tokens a turn carried and never the size of the window they
    // went into. A percentage against a guessed maximum looks precise and is not (ADR-CORE-004).
    state({});
    const { container } = renderTool();

    expect(await screen.findByText("530k")).toBeInTheDocument();
    expect(container.textContent).not.toContain("%");
  });

  it("shows the model, the branch and how long ago the last turn was", async () => {
    state({});
    renderTool();

    expect(await screen.findByText("claude-opus-5")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("2m")).toBeInTheDocument();
  });

  it("says no agent has run here rather than showing an empty panel", async () => {
    // The ordinary case for most tabs, and not a failure.
    state({ session: null });
    renderTool();

    expect(await screen.findByText(/No agent has run/)).toBeInTheDocument();
  });

  it("says so when the tab has no terminal at all", async () => {
    state({ session: null, ready: false });
    renderTool();

    expect(await screen.findByText(/no terminal running/)).toBeInTheDocument();
  });

  it("admits what it is reading", async () => {
    // The transcript is the harness's own working file, not an interface it promises to keep. A tool
    // built on one should say so rather than present it as a supported feed.
    state({});
    renderTool();

    expect(await screen.findByText(/own working files/)).toBeInTheDocument();
  });

  it("draws its content at the terminal's own text size", async () => {
    // rule:content-size — reported on this very tool.
    state({});
    const { container } = renderTool();

    await screen.findByText("claude-opus-5");
    const sized = container.querySelector<HTMLElement>("[style*='font-size']");
    expect(sized?.style.fontSize).toBe("17px");
  });
});
