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

/** Whether the fixture repository declares its levels. `true` is the quiet case. */
let declared = true;

// A tab that has reported where it is. Without one the offer is deliberately silent — it has no
// repository to be about — so the fixture has to supply it or the test proves nothing.
vi.mock("../../store/terminal", () => ({
  useTerminalStore: (select: (s: unknown) => unknown) =>
    select({ panes: [{ key: "a", cwd: "/repo" }], activeKey: "a" }),
}));

vi.mock("../../api/environment", () => ({
  environmentApi: {
    adoptionState: () => Promise.resolve({ declared, gate: declared, gate_stale: false }),
    adoptionRule: () => Promise.resolve("the rule"),
    adoptionInstallGate: () => Promise.resolve("/repo/scripts/check-work-levels.mjs"),
    nudgeInstalled: () => Promise.resolve(true),
    installPlanNudge: () => Promise.resolve("/settings.json"),
  },
}));

vi.mock("../../hooks/useChain", () => ({ useChain: () => state }));
// A fixed, unusual size so the assertion cannot pass by coincidence (rule:content-size).
vi.mock("../../hooks/useContentFontSize", () => ({ useToolFontSize: () => 17 }));

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
    idle: 5n as unknown as bigint,
    standing: "working",
    waiting_for: null,
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

  it("says which of the two silences this is, never just 'quiet'", () => {
    // The maintainer's own formulation and the reason the panel exists: an agent that is not
    // working is either waiting for a person or has nothing outstanding. One word for both would
    // send the reader to the terminal to find out — the work this is meant to save.
    state.chain = chain({
      standing: "waiting",
      waiting_for: "Claude needs permission to use Bash",
    });
    const { unmount } = render(<ChainTool />);
    expect(screen.getByText(/waiting for you/i)).toBeTruthy();
    expect(screen.getByText(/needs permission/i)).toBeTruthy();
    unmount();

    state.chain = chain({ standing: "idle", idle: 900n as unknown as bigint });
    render(<ChainTool />);
    expect(screen.getByText(/nothing outstanding/i)).toBeTruthy();
  });

  it("hides a finished plan entirely rather than showing struck-through lines", () => {
    // The harness clears its list the moment nothing is open. Nineteen crossed-off lines saying
    // "all done" is a panel asking for attention it does not need.
    state.chain = chain({
      plan: [{ id: "1", subject: "done thing", status: "completed", blocked_by: [] }],
      standing: "idle",
    });
    render(<ChainTool />);

    expect(screen.queryByText("done thing")).toBeNull();
  });

  it("keeps finished steps visible while anything is still open", () => {
    state.chain = chain({
      plan: [
        { id: "1", subject: "done thing", status: "completed", blocked_by: [] },
        { id: "2", subject: "open thing", status: "pending", blocked_by: [] },
      ],
    });
    render(<ChainTool />);

    expect(screen.getByText("done thing")).toBeTruthy();
    // Twice, and both are right: once as the goal being worked towards, once in the list.
    expect(screen.getAllByText("open thing").length).toBe(2);
  });

  it("shows one line and no chain when nothing is outstanding", () => {
    // The maintainer, twice: "plan abgeschlossen und du bist mit allem fertig … es wird gar nichts
    // angezeigt". Sixty-one links of finished work is a logbook, not a status — and a panel that
    // looks equally busy whether or not anything is happening has stopped answering its question.
    state.chain = chain({ standing: "idle", links: [link({ refinement: "some-suite" })] });
    render(<ChainTool />);

    expect(screen.getByText(/nothing outstanding/i)).toBeTruthy();
    expect(screen.queryByText("some-suite")).toBeNull();
    // The record is one keystroke away, not gone.
    expect(screen.getByRole("button", { name: /show the record/i })).toBeTruthy();
  });

  it("shows the chain while work is happening", () => {
    state.chain = chain({ standing: "working", links: [link({ refinement: "some-suite" })] });
    render(<ChainTool />);

    expect(screen.getAllByText("some-suite").length).toBeGreaterThan(0);
  });

  it("times the running step, not the session", () => {
    // "running for 4:26 h" was shown about a step that had started a minute earlier: the number was
    // real and answered a different question than the sentence around it asked.
    state.chain = chain({
      standing: "working",
      elapsed: 16000n as unknown as bigint,
      links: [link({ seconds: 90n as unknown as bigint })],
    });
    render(<ChainTool />);

    expect(screen.getByText(/running for 2 min/i)).toBeTruthy();
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

    // By its own count, not "the button": the legend at the foot is one too, and a test that breaks
    // when a second control appears was never asserting what it claimed to.
    fireEvent.click(screen.getByText(/3×/));

    expect(screen.getByText("UserManagement.jsx")).toBeTruthy();
  });

  it("shows where a run reaches, on the link itself and not only in the header", () => {
    // rule:work-legibility calls the target "the axis that hurts when it is wrong". Showing it only
    // for production would teach people that its absence means safety — and showing it only in the
    // header answers the question for one line while "am I about to hit production?" is a question
    // about the step being read.
    state.chain = chain({
      links: [link({ reach: { target: "prod", host: "app.example.com", disputed: false } })],
    });
    render(<ChainTool />);

    expect(screen.getAllByText(/app\.example\.com/).length).toBeGreaterThanOrEqual(2);
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

  it("offers the convention only to a repository that does not already declare its levels", async () => {
    // Proposing to fix something that may not be missing is worse than proposing nothing, so the
    // offer stays hidden until the answer is a definite "no declaration here".
    state.chain = chain({ links: [link()] });
    render(<ChainTool />);
    expect(screen.queryByText(/does not declare its runs/i)).toBeNull();

    declared = false;
    render(<ChainTool />);
    expect(await screen.findByText(/does not declare its runs/i)).toBeTruthy();
    // Two channels, and they are not interchangeable: the gate is written, the rule is copied.
    expect(screen.getByText(/copy the rule/i)).toBeTruthy();
    expect(screen.getByText(/put the check in this repo/i)).toBeTruthy();
  });

  it("offers the convention while the agent is at rest, and with no chain at all", async () => {
    // **The state a foreign repository is actually in when you open it**, and the one the offer was
    // invisible in: it lived inside the trace, which an idle agent never renders. Measured on
    // lysisai-dsp — 62 links, nothing outstanding, neither file present, nothing offered.
    declared = false;
    state.chain = chain({ links: [link()], standing: "idle", plan: [] });
    render(<ChainTool />);
    expect(await screen.findByText(/does not declare its runs/i)).toBeTruthy();

    // And before the agent has written anything at all here.
    state.chain = chain({ links: [] });
    render(<ChainTool />);
    expect((await screen.findAllByText(/does not declare its runs/i)).length).toBeGreaterThan(0);
  });

  it("explains the marks on demand, and says which region each one belongs to", () => {
    // A flat list of six shapes answers "how did that go?" and leaves "what is still outstanding?"
    // unanswered — which is the question that was actually asked. The headings are the answer.
    state.chain = chain({ links: [link()] });
    render(<ChainTool />);

    fireEvent.click(screen.getByText(/what the marks mean/i));

    expect(screen.getByText(/^in the trace$/i)).toBeTruthy();
    expect(screen.getByText(/^in the plan$/i)).toBeTruthy();
    expect(screen.getByText(/^below the trace$/i)).toBeTruthy();
    // The one that only ever appears ahead of the trace, and is not a plan.
    expect(screen.getByText(/not a plan/i)).toBeTruthy();
  });

  it("keeps the legend out of the scrolling trace", () => {
    // A legend that scrolls away is unreachable exactly when the trace is long enough to want one.
    state.chain = chain({ links: Array.from({ length: 40 }, () => link()) });
    const { container } = render(<ChainTool />);

    const summary = screen.getByText(/what the marks mean/i);
    const scroller = container.querySelector("[data-chain-trace]");

    expect(scroller).not.toBeNull();
    expect(scroller?.contains(summary)).toBe(false);
  });

  it("uses no native disclosure element", () => {
    state.chain = chain({
      links: [link({ iterations: 2, rounds: [{ act: "build", refinement: "x" } as never] })],
    });
    const { container } = render(<ChainTool />);

    expect(container.querySelector("details")).toBeNull();
  });
});
