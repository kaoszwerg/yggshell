import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExpression, checkDeclaration, undeclaredExamples } from "./check-work-levels.mjs";

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

describe("the handover manual", () => {
  it("catches an example the vocabulary no longer has", () => {
    // The manual ships beside the rule and is prose about it. Rename a refinement and a stale
    // example goes on teaching the old one — in somebody else's repository, to an agent with no way
    // to ask which of the two documents is current.
    const stale = undeclaredExamples("run it as `verify/smoke@dev` when you are in a hurry");

    expect(stale).toHaveLength(1);
    expect(stale[0].error).toMatch(/does not take 'smoke'/);
  });

  it("says nothing about a manual whose examples are all current", () => {
    expect(undeclaredExamples("`verify/e2e@dev` and `ship/deploy@prod`")).toEqual([]);
  });

  it("passes the manual this app actually ships", () => {
    // The proving ground again: the file the button hands out, checked as it is.
    const manual = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../src-tauri/resources/adoption/handover.md",
    );
    expect(undeclaredExamples(readFileSync(manual, "utf8"))).toEqual([]);
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

  it("finds the declaration from the placement the rule recommends, with no argument", () => {
    // **The defect the first adopting project reported, and the worst kind there is.** The root
    // used to be derived from this file's own location (`../..`), true only for the layout that
    // wrote it. Placed at `scripts/check-work-levels.mjs` — what the rule recommends — that resolves
    // ABOVE the repository, so the gate found no declaration, printed "nothing to check" and exited
    // 0 while a `@prod` entry with no `reaches` sat unread. A gate that passes silently is worse
    // than no gate.
    const root = fixture({ entrypoints: [{ run: "deploy", is: "ship/deploy@prod" }] });
    mkdirSync(join(root, "scripts"), { recursive: true });
    const placed = join(root, "scripts", "check-work-levels.mjs");
    writeFileSync(placed, readFileSync(SCRIPT, "utf8"));

    let code = 0;
    let out = "";
    try {
      out = execFileSync("node", [placed], { encoding: "utf8", cwd: root });
    } catch (error) {
      code = error.status ?? 1;
      out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
    rmSync(root, { recursive: true, force: true });

    expect(code).toBe(1);
    expect(out).toMatch(/needs `reaches`/);
  });

  it("passes a project that declares nothing", () => {
    // Not every project has one, and a missing declaration is not a failure — the reader falls back
    // to its heuristic and says it is guessing.
    const root = fixture(undefined);
    const { code } = run(root);
    rmSync(root, { recursive: true, force: true });

    expect(code).toBe(0);
  });

  it("names a runnable package script that nobody declared", () => {
    // **How the file stays current, as a mechanism rather than a hope.** The rule promised this
    // check in its own text long before it existed — and a rule that advertises a gate nobody built
    // is worse than one that admits the gap, because everybody assumes the gap is covered
    // (rule:knowledge-handover §1). A declaration rots the day somebody adds a script; this is what
    // notices.
    const root = fixture({
      version: 1,
      entrypoints: [{ run: "npm run test", is: "verify/unit@local" }],
    });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest run", "test:e2e": "playwright test", dev: "vite" },
      }),
    );
    const { code, out } = run(root);
    rmSync(root, { recursive: true, force: true });

    expect(code).toBe(1);
    expect(out).toMatch(/test:e2e/);
    // `dev` is not a level of work — a completeness check that flagged everything would be
    // suppressed within a week (ADR-CORE-039: a noisy tool lowers the real posture). Matched on the
    // whole sentence, not on the bare word: the failure output also prints the target list, which
    // contains `dev`, and asserting on the word passed for the wrong reason.
    expect(out).not.toMatch(/`npm run dev` is a level of work/);
  });

  it("does not count a script as declared because its name appears inside another", () => {
    // Declaring `npm run test:e2e` used to satisfy a script called `test`, because the check asked
    // whether the name appeared anywhere in the joined run strings. Reported by the first adopting
    // project — a false negative in the check whose job is finding what is missing.
    const root = fixture({
      version: 1,
      entrypoints: [{ run: "npm run test:e2e", is: "verify/e2e@local" }],
    });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", "test:e2e": "playwright test" } }),
    );
    const { code, out } = run(root);
    rmSync(root, { recursive: true, force: true });

    expect(code).toBe(1);
    expect(out).toMatch(/`npm run test` is a level of work/);
  });

  it("reads the package.json files the declaration points at, not only the root one", () => {
    // **A monorepo has no root package.json**, so the completeness half reported nothing at all in
    // the first project to adopt this — its level-shaped scripts live in three sub-packages. Asked
    // for twice; it deletes about half of that project's wrapper.
    const root = fixture({
      version: 1,
      scriptSources: ["core/frontend/package.json"],
      entrypoints: [{ run: "npm run test", is: "verify/unit@local" }],
    });
    mkdirSync(join(root, "core/frontend"), { recursive: true });
    writeFileSync(
      join(root, "core/frontend/package.json"),
      JSON.stringify({ scripts: { test: "vitest run", "test:e2e": "playwright test" } }),
    );
    const { code, out } = run(root);
    rmSync(root, { recursive: true, force: true });

    expect(code).toBe(1);
    expect(out).toMatch(/test:e2e/);
  });

  it("asks for the runners the project says must be named", () => {
    // A prefix list cannot request `scripts/run-tests.sh` — it begins with "run". It is the central
    // entrypoint of the first adopting project, and the one an outside reader most needs named.
    const root = fixture({
      version: 1,
      requiredRunners: ["scripts/run-tests.sh", "./heimdal"],
      entrypoints: [{ run: "bash scripts/run-tests.sh e2e", is: "verify/e2e@local" }],
    });
    const { code, out } = run(root);
    rmSync(root, { recursive: true, force: true });

    expect(code).toBe(1);
    expect(out).toMatch(/`\.\/heimdal` is listed in `requiredRunners`/);
    // The one that IS declared, under a longer command, is not demanded again.
    expect(out).not.toMatch(/`scripts\/run-tests\.sh` is listed/);
  });

  it("says nothing about a package script that is not a level of work", () => {
    const root = fixture({ version: 1, entrypoints: [] });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", start: "node .", prepare: "husky" } }),
    );
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
