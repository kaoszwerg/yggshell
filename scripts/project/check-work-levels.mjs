#!/usr/bin/env node
/**
 * Hold `work-levels.json` to the grammar `rule:work-legibility` defines.
 *
 * **Why this exists at all.** Every other declaration file in this repository's root has a checker —
 * `crash-boundaries.json` has `crash-gate.mjs`, `ui-boundary.json` has `ui-boundary.mjs`,
 * `security-posture.json` has `security-posture-gate.mjs`. This one did not, and it cost something
 * immediately: the first version of the file used `ship/pr@prod` and `ship/release@local`, which the
 * rule as written did not allow, and nobody noticed until a reviewer read both documents side by
 * side. A grammar whose own example file violates it is not a grammar.
 *
 * **What it cannot check** is whether a label is *true* — a run declared `unit` that quietly reaches
 * a database is a lie no parser can see. That is the rule's business and the reader's caution
 * (ADR-PROJ-005 §4: the declaration may name and escalate, never reassure).
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The revision of `rule:work-legibility` this script was shipped alongside.
 *
 * **It exists because the rule's own staleness cannot be detected, and the script's can.** An
 * adopting repository holds two things from us: this file, whose bytes are compared against the
 * shipped copy on every poll (`adoption::gate_stale`) so a newer one is *offered*, and the rule text,
 * which goes through the clipboard into their governance under a name we never learn. There is
 * nothing to compare, so a rule that changes reaches nobody.
 *
 * Measured, 2026-08-08: the matching contract — the words a `run` is compared on — was written into
 * the rule and this script was not touched. `gate_stale` stayed false, no offer appeared, and the one
 * project that had adopted the convention would never have learned that the answer to its own bug
 * report was now written down. A person had to send an email.
 *
 * So the undetectable is chained to the detectable: the stamp is the rule's content hash, it is
 * printed on every run, and `ruleStampProblem` below fails the gate **in the repository that ships
 * the rule** whenever the two drift. Changing the rule therefore changes this file, which makes every
 * adopter's copy stale, which raises the offer, which delivers a script whose printed stamp says the
 * rule moved too.
 *
 * The price, stated: touching the rule now always means touching this file. That is the discipline
 * that was missing, made mechanical instead of remembered.
 */
export const RULE_STAMP = "005408ac23b494b1";

/** The rule's content hash, in the form [`RULE_STAMP`] carries. */
export function stampOf(ruleText) {
  return createHash("sha256").update(ruleText, "utf8").digest("hex").slice(0, 16);
}

/**
 * The complaint when this script and the rule it ships beside have drifted, or `null`.
 *
 * **Only in the repository that publishes them.** An adopter may perfectly well keep the rule at the
 * same path under their own governance, and their copy is *theirs* — it may be edited, extended or
 * superseded. Comparing it against our stamp would fail their gate for doing exactly what the rule
 * invites. The marker is the resource the publisher ships and nobody else has.
 */
export function ruleStampProblem(root, { stamp = RULE_STAMP } = {}) {
  const publishes = join(root, "src-tauri/resources/adoption/handover.md");
  const rule = join(root, ".claude/rules/project/work-legibility.md");
  if (!existsSync(publishes) || !existsSync(rule)) return null;
  const actual = stampOf(readFileSync(rule, "utf8"));
  if (actual === stamp) return null;
  return (
    `the rule changed and this script did not: RULE_STAMP is \`${stamp}\`, the rule hashes to ` +
    `\`${actual}\`. Set RULE_STAMP to that value — an adopting repository learns a rule has moved ` +
    `ONLY because this file's bytes changed, so a rule edit that leaves it alone reaches nobody`
  );
}

/**
 * The complaint when the *adopting* repository's own copy of the rule is behind this script, or
 * `null`.
 *
 * **The half that was missing, found by measuring the first adopter an hour after shipping the
 * stamp.** The stamp was printed on every run, and the chain was supposed to be: rule changes →
 * script changes → the app offers a newer script → the printed number moves → the reader re-copies
 * the rule. Measured in `kaoszwerg/mot`: the project had **already taken the current script** and an
 * **older rule**, so nothing was stale, no offer appeared, and the two halves of the evidence sat in
 * their own repository with nothing comparing them. A number only says something to somebody who saw
 * the previous one — which a first-time adopter never did.
 *
 * So a project may point at its own copy and have it checked:
 *
 * ```json
 * { "rule": ".claude/rules/project/work-legibility.md", "entrypoints": [ … ] }
 * ```
 *
 * **Opt-in, and it must stay that way.** The rule invites a project to extend or supersede it, and a
 * check that failed on an edited copy would punish exactly that. Naming the path is a project saying
 * *"keep mine verbatim and tell me when yours moves"* — which is a different promise, and theirs to
 * make.
 */
