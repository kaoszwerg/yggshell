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
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] ?? new URL("../..", import.meta.url).pathname;

/** The five acts. Exhaustive by construction (rule:work-legibility). */
const ACTS = ["plan", "build", "verify", "ship", "probe"];

/**
 * The refinements each act may carry.
 *
 * `verify` takes a **depth** — how far the check reaches. `ship` takes a **step** — where the work
 * is being put. The other three take none: there is no meaningful second axis for deciding, making
 * or looking.
 */
const REFINEMENTS = {
  verify: ["unit", "integration", "e2e", "audit"],
  ship: ["commit", "push", "review", "deploy", "release"],
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
  console.log(
    `check-work-levels OK — ${declaration.entrypoints.length} entrypoints, grammar valid.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  process.exit(main());
}
