/**
 * The gate that guards every commit gets the same treatment as production code (rule:testing): it
 * runs against a temporary fixture, never against the live repository — where "it passed today"
 * proves nothing about whether it can fail at all.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Not `new URL(..., import.meta.url)`: under Vitest `import.meta.url` is a Vite-served path, so
// `.pathname` comes out as "/scripts/project/…" and Node cannot find it. Vitest runs at the repo root.
const GATE = join(process.cwd(), "scripts/project/check-no-process-kill.mjs");

/** Build a fake repo with `scripts/<name>` in it and run the gate over it. */
function runAgainst(name, contents) {
  const root = mkdtempSync(join(tmpdir(), "kill-gate-"));
  try {
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", name), contents);
    try {
      // stderr piped, not inherited: this test deliberately runs the gate against a violation, and
      // its (correct) complaint would otherwise be printed into a green test run as if something
      // had gone wrong.
      const stdout = execFileSync("node", [GATE, root], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, output: stdout };
    } catch (error) {
      return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("check-no-process-kill", () => {
  it("passes a script that kills nothing", () => {
    expect(runAgainst("build.mjs", "console.log('hello')").ok).toBe(true);
  });

  for (const [label, line] of [
    ["pkill", 'execSync("pkill -f yggshell")'],
    ["killall", 'execSync("killall YggShell")'],
    ["kill -9", 'execSync("kill -9 $(pgrep yggshell)")'],
    ["taskkill", 'execSync("taskkill /IM yggshell.exe")'],
    ["Rust pkill", 'Command::new("pkill").arg("yggshell")'],
  ]) {
    it(`refuses ${label}`, () => {
      const result = runAgainst("build.mjs", line);
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/kills processes by name/);
    });
  }

  it("allows killing a PID the script itself owns", () => {
    // The legitimate case, and the one a blunt ban on the word "kill" would have broken: ending a
    // child you started cannot reach anybody else's application.
    const result = runAgainst("build.mjs", "child.kill();\nprocess.kill(pid, 'SIGTERM');");
    expect(result.ok).toBe(true);
  });

  it("names the rule and the alternatives when it refuses", () => {
    // A gate that only says "no" teaches nothing, and the next agent works around it instead
    // (rule:knowledge-handover §1).
    const result = runAgainst("build.mjs", 'execSync("pkill -f yggshell")');
    expect(result.output).toMatch(/rule:live-app/);
    expect(result.output).toMatch(/kill that PID, never a name/);
  });

  it("takes an explicit exemption, so an unavoidable case is on the record", () => {
    const result = runAgainst(
      "build.mjs",
      'execSync("pkill -f test-fixture"); // allow-process-kill: fixture we started, no app of ours matches',
    );
    expect(result.ok).toBe(true);
  });

  it("reports the file and the line, not just that something is wrong", () => {
    const result = runAgainst("build.mjs", "// a comment\n// another\nexecSync('killall x')");
    expect(result.output).toMatch(/scripts\/build\.mjs:3/);
  });
});

describe("the gate does not trip over itself", () => {
  it("skips its own source and its own test, and nothing else", () => {
    // Both files quote the banned commands by necessity — one to match them, one to prove the
    // matching works. This pins the exemption to exactly those two, so a future "let's skip tests"
    // shortcut cannot widen it into a blind spot.
    const root = mkdtempSync(join(tmpdir(), "kill-gate-self-"));
    try {
      mkdirSync(join(root, "scripts", "project"), { recursive: true });
      for (const name of ["check-no-process-kill.mjs", "check-no-process-kill.test.mjs"]) {
        writeFileSync(join(root, "scripts", "project", name), 'execSync("pkill -f x")');
      }
      // A neighbour whose name merely resembles them is NOT exempt.
      writeFileSync(
        join(root, "scripts", "project", "check-no-process-kill-helper.mjs"),
        'execSync("pkill -f x")',
      );

      let output = "";
      try {
        execFileSync("node", [GATE, root], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        throw new Error("the gate should have refused the helper");
      } catch (error) {
        output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      }

      expect(output).toMatch(/check-no-process-kill-helper\.mjs/);
      expect(output).not.toMatch(/check-no-process-kill\.mjs:/);
      expect(output).not.toMatch(/check-no-process-kill\.test\.mjs:/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
