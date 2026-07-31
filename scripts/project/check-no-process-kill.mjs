#!/usr/bin/env node
/**
 * Refuse a committed script that kills processes by name.
 *
 * **The failure this prevents.** YggShell is the maintainer's daily terminal *and* the thing being
 * built — often the terminal an agent session is running inside. A `pkill -f yggshell` in a build or
 * cleanup script does not fail loudly: it takes down every open tab, every running command, and the
 * session that issued it, and nothing is left to report it (rule:live-app).
 *
 * **What it can and cannot catch.** Only committed scripts, and only the obvious spellings. An agent
 * typing `pkill` straight into a shell is not reachable from here — that is what the `load: core`
 * rule is for. This gate exists because the *durable* form of the mistake, the one that would fire
 * again on every machine that ever runs the build, is exactly the form a check can refuse.
 *
 * Killing a PID this process started itself is allowed and unaffected: it is `kill <variable>`, not a
 * name match, and it cannot hit anybody else's app.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The tree to search. An argument rather than always the repo, so the gate can be tested against a
 * fixture instead of against the live checkout (rule:testing) — a gate proven only by "it passes
 * here today" is a gate nobody has seen fail.
 */
const ROOT = process.argv[2] ?? new URL("../..", import.meta.url).pathname;

/** Where a committed script could plausibly live. `node_modules` and build output are not ours. */
const SEARCHED = ["scripts", "src-tauri/src", ".github", "package.json"];

const SKIP_DIRS = new Set(["node_modules", "target", "dist", ".git", "gen"]);

/**
 * Kill-by-name, in the spellings that reach every process matching a pattern.
 *
 * `kill` with a numeric or variable PID is deliberately absent: that is how a script ends a child it
 * started, which is correct and necessary.
 */
const PATTERNS = [
  { re: /\bpkill\b/, what: "pkill" },
  { re: /\bkillall\b/, what: "killall" },
  { re: /\bkill\s+-9\b/, what: "kill -9" },
  { re: /\btaskkill\b/i, what: "taskkill" },
  { re: /Command::new\("pkill"\)/, what: "pkill via Command" },
  { re: /Command::new\("killall"\)/, what: "killall via Command" },
];

/** A line may say why it is exempt, in the one form that is auditable. */
const ALLOW = "allow-process-kill:";

function* files(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* files(full);
    } else if (/\.(mjs|js|ts|sh|zsh|yml|yaml|json|rs)$/.test(entry)) {
      yield full;
    }
  }
}

const findings = [];
for (const target of SEARCHED) {
  const full = join(ROOT, target);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    continue;
  }
  const list = stat.isDirectory() ? files(full) : [full];
  for (const file of list) {
    // The gate and its test both quote the very commands they ban — the gate to match them, the test
    // to prove the matching works. Anything else is fair game; this exemption is exactly two files.
    if (/check-no-process-kill(\.test)?\.mjs$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, index) => {
      if (line.includes(ALLOW)) return;
      for (const { re, what } of PATTERNS) {
        if (re.test(line)) {
          findings.push({ file: relative(ROOT, file), line: index + 1, what, text: line.trim() });
        }
      }
    });
  }
}

if (findings.length > 0) {
  console.error("check-no-process-kill: a committed script kills processes by name.\n");
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.what}`);
    console.error(`      ${f.text}`);
  }
  console.error(
    `
YggShell is the maintainer's daily terminal and often the one an agent session runs inside, so a
kill-by-name takes down their open tabs, their running commands and the session itself — silently
(rule:live-app).

What to do instead:
  - a child this script started    -> keep its PID and kill that PID, never a name
  - a change needs a restart       -> say so; the maintainer restarts it
  - genuinely unavoidable          -> put "${ALLOW} <reason>" on the line, so it is a decision on the
                                      record rather than a line nobody reads
`.trim(),
  );
  process.exit(1);
}

console.log("check-no-process-kill OK — no committed script kills by process name.");
