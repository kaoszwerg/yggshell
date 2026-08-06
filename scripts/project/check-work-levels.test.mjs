import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExpression, checkDeclaration } from "./check-work-levels.mjs";

/**
 * The gate is tested like production code (rule:testing), against a temp fixture rather than the
 * live repository — a gate proven only by "it passes here today" is one nobody has seen fail.
 *
 * **The negative controls carry the weight.** This checker exists because the first
 * `work-levels.json` in this repository violated its own rule and nothing noticed.
 */
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-work-levels.mjs");

function fixture(declaration) {
  const root = mkdtempSync(join(tmpdir(), "ygg-worklevels-"));
  if (declaration !== undefined) {
    writeFileSync(
      join(root, "work-levels.json"),
      typeof declaration === "string" ? declaration : JSON.stringify(declaration),
    );
  }
  return root;
}

function run(root) {
  try {
    return { code: 0, out: execFileSync("node", [SCRIPT, root], { encoding: "utf8" }) };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

describe("the grammar", () => {
  it("accepts the forms the rule defines", () => {
    expect(parseExpression("verify/e2e@dev#core")).toMatchObject({
      act: "verify",
      refinement: "e2e",
      target: "dev",
      area: "core",
    });
    expect(parseExpression("ship/deploy@prod")).toMatchObject({ act: "ship", target: "prod" });
    expect(parseExpression("build")).toMatchObject({ act: "build", target: "local" });
  });

  it("refuses a refinement on an act that takes none", () => {
    // `build/frontend` reads plausibly and is not in the vocabulary. Allowing it would make the
    // second axis mean something different per act, which is how two grammars start.
    expect(parseExpression("build/frontend").error).toMatch(/takes no refinement/);
    expect(parseExpression("probe/deep").error).toMatch(/takes no refinement/);
  });

  it("refuses a verify depth that is not one of the four", () => {
    // `smoke` is the one people reach for. It is not a depth — it is a SHORT run at one of them.
    expect(parseExpression("verify/smoke@dev").error).toMatch(/does not take 'smoke'/);
  });

  it("refuses a ship step that is not one of the five", () => {
    // THE defect this whole checker was written for: `ship/pr@prod` shipped in the first version of
    // this repository's own declaration, and the rule never allowed it.
    expect(parseExpression("ship/pr@prod").error).toMatch(/does not take 'pr'/);
    expect(parseExpression("ship/review@prod")).toMatchObject({
      act: "ship",
      refinement: "review",
    });
  });

  it("refuses an unknown act or target", () => {
    expect(parseExpression("create@local").error).toMatch(/unknown act/);
    expect(parseExpression("verify/unit@production").error).toMatch(/unknown target/);
  });

  it("defaults a missing target to local rather than to nothing", () => {
    expect(parseExpression("verify/unit").target).toBe("local");
  });
});

describe("the declaration", () => {
  it("requires `reaches` for anything that leaves this machine", () => {
    // The one hard requirement of the rule: a level that reaches further than here says where.
    const problems = checkDeclaration({
      entrypoints: [{ run: "deploy", is: "ship/deploy@prod" }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/needs `reaches`/);
  });

  it("accepts a local entry without `reaches`", () => {
    expect(
      checkDeclaration({ entrypoints: [{ run: "npm test", is: "verify/unit@local" }] }),
    ).toEqual([]);
  });

  it("refuses the same command declared twice", () => {
    const problems = checkDeclaration({
      entrypoints: [
        { run: "npm test", is: "verify/unit@local" },
        { run: "npm test", is: "verify/e2e@dev", reaches: "x" },
      ],
    });
    expect(problems.join(" ")).toMatch(/declared twice/);
  });

  it("refuses an area that is not declared", () => {
    const problems = checkDeclaration({
      areas: ["core"],
      entrypoints: [{ run: "npm test", is: "verify/unit@local#billing" }],
    });
    expect(problems.join(" ")).toMatch(/'billing' is not in `areas`/);
  });

  it("names every problem rather than stopping at the first", () => {
    const problems = checkDeclaration({
      entrypoints: [
        { run: "a", is: "nonsense" },
        { run: "b", is: "ship/deploy@prod" },
      ],
    });
    expect(problems).toHaveLength(2);
  });
});

describe("the script", () => {
  it("passes a valid declaration", () => {
    const root = fixture({
      areas: ["core"],
      entrypoints: [
        { run: "npm test", is: "verify/unit@local" },
        { run: "deploy", is: "ship/deploy@prod", reaches: "app.example.com" },
      ],
    });
    const { code, out } = run(root);
    rmSync(root, { recursive: true, force: true });

    expect(code).toBe(0);
    expect(out).toMatch(/2 entrypoints/);
  });

  it("fails an invalid one and prints the grammar", () => {
    const root = fixture({ entrypoints: [{ run: "x", is: "ship/pr@prod", reaches: "y" }] });
    const { code, out } = run(root);
    rmSync(root, { recursive: true, force: true });

    expect(code).toBe(1);
    expect(out).toMatch(/does not take 'pr'/);
    expect(out).toMatch(/act\/refinement@target#area/);
  });

  it("fails on a file that is not JSON, and says so plainly", () => {
    const root = fixture("{ not json");
    const { code, out } = run(root);
    rmSync(root, { recursive: true, force: true });

    expect(code).toBe(1);
    expect(out).toMatch(/not valid JSON/);
  });

  it("passes a project that declares nothing", () => {
    // Not every project has one, and a missing declaration is not a failure — the reader falls back
    // to its heuristic and says it is guessing.
    const root = fixture(undefined);
    const { code } = run(root);
    rmSync(root, { recursive: true, force: true });

    expect(code).toBe(0);
  });

  it("passes this repository's own declaration", () => {
    // The proving ground rule: a convention its author does not live under is one nobody keeps.
    const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
    expect(run(repo).code).toBe(0);
  });
});