export function adoptedRuleProblem(root, declaration, { stamp = RULE_STAMP } = {}) {
  const declared = declaration?.rule;
  if (typeof declared !== "string" || declared.trim() === "") return null;
  const path = join(root, declared);
  if (!existsSync(path)) {
    return `\`rule\` names \`${declared}\`, and there is no such file — a pointer to nothing checks nothing`;
  }
  const actual = stampOf(readFileSync(path, "utf8"));
  if (actual === stamp) return null;
  return (
    `the copy of rule:work-legibility at \`${declared}\` is not the one this check ships beside: ` +
    `it hashes to \`${actual}\`, the shipped rule to \`${stamp}\`. Take the rule again from the ` +
    `Chain tool — or drop the \`rule\` field if this copy is deliberately your own`
  );
}

/**
 * The repository this is checking.
 *
 * **Found by walking up, never derived from where this file happens to sit.** It used to be
 * `new URL("../..", import.meta.url)` — two levels above the script — which is true only for the
 * layout of the project that wrote it. At the placement the rule itself recommends
 * (`scripts/check-work-levels.mjs`, one level) that resolves *above* the repository, finds no
 * declaration, prints "nothing to check" and exits 0. Reported by the first project to adopt it:
 * a gate that passes silently is worse than no gate, and this one passed a `@prod` entry with no
 * `reaches` — the single thing it exists to refuse.
 *
 * It was also `.pathname` on a `file://` URL, which is not a filesystem path: on Windows that yields
 * `/C:/…`, and a space in a path stays percent-escaped. The walk below takes real paths only, so the
 * question no longer arises.
 */
function repositoryRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "work-levels.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

const ROOT = process.argv[2] ?? repositoryRoot(process.cwd());

/** The seven acts (rule:work-legibility). */
const ACTS = ["plan", "edit", "build", "verify", "subagent", "ship", "probe"];

/**
 * The refinements each act may carry.
 *
 * `verify` takes a **depth** — how far the check reaches. `ship` takes a **step** — where the work
 * is being put. The others take none: there is no meaningful second axis for deciding, editing,
 * building, handing on, or looking.
 */
const REFINEMENTS = {
  verify: ["unit", "integration", "e2e", "audit"],
  ship: ["commit", "push", "review", "merge", "deploy", "release"],
};

/** Ascending reach. Anything above `local` must say where it goes. */
const TARGETS = ["local", "dev", "staging", "prod"];

/** Parse `act/refinement@target#area` into its parts, or explain why it is not one. */
export function parseExpression(expression) {
  if (typeof expression !== "string" || expression.length === 0) {
    return { error: "must be a non-empty string" };
  }
  const [beforeArea, ...areaRest] = expression.split("#");
  if (areaRest.length > 1) return { error: "more than one '#'" };
  const [beforeTarget, ...targetRest] = beforeArea.split("@");
  if (targetRest.length > 1) return { error: "more than one '@'" };
  const [act, ...refinementRest] = beforeTarget.split("/");
  if (refinementRest.length > 1) return { error: "more than one '/'" };

  const refinement = refinementRest[0];
  const target = targetRest[0] ?? "local";
  const area = areaRest[0];

  if (!ACTS.includes(act)) {
    return { error: `unknown act '${act}' — expected one of ${ACTS.join(", ")}` };
  }
  if (refinement !== undefined) {
    const allowed = REFINEMENTS[act];
    if (allowed === undefined) {
      return { error: `act '${act}' takes no refinement, but got '${refinement}'` };
    }
    if (!allowed.includes(refinement)) {
      return { error: `'${act}' does not take '${refinement}' — expected ${allowed.join(", ")}` };
    }
  }
  if (!TARGETS.includes(target)) {
    return { error: `unknown target '${target}' — expected one of ${TARGETS.join(", ")}` };
  }
  return { act, refinement, target, area };
}

