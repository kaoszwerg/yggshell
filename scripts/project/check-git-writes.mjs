#!/usr/bin/env node
/**
 * Refuse a writing git subcommand anywhere but the notes module.
 *
 * **What this protects.** YggShell runs `git` inside every project the user has a tab in — status,
 * diff, log, the auto-fetch of ADR-PROJ-002 — and every bit of that is read-only. The notes sync
 * (ADR-PROJ-004) is the first code here that commits and pushes. A write path aimed at the wrong
 * directory would commit and push the maintainer's own work, from a background timer, with nobody
 * asking for it — and it would look like an ordinary line of code doing an ordinary thing.
 *
 * That is exactly the shape `check-no-process-kill.mjs` guards against one file over: a command that
 * is correct almost everywhere and catastrophic in one place. Prose cannot hold it, and a review
 * might not happen; a red build with the reason on it will (`rule:knowledge-handover` §1).
 *
 * It reads the Rust sources as text on purpose. The alternative — a real parser — would be exact
 * about syntax and no better at the question being asked, which is "does a writing subcommand appear
 * outside the one module allowed to have one".
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Subcommands that change a repository. `fetch` and `pull` are deliberately absent: they are reads. */
const WRITING = [
  "commit",
  "push",
  "add",
  "rm",
  "reset",
  "checkout",
  "merge",
  "rebase",
  "cherry-pick",
  "stash",
  "tag",
];

/** The one directory allowed to name them. */
const ALLOWED = join("src", "notes");

const ROOT = process.argv[2] ?? join(process.cwd(), "src-tauri");

function rustFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "target" || entry === "gen") continue;
      out.push(...rustFiles(path));
    } else if (entry.endsWith(".rs")) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Strip comments, and everything from the first test module onwards.
 *
 * Comments, because otherwise the check matches the sentence explaining why the thing is forbidden —
 * the same trap the CSS tests and `environment.rs` both walked into, and a guard that fires on its
 * own documentation gets switched off rather than obeyed.
 *
 * Test modules, because a fixture that builds a repository in a temp directory is not the danger
 * this exists for: the danger is a write reaching a repository the USER has a tab in. Both real
 * matches on the first run were of that kind — a `git remote add` against `tempfile::tempdir()` and
 * an `.expect("commit")` panic message — and a gate that cannot tell them apart from the real thing
 * is a gate somebody deletes.
 */
function code(text) {
  const stripped = text
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
  const tests = stripped.indexOf("\n#[cfg(test)]");
  return tests === -1 ? stripped : stripped.slice(0, tests);
}

/**
 * The lines that are process ARGUMENTS, with everything else blanked out.
 *
 * `.expect("commit")` is a panic message and not a subcommand; a check that cannot tell those apart
 * reports a defect that is not there, and a check that is wrong is a check that gets suppressed
 * (ADR-CORE-039 — a noisy tool lowers the real posture while raising the nominal one). Only the inside
 * of `.arg(…)` and `.args([…])` counts.
 */
function argumentLines(source) {
  const lines = source.split("\n");
  let depth = 0;
  return lines.map((line) => {
    const opens = line.includes(".args(") || line.includes(".arg(");
    const kept = depth > 0 || opens ? line : "";
    if (opens) depth += 1;
    if (depth > 0 && line.includes(")")) depth = Math.max(0, depth - 1);
    return kept;
  });
}

const offences = [];
for (const file of rustFiles(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  if (rel.startsWith(ALLOWED + sep)) continue;
  const source = argumentLines(code(readFileSync(file, "utf8")));
  source.forEach((line, index) => {
    for (const sub of WRITING) {
      // As a quoted argument, which is how every git call in this codebase is written:
      // `.args(["fetch", …])`, `.arg("commit")`.
      if (line.includes(`"${sub}"`)) {
        offences.push({ file: rel, line: index + 1, sub, text: line.trim() });
      }
    }
  });
}

if (offences.length > 0) {
  console.error("check-git-writes FAILED — a writing git subcommand outside src/notes/:\n");
  for (const o of offences) {
    console.error(`  ${o.file}:${o.line}  "${o.sub}"  ${o.text}`);
  }
  console.error(`
This application may WRITE to exactly one repository: the notes clone in its own data directory.
Everything else git-related runs inside a project the user has a tab in, and is read-only — a write
path aimed there would commit and push their actual work from a background timer (ADR-PROJ-004).

If this really is the notes sync, it belongs in src-tauri/src/notes/. If it is not, it must not
exist.`);
  process.exit(1);
}

console.log(`check-git-writes OK — no writing git subcommand outside ${ALLOWED}/.`);
