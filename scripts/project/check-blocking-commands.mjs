#!/usr/bin/env node
/**
 * Refuse a `#[tauri::command]` that blocks the main thread.
 *
 * ## The defect this exists for, measured
 *
 * **Tauri runs a synchronous command on the main thread.** Only an `async fn` reaches the async
 * runtime. So a sync command that shells out holds the thread that also serves window events, IPC and
 * — indirectly — painting, for as long as the child process takes.
 *
 * `agent_usage` did exactly that: it runs `claude -p /usage`, measured at **1443–1629 ms**. The
 * symptom appeared somewhere else entirely — opening the Agent tool took **1562–1591 ms** to show its
 * first frame, while React rendered it in about **one millisecond**. Nobody looking at a slow panel
 * would have suspected a missing `async` keyword three layers down, and `rule:rust-conventions`
 * already said not to do it ("anything that blocks for more than a moment runs inside
 * `spawn_blocking`; never block the async runtime"). A rule nobody can see being broken is a comment.
 *
 * ## What it checks
 *
 * Each `#[tauri::command]` is followed to the modules it calls. A command that (directly, or through
 * one of the modules listed in SPAWNERS) starts a child process must be `async fn`. Anything else
 * fails the build, naming the command and what it starts.
 *
 * ## Why a list of modules rather than a call graph
 *
 * A real call graph in Rust needs a compiler front-end; this needs to run in `check:all` in
 * milliseconds. The list is the honest approximation: it is short, it is checked against reality by
 * the same regex that finds `Command::new`, and a module that starts spawning without being listed is
 * caught by the direct check anyway. Adding a spawner means adding a line here — which is the moment
 * to ask whether the command should be async.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO = resolve(new URL("../..", import.meta.url).pathname);
const SRC = resolve(REPO, "src-tauri/src");

/** Every `.rs` file under src-tauri/src. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (entry.endsWith(".rs")) out.push(path);
  }
  return out;
}

const files = sources(SRC);

/**
 * The **functions** that start a child process, discovered rather than declared.
 *
 * Function granularity, not module — two earlier versions got this wrong and both were unusable.
 * Matching a module's parent (`agent` for `agent::usage`) flagged every command that touched anything
 * under it. Matching the module itself was still too coarse: `crash.rs` spawns in its message box but
 * not in `write_report`, and `files/mod.rs` spawns in `reveal` but not in `list`. A check that is
 * wrong half the time gets switched off (ADR-CORE-039) — precision here is what keeps the gate alive.
 */
const SPAWNERS = new Set();
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("Command::new")) continue;
  const mod = file
    .slice(SRC.length + 1)
    .replace(/\/mod\.rs$/, "")
    .replace(/\.rs$/, "")
    .replace(/\//g, "::");
  // Split on top-level `fn` definitions and keep the ones whose body spawns.
  const parts = src.split(/\n(?=(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s)/);
  for (const part of parts) {
    const name = part.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (name && part.includes("Command::new")) SPAWNERS.add(`${mod}::${name[1]}`);
  }
}

/**
 * Commands deliberately left synchronous, each with the reason.
 *
 * **This list is the escape hatch, and it is meant to be read, not grown.** A sync command that
 * spawns is only acceptable when the child is bounded and short — tens of milliseconds — so that
 * holding the main thread is not observable. Anything that talks to a network, a package manager, or
 * a daemon that samples over time does not qualify, whatever it looks like today.
 */
const ALLOWED_SYNC = new Map([
  ["terminal_status", "two `tmux display-message` calls, measured at 8.9 ms each"],
  [
    "list_containers",
    "one `docker ps`, tens of milliseconds; the slow one (`docker stats`) is async",
  ],
  ["container_logs", "one bounded `docker logs`, capped at 200 lines"],
  [
    "reveal_in_file_manager",
    "hands the path to the OS file manager and returns; does not wait for it",
  ],
  ["open_external", "hands the URL to the default handler and returns"],
  ["install_cli", "copies two small files; `which` results are cached"],
  ["cli_status", "reads a path; `which` results are cached"],
  ["system_load", "reads the kernel's load average, no child process"],
  ["bundled_credits", "returns a string embedded at compile time"],
  ["changelog", "returns a string embedded at compile time"],
]);

const COMMAND =
  /#\[tauri::command\]\s*\n(?:\s*#\[[^\]]*\]\s*\n)*\s*(?:pub\s+)?(async\s+)?fn\s+(\w+)/g;

const problems = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const match of src.matchAll(COMMAND)) {
    const isAsync = Boolean(match[1]);
    const name = match[2];
    if (isAsync || ALLOWED_SYNC.has(name)) continue;

    // The body only, not "the next 3000 characters" — that reached into neighbouring functions and
    // blamed commands for calls they do not make. Cut at the next command attribute.
    const after = src.slice(match.index + match[0].length);
    const next = after.indexOf("#[tauri::command]");
    const body = next === -1 ? after : after.slice(0, next);
    const direct = body.includes("Command::new");
    const viaModule = [...SPAWNERS].filter((fn) => {
      // `crate::agent::usage::read` — or the same call written relative, e.g. `usage::read` inside
      // the agent module itself.
      const short = fn.split("::").slice(-2).join("::");
      return body.includes(`crate::${fn}`) || body.includes(`${short}(`);
    });
    if (!direct && viaModule.length === 0) continue;

    problems.push(
      `${name} (${file.slice(REPO.length + 1)})\n` +
        `      starts a child process ${direct ? "directly" : `via ${viaModule.join(", ")}`}, but is not \`async\`.\n` +
        `      Tauri runs a sync command on the MAIN thread, so it blocks window events and IPC for as\n` +
        `      long as the child runs. Make it \`pub async fn\` and wrap the work in\n` +
        `      \`tauri::async_runtime::spawn_blocking(...)\` — see \`agent_usage\` for the shape.\n` +
        `      If the child really is bounded and short, add it to ALLOWED_SYNC in this script WITH the\n` +
        `      measurement that says so.`,
    );
  }
}

if (problems.length > 0) {
  console.error("check-blocking-commands FAILED\n");
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}

console.log(
  `check-blocking-commands OK — no synchronous command starts a process ` +
    `(${ALLOWED_SYNC.size} short ones allowed by name, ${SPAWNERS.size} spawning modules known).`,
);