/** Every problem with one declaration, as human sentences. */
export function checkDeclaration(declaration, { areas = null } = {}) {
  const problems = [];
  if (declaration === null || typeof declaration !== "object") {
    return ["work-levels.json must be an object"];
  }
  const entries = declaration.entrypoints;
  if (!Array.isArray(entries)) {
    return ["work-levels.json needs an `entrypoints` array"];
  }
  const declaredAreas = areas ?? declaration.areas ?? null;

  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const where = `entrypoints[${index}]`;
    if (typeof entry?.run !== "string" || entry.run.length === 0) {
      problems.push(`${where}: needs a \`run\``);
      continue;
    }
    if (seen.has(entry.run)) {
      problems.push(`${where}: '${entry.run}' is declared twice`);
    }
    seen.add(entry.run);

    const parsed = parseExpression(entry.is);
    if (parsed.error) {
      problems.push(`${where} (${entry.run}): ${parsed.error}`);
      continue;
    }
    // The rule's one hard requirement: anything leaving this machine says where it goes.
    if (parsed.target !== "local" && !entry.reaches) {
      problems.push(
        `${where} (${entry.run}): target '${parsed.target}' needs \`reaches\` — ` +
          `"am I about to hit production?" must be answerable without reading three files`,
      );
    }
    if (parsed.area && Array.isArray(declaredAreas) && !declaredAreas.includes(parsed.area)) {
      problems.push(`${where} (${entry.run}): area '${parsed.area}' is not in \`areas\``);
    }
  }
  return problems;
}

/**
 * Script names that are a **level of work** rather than a way to start the product.
 *
 * Deliberately narrow. A completeness check that flagged `dev`, `start` and `prepare` would be
 * suppressed inside a week, and a suppressed check lowers the real posture while raising the nominal
 * one (ADR-CORE-039). These prefixes are the ones whose absence from the declaration actually costs
 * something: a run whose reach nobody wrote down.
 */
const LEVEL_SHAPED = /^(test|e2e|verify|check|lint|audit|security|deploy|release|ship)\b/;

/**
 * Package scripts that look like a level of work and appear in no entry's `run`.
 *
 * **This is how the declaration stays current.** Everything else here checks what is written; this
 * checks what is missing — the failure mode a declaration actually has, which is not being wrong but
 * being from March. Only `package.json` is read: it is declarative and machine-readable, so there
 * are no false positives from guessing at files. A project whose runs live in a Makefile or a
 * `scripts/` directory is not covered, and that is honest — the rule says so rather than pretending.
 */
export function undeclaredScripts(declaration, scripts) {
  // **Whole words, not a substring of everything concatenated.** It used to join every `run` into
  // one string and ask whether the script's name appeared anywhere in it — so declaring
  // `npm run test:e2e` made a script called `test` count as declared, and a repository could satisfy
  // this check without declaring the entrypoint it actually runs. A false negative in the one check
  // whose whole job is finding what is missing.
  const declared = new Set(
    (declaration?.entrypoints ?? []).flatMap((entry) =>
      typeof entry?.run === "string" ? entry.run.split(/[\s/=]+/) : [],
    ),
  );
  return Object.keys(scripts ?? {})
    .filter((name) => LEVEL_SHAPED.test(name))
    .filter((name) => !declared.has(name));
}

/**
 * The manual YggShell hands to a foreign agent, checked against the grammar it describes.
 *
 * **This is the anti-drift the two documents need.** The manual is prose about the rule and ships
 * separately from it; add an act to the vocabulary or rename a refinement, and a stale example in
 * the manual would go on teaching the old one — in somebody else's repository, to an agent with no
 * way to ask. Every `act/refinement@target` it prints must parse, or the vocabulary moved and the
 * manual did not.
 */
export function undeclaredExamples(manual) {
  const expressions = manual.match(/\b[a-z]+\/[a-z]+@[a-z]+\b/g) ?? [];
  return [...new Set(expressions)]
    .map((expression) => ({ expression, ...parseExpression(expression) }))
    .filter((checked) => checked.error);
}

/**
 * Every `package.json` whose scripts count, as the declaration says.
 *
 * **`scriptSources` exists because a monorepo has no root `package.json`.** Reading only the root
 * one made the completeness half — the important half, by this file's own description — report
 * nothing at all in the first project to adopt this: its level-shaped scripts live in three
 * sub-packages. Asked for twice, and it deletes about half of that project's wrapper.
 */
function packageScripts(root, declaration) {
  const sources = Array.isArray(declaration?.scriptSources)
    ? declaration.scriptSources
    : ["package.json"];
  const scripts = {};
  for (const source of sources.slice(0, 64)) {
    if (typeof source !== "string") continue;
    const path = join(root, source);
    if (!existsSync(path)) continue;
    try {
      Object.assign(scripts, JSON.parse(readFileSync(path, "utf8")).scripts ?? {});
    } catch {
      // Not this gate's business to report — the project's own tooling will.
    }
  }
  return scripts;
}

