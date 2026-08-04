/**
 * The gate that guards every commit gets the same treatment as production code (rule:testing): it
 * runs against a temporary fixture, never against the live repository — where "it passed today"
 * proves nothing about whether it can fail at all.
 *
 * And this gate especially, because the defect it catches is one where **every test was green**: the
 * theme drop zone listened for an event the config had switched off, and jsdom has no OS drag layer
 * to be wrong about. A gate for that class is worth nothing unless it has been *seen* to fail.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Not `new URL(..., import.meta.url)`: under Vitest `import.meta.url` is a Vite-served path, so
// `.pathname` comes out as "/scripts/project/…" and Node cannot find it. Vitest runs at the repo root.
const GATE = join(process.cwd(), "scripts/project/check-drag-drop.mjs");

/** A fake repo with a tauri config and one source file, run through the gate. */
function runAgainst(dragDropEnabled, source) {
  const root = mkdtempSync(join(tmpdir(), "drag-gate-"));
  try {
    mkdirSync(join(root, "src-tauri"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src-tauri/tauri.conf.json"),
      JSON.stringify({ app: { windows: [{ label: "main", dragDropEnabled }] } }),
    );
    writeFileSync(join(root, "src/Thing.tsx"), source);
    try {
      // stderr piped, not inherited: this test deliberately runs the gate against a violation, and
      // its (correct) complaint would otherwise be printed into a green test run.
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

describe("check-drag-drop", () => {
  it("refuses a Tauri drop listener while drag-drop is switched off", () => {
    // The defect, exactly as it shipped: a listener for an event Tauri never registers a handler for.
    const result = runAgainst(false, "getCurrentWebview().onDragDropEvent(handle);\n");

    expect(result.ok).toBe(false);
    expect(result.output).toContain("src/Thing.tsx:1");
    expect(result.output).toContain("native picker opened by the BACKEND");
  });

  it("refuses the webview's own drag handlers while drag-drop is switched ON", () => {
    // The mirror image, and just as silent: Tauri intercepts the drag at the OS level, so the
    // component is inert in the app and green in jsdom. This is the bug that made the flag false.
    const result = runAgainst(true, "<li onDragStart={start} onDrop={drop} />\n");

    expect(result.ok).toBe(false);
    expect(result.output).toContain("dragDropEnabled is TRUE");
  });

  it("lets the matching half through, in both settings", () => {
    expect(runAgainst(false, "<li onDragStart={start} />\n").ok).toBe(true);
    expect(runAgainst(true, "getCurrentWebview().onDragDropEvent(handle);\n").ok).toBe(true);
  });

  it("treats a missing key as Tauri's own default, which is enabled", () => {
    const root = mkdtempSync(join(tmpdir(), "drag-gate-"));
    try {
      mkdirSync(join(root, "src-tauri"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "src-tauri/tauri.conf.json"),
        JSON.stringify({ app: { windows: [{ label: "main" }] } }),
      );
      writeFileSync(join(root, "src/Thing.tsx"), "<li onDrop={drop} />\n");
      expect(() =>
        execFileSync("node", [GATE, root], { stdio: ["ignore", "pipe", "pipe"] }),
      ).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not mistake a comment about the trap for the trap", () => {
    // This whole codebase explains its traps in prose next to the code. A gate that fired on the
    // explanation would push people to stop writing them.
    const result = runAgainst(false, "// never use onDragDropEvent here — see ADR-PROJ-004\n");

    expect(result.ok).toBe(true);
  });
});
