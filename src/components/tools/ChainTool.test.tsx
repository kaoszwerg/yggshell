import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as renderRaw, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { Chain } from "../../bindings/Chain";
import type { ChainLink } from "../../bindings/ChainLink";

/**
 * The "no plan" state offers to install the nudge, and that offer is a real query — so the tool
 * needs a client even though its own data is mocked. Retries off: a failing fixture should fail
 * immediately rather than after three attempts.
 */
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderRaw(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const state = { chain: null as Chain | null, isPending: false, isError: false, ready: true };

vi.mock("../../hooks/useChain", () => ({ useChain: () => state }));
// A fixed, unusual size so the assertion cannot pass by coincidence (rule:content-size).
vi.mock("../../hooks/useContentFontSize", () => ({ useContentFontSize: () => 17 }));

const { ChainTool } = await import("./ChainTool");

function link(over: Partial<ChainLink> = {}): ChainLink {
  return {
    act: "verify",
    refinement: "core",
    outcome: "done",
    kind: "normal",
    reach: null,
    seconds: 120n as unknown as bigint,
    steps: 3,
    noise: 5,
    iterations: null,
    rounds: [],
    guessed: false,
    ...over,
  } as ChainLink;
}

function chain(over: Partial<Chain> = {}): Chain {
  return {
    links: [link()],
    plan: [],
    plan_done: false,
    expected: [],
    elapsed: 3600n as unknown as bigint,
    steps_seen: 100,
    steps_understood: 90,
    home: "/home/.claude",
    session_id: "abc",
    harness_version: "2.1.223",
    ...over,
  } as Chain;
}

beforeEach(() => {
  state.chain = chain();
  state.isPending = false;
  state.isError = false;
  state.ready = true;
});

describe("ChainTool", () => {
  it("draws its content at the terminal's font size", () => {
    // The rule's own required proof, per surface: a hook that is imported and never reaches the DOM
    // looks identical from the outside.
    const { container } = render(<ChainTool />);
    const sized = container.querySelector<HTMLElement>("[style*='font-size']");

    expect(sized?.style.fontSize).toBe("17px");
  });

  it("puts the size on a container that holds the header too, not only the scroll region", () => {
    // The defect this prevents: with the header fixed, turning the text up leaves the line that says
    // what is RUNNING as the smallest thing on screen — the inversion rule:content-size records from
    // the Markdown headings.
    const { container } = render(<ChainTool />);
    const sized = container.querySelector<HTMLElement>("[style*='font-size']");

    expect(sized?.textContent).toContain("verify");
  });

  it("says when no agent has run here rather than showing an empty frame", () => {
    state.chain = null;
    render(<ChainTool />);

    expect(screen.getByText(/no agent has run/i)).toBeTruthy();
  });

  it("handles loading and failure as their own states", () => {
    state.isPending = true;
    const { unmount } = render(<ChainTool />);
    expect(screen.getByText(/reading the session/i)).toBeTruthy();
    unmount();

    state.isPending = false;
    state.isError = true;
    render(<ChainTool />);
    expect(screen.getByText(/could not be read/i)).toBeTruthy();
  });

  it("says a session keeps no plan instead of leaving the reader to infer it", () => {
    render(<ChainTool />);
    expect(screen.getByText(/keeps no plan/i)).toBeTruthy();
  });

  it("distinguishes a finished plan from an absent one", () => {
    // The store is cleared the moment nothing is open, so these look identical there — and reporting
    // "no plan" at the moment of success is the worst possible time to be wrong.
    state.chain = chain({ plan: [], plan_done: true });
    render(<ChainTool />);

    expect(screen.getByText(/every planned step is finished/i)).toBeTruthy();
  });

  it("shows the iteration count without anything being expanded", () => {
    // `verify ⇄ build ×16` is the one number that says "this is not progressing".
    state.chain = chain({
      links: [
        link({
          iterations: 16,
          rounds: [{ act: "build", refinement: "a.rs" } as never],
          outcome: "failed",
        }),
      ],
    });
    render(<ChainTool />);

    expect(screen.getByText("16×")).toBeTruthy();
    expect(screen.queryByText("a.rs")).toBeNull();
  });

  it("reveals what a cycle consisted of when asked", () => {
    state.chain = chain({
      links: [
        link({
          iterations: 3,
          rounds: [{ act: "build", refinement: "UserManagement.jsx" } as never],
        }),
      ],
    });
    render(<ChainTool />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("UserManagement.jsx")).toBeTruthy();
  });

  it("always shows where a run reaches", () => {
    // rule:work-legibility calls the target "the axis that hurts when it is wrong". Showing it only
    // for production would teach people that its absence means safety.
    state.chain = chain({
      links: [link({ reach: { target: "prod", host: "app.example.com", disputed: false } })],
    });
    render(<ChainTool />);

    expect(screen.getByText(/app\.example\.com/)).toBeTruthy();
  });

  it("marks a guessed classification as a guess", () => {
    state.chain = chain({ links: [link({ guessed: true })] });
    render(<ChainTool />);

    expect(screen.getByLabelText(/guessed/i)).toBeTruthy();
  });

  it("says how much work a delegated step is hiding", () => {
    // Without this a `Task` node looks like nothing happened, in exactly the sessions that follow
    // rule:agent-delegation.
    state.chain = chain({ links: [link({ kind: "delegated", steps: 412 })] });
    render(<ChainTool />);

    expect(screen.getByText(/412 steps in a subagent/i)).toBeTruthy();
  });

  it("gives every state marker a text alternative", () => {
    // Under prefers-reduced-motion the pulse is gone, so live and done would differ by hue alone.
    const { container } = render(<ChainTool />);
    const markers = container.querySelectorAll("[role='img']");

    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) expect(marker.getAttribute("aria-label")).toBeTruthy();
  });

  it("never shows a bare '0 min', which reads as 'did not run'", () => {
    state.chain = chain({ links: [link({ seconds: 12n as unknown as bigint })] });
    const { container } = render(<ChainTool />);

    expect(container.textContent).not.toMatch(/\b0 min\b/);
    expect(container.textContent).toContain("< 1 min");
  });

  it("uses no native disclosure element", () => {
    state.chain = chain({
      links: [link({ iterations: 2, rounds: [{ act: "build", refinement: "x" } as never] })],
    });
    const { container } = render(<ChainTool />);

    expect(container.querySelector("details")).toBeNull();
  });
});
