#!/usr/bin/env node
// Deterministically resolve which ADRs/rules/memory an agent should load for a task (ADR-CORE-006).
// Usage: node scripts/context-for.mjs "<keywords>" [file ...]
//   - always lists load:core docs
//   - lists conditional docs whose triggers match a keyword OR whose applies-to glob matches a file
//   - NEVER lists a superseded doc — it names what replaced it instead (ADR-CORE-035)
//
// All three governed kinds are reported, memory included. The gate rejects a `conditional` document that
// declares neither `triggers` nor `applies-to` as unreachable (scripts/lib/governance.mjs), and it applies
// that rule to memory too — so this is the tool that has to make those triggers mean something. For a
// while it did not: memory was loaded here only to resolve supersessions and never reported, which left
// every memory trigger in the system without a consumer.
//
// Exported for its tests (scripts/context-for.test.mjs); the CLI runs only when invoked directly.
import { pathToFileURL } from "node:url";
import { loadAdrs, loadMemory, loadRules, resolveSupersessions } from "./lib/governance.mjs";

/** Minimal glob matcher: supports `**` (any depth) and `*` (one path segment). */
export function globToRe(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      out += ".*";
      i++;
    } else if (c === "*") {
      out += "[^/]*";
    } else if (".+^${}()|[]\\".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp("^" + out + "$");
}

/** Does this document belong in the task's context? Returns `{ hit, why }` — `why` names the reason. */
export function matches(doc, { keywords = [], files = [] } = {}) {
  if (doc.data.load === "core") return { hit: true, why: "core" };
  if (doc.data.load === "archival") return { hit: false };
  const triggers = (doc.data.triggers ?? []).map((t) => String(t).toLowerCase());
  const hitKw = keywords.find((k) => triggers.includes(k));
  if (hitKw) return { hit: true, why: `trigger:${hitKw}` };
  const globs = doc.data["applies-to"] ?? [];
  for (const g of globs) {
    const re = globToRe(g);
    const f = files.find((file) => re.test(file));
    if (f) return { hit: true, why: `applies-to:${g}` };
  }
  return { hit: false };
}

/** One report section as lines. Pure — the CLI prints them, the tests assert on them. */
export function reportLines(label, docs, { keywords, files, supersededBy }) {
  const lines = [`${label}:`];
  for (const d of docs) {
    const m = matches(d, { keywords, files });
    if (!m.hit) continue;
    const by = supersededBy.get(String(d.data.id));
    if (by) {
      lines.push(
        `  ${d.rel}  — SUPERSEDED by ${by.data.id} (${by.rel}). Do NOT load it; load that one instead.`,
      );
      continue;
    }
    lines.push(`  ${d.rel}  (${m.why})  — ${d.data.tldr}`);
  }
  if (lines.length === 1) lines.push("  (none)");
  return lines;
}

function main(argv) {
  const keywordArg = (argv[0] ?? "").toLowerCase();
  const keywords = keywordArg.split(/[\s,]+/).filter(Boolean);
  const files = argv.slice(1);

  const adrs = loadAdrs();
  const rules = loadRules();
  const memos = loadMemory();
  // A superseded document must not be loaded — otherwise the supersession is a note in an index nobody
  // reads, and the agent still acts on a decision the project has retired (ADR-CORE-035). This is the one
  // place that decides what an agent actually reads, so this is where it has to be true.
  const supersededBy = resolveSupersessions([...adrs, ...rules, ...memos]);
  const ctx = { keywords, files, supersededBy };

  console.log(`context-for: keywords=[${keywords.join(", ")}] files=[${files.join(", ")}]`);
  for (const [label, docs] of [
    ["ADRs to load", adrs],
    ["Rules to load", rules],
    ["Memory to load", memos],
  ]) {
    console.log("\n" + reportLines(label, docs, ctx).join("\n"));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
