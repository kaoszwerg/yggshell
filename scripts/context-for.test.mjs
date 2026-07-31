// @vitest-environment node
// The resolver decides what an agent actually reads (ADR-CORE-006), so it is gated like production code
// (rule:testing). The matching logic is exercised against synthetic documents; the wiring — that every
// governed kind really is reported — is exercised end-to-end against the CLI.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { globToRe, matches, reportLines } from "./context-for.mjs";
import { ROOT } from "./lib/governance.mjs";

const doc = (id, data) => ({ rel: `.claude/memory/${id}.md`, data: { id, tldr: "T.", ...data } });
const noCtx = { keywords: [], files: [] };

describe("matching a document against a task", () => {
  it("always matches a core document", () => {
    expect(matches(doc("mem:a", { load: "core" }), noCtx)).toEqual({ hit: true, why: "core" });
  });

  it("never matches an archival document", () => {
    expect(
      matches(doc("mem:a", { load: "archival", triggers: ["x"] }), { keywords: ["x"] }).hit,
    ).toBe(false);
  });

  it("matches a conditional document on a trigger keyword", () => {
    const d = doc("mem:a", { load: "conditional", triggers: ["Backlog", "todo"] });
    expect(matches(d, { keywords: ["backlog"] })).toEqual({ hit: true, why: "trigger:backlog" });
  });

  it("does not match a conditional document whose triggers miss", () => {
    const d = doc("mem:a", { load: "conditional", triggers: ["backlog"] });
    expect(matches(d, { keywords: ["logging"] }).hit).toBe(false);
  });

  it("matches a conditional document on an applies-to glob", () => {
    const d = doc("mem:a", { load: "conditional", "applies-to": ["src/**/*.ts"] });
    expect(matches(d, { files: ["src/ui/app.ts"] })).toEqual({
      hit: true,
      why: "applies-to:src/**/*.ts",
    });
  });

  it("keeps `*` inside one path segment", () => {
    expect(globToRe("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRe("src/*.ts").test("src/ui/a.ts")).toBe(false);
  });
});

describe("reporting what to load", () => {
  const ctx = { keywords: ["backlog"], files: [], supersededBy: new Map() };

  it("lists a memory document whose trigger matched", () => {
    const d = doc("mem:backlog", {
      load: "conditional",
      triggers: ["backlog"],
      tldr: "Open work.",
    });
    expect(reportLines("Memory to load", [d], ctx).join("\n")).toContain(
      ".claude/memory/mem:backlog.md  (trigger:backlog)  — Open work.",
    );
  });

  it("says (none) when nothing matched", () => {
    const d = doc("mem:other", { load: "conditional", triggers: ["logging"] });
    expect(reportLines("Memory to load", [d], ctx)).toEqual(["Memory to load:", "  (none)"]);
  });

  // A superseded document must never be handed to an agent — otherwise the supersession is a note in an
  // index nobody reads and the agent still acts on a retired decision (ADR-CORE-035).
  it("names the superseding document instead of listing a retired one", () => {
    const old = doc("mem:old", { load: "core" });
    const neu = doc("mem:new", { load: "core", supersedes: ["mem:old"] });
    const lines = reportLines("Memory to load", [old, neu], {
      ...ctx,
      supersededBy: new Map([["mem:old", neu]]),
    }).join("\n");

    expect(lines).toMatch(/mem:old\.md\s+— SUPERSEDED by mem:new/);
    expect(lines).toMatch(/Do NOT load it/);
    expect(lines).toContain("mem:new.md");
  });
});

// The gate demands `triggers`/`applies-to` on every conditional document, memory included
// (scripts/lint-memory.mjs -> validateCommon). That demand is only honest if the resolver actually reads
// them: for a long time it loaded memory solely to resolve supersessions and never reported it, so a
// memory trigger had no consumer anywhere in the system.
describe("the CLI reports every governed kind", () => {
  const run = (...args) =>
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "context-for.mjs"), ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });

  it("prints an ADR, a rule and a memory section", () => {
    const out = run("context");
    expect(out).toContain("ADRs to load:");
    expect(out).toContain("Rules to load:");
    expect(out).toContain("Memory to load:");
  });

  it("lists the core memory an agent must always read", () => {
    expect(run("context")).toMatch(/\.claude\/memory\/project-scope\.md\s+\(core\)/);
  });
});
