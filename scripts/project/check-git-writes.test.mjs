import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The gate that guards every commit is tested like production code (`rule:testing`) — and against a
 * temp fixture, never the live repository, so a test can never be the thing that decides whether the
 * real tree passes.
 *
 * **The negative control is the point.** A guard that has never been seen to fire is a guard nobody
 * knows still works; two of this one's checks were only shown to be right by watching them reject
 * something they were supposed to reject.
 */
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-git-writes.mjs");

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "ygg-gitwrite-"));
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

function run(root) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, root], { encoding: "utf8" });
    return { ok: true, out: stdout };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

describe("check-git-writes", () => {
  it("refuses a writing subcommand outside the notes module", () => {
    // The whole reason it exists: this app runs git in every repository the user has a tab in, and a
    // write aimed there would commit and push their actual work from a background timer.
    const root = fixture({
      "src/git/fetch.rs": `fn go() {\n  Command::new("git").args(["push"]).output();\n}\n`,
    });

    const result = run(root);

    expect(result.ok).toBe(false);
    expect(result.out).toContain("push");
    expect(result.out).toContain("src/git/fetch.rs");
    rmSync(root, { recursive: true, force: true });
  });

  it("allows the notes module, which is the one that may", () => {
    const root = fixture({
      "src/notes/git.rs": `fn go() {\n  Command::new("git").args(["commit", "-m", "x"]).output();\n}\n`,
    });

    expect(run(root).ok).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not fire on its own documentation", () => {
    // The trap the CSS tests and environment.rs both walked into. A guard that reports the sentence
    // explaining it gets switched off rather than obeyed.
    const root = fixture({
      "src/git/fetch.rs": `// Never run "push" or "commit" here — see ADR-PROJ-004.\nfn go() {}\n`,
    });

    expect(run(root).ok).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not fire on a panic message that happens to read like a subcommand", () => {
    // `.expect("commit")` is a message, not an argument. A check that is wrong is a check that gets
    // suppressed (ADR-CORE-039: a noisy tool lowers the real posture while raising the nominal one).
    const root = fixture({
      "src/git/details.rs": `fn go() {\n  repo.commit(a, b).expect("commit");\n}\n`,
    });

    expect(run(root).ok).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not fire on a test fixture building its own repository", () => {
    // A temp directory is not a repository the user has a tab in. Both real matches on the first run
    // were of this kind, and treating them as offences would have made the gate a nuisance.
    const root = fixture({
      "src/git/fetch.rs": `fn go() {}\n\n#[cfg(test)]\nmod tests {\n  fn setup() {\n    Command::new("git").args(["add", "."]).output();\n  }\n}\n`,
    });

    expect(run(root).ok).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("looks inside a multi-line argument list", () => {
    // How git is actually called in this codebase — the subcommand is rarely on the same line as the
    // `.args(`.
    const root = fixture({
      "src/git/fetch.rs": `fn go() {\n  Command::new("git")\n    .args([\n      "remote",\n      "add",\n      "origin",\n    ])\n    .output();\n}\n`,
    });

    const result = run(root);

    expect(result.ok).toBe(false);
    expect(result.out).toContain("add");
    rmSync(root, { recursive: true, force: true });
  });

  it("says nothing about reading subcommands", () => {
    // `fetch`, `pull`, `status`, `log`, `diff` are what the rest of the app does, all day, in the
    // user's repositories. Flagging them would make the gate useless on its first run.
    const root = fixture({
      "src/git/fetch.rs": `fn go() {\n  Command::new("git").args(["fetch", "--quiet"]).output();\n  Command::new("git").args(["status", "--porcelain"]).output();\n}\n`,
    });

    expect(run(root).ok).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