/**
 * Runners the project says must be declared, whatever they are called.
 *
 * **Because a prefix list cannot ask for `scripts/run-tests.sh`.** That is the central entrypoint of
 * the first adopting project — all four verify depths go through it, and calling the underlying
 * runners directly is forbidden there — and it begins with `run`, so `LEVEL_SHAPED` will never
 * request it. Lengthening the prefix list is a race against every project's naming; letting the
 * project name its own is not.
 */
export function missingRunners(declaration) {
  const required = Array.isArray(declaration?.requiredRunners) ? declaration.requiredRunners : [];
  const declared = (declaration?.entrypoints ?? [])
    .map((entry) => (typeof entry?.run === "string" ? entry.run : ""))
    .join("\n");
  return required
    .filter((runner) => typeof runner === "string" && runner.length > 0)
    .filter((runner) => !declared.includes(runner));
}

function main() {
  const path = join(ROOT, "work-levels.json");
  if (!existsSync(path)) {
    // Not every project declares one, and a missing declaration is not a failure — the chain reader
    // falls back to its heuristic and says it is guessing.
    console.log("check-work-levels: no work-levels.json — nothing to check.");
    return 0;
  }
  let declaration;
  try {
    declaration = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(
      `check-work-levels FAILED — work-levels.json is not valid JSON:\n  ${error.message}`,
    );
    return 1;
  }
  const problems = checkDeclaration(declaration);
  for (const runner of missingRunners(declaration)) {
    problems.push(
      `\`${runner}\` is listed in \`requiredRunners\` and declared nowhere — ` +
        `the project itself says this one has to be named`,
    );
  }
  for (const name of undeclaredScripts(declaration, packageScripts(ROOT, declaration))) {
    problems.push(
      `\`npm run ${name}\` is a level of work and is declared nowhere — ` +
        `add it to work-levels.json, or rename it if it is not one`,
    );
  }
  const manual = join(ROOT, "src-tauri/resources/adoption/handover.md");
  if (existsSync(manual)) {
    for (const stale of undeclaredExamples(readFileSync(manual, "utf8"))) {
      problems.push(
        `the handover manual teaches '${stale.expression}': ${stale.error} — ` +
          `the vocabulary moved and the manual did not`,
      );
    }
  }
  const drift = ruleStampProblem(ROOT);
  if (drift !== null) problems.push(drift);
  const adopted = adoptedRuleProblem(ROOT, declaration);
  if (adopted !== null) problems.push(adopted);
  if (problems.length > 0) {
    console.error("check-work-levels FAILED:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "\n  The grammar is act/refinement@target#area (rule:work-legibility):\n" +
        `    acts        ${ACTS.join(" ")}\n` +
        `    verify/…    ${REFINEMENTS.verify.join(" ")}\n` +
        `    ship/…      ${REFINEMENTS.ship.join(" ")}\n` +
        `    @targets    ${TARGETS.join(" ")}  (anything but local needs \`reaches\`)`,
    );
    return 1;
  }
  // **The stamp is printed on every run, not only when something is wrong.** It is the one line an
  // adopting repository sees regularly, and it is how they learn the rule text moved: the number
  // changes when they update this script, and the rule they hold is then the older one.
  console.log(
    `check-work-levels OK — ${declaration.entrypoints.length} entrypoints, grammar valid. ` +
      `(rule:work-legibility @ ${RULE_STAMP} — if this changed, copy the rule again)`,
  );
  return 0;
}

// **Compared whole, and through symlinks.** The old form split on `/` (wrong separator on Windows)
// and matched any script with the same file name — so a project's own wrapper called
// `check-work-levels-<project>.mjs` could make this module run `main()` merely by importing it.
// Adopting by wrapping is a supported path (a delivered file cannot hold local adaptation), so the
// import must be inert by construction rather than by luck of naming.
//
// `realpathSync` on both sides is not belt-and-braces: `import.meta.url` is already resolved while
// `process.argv[1]` is whatever was typed, so on macOS — where `/tmp` and `/var` are symlinks — the
// two never matched and the script did nothing at all. Its own test caught that within a minute.
const invokedAs = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (invokedAs && realpathSync(fileURLToPath(import.meta.url)) === invokedAs) {
  process.exit(main());
}
