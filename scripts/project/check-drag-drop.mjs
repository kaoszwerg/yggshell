#!/usr/bin/env node
/**
 * Refuse a drag-drop listener that this window can never deliver an event to.
 *
 * **The defect this exists for, and it shipped.** `src-tauri/tauri.conf.json` carries
 * `"dragDropEnabled": false`, set in `7d8254d` so the status-bar editor's HTML5 dragging would work
 * at all — Tauri intercepts drags at the OS level otherwise. What that flag *also* does is skip
 * registering the drag-drop handler entirely:
 *
 * ```
 * tauri-runtime/src/webview.rs:477     if !config.drag_drop_enabled { builder.disable_drag_drop_handler() }
 * tauri-runtime-wry/src/lib.rs:4862    if webview_attributes.drag_drop_handler_enabled { …with_drag_drop_handler(…) }
 * ```
 *
 * So `getCurrentWebview().onDragDropEvent(…)` registers a listener for an event that cannot arrive.
 * The theme import did exactly that for three days: a dashed drop zone, on screen, inviting a gesture
 * that did nothing. **Nothing failed.** No error, no warning, and fourteen tests stayed green,
 * because jsdom has no OS drag layer to be wrong about — the same failure class `7d8254d`'s own
 * commit message named, hit inside that very commit.
 *
 * That is the shape a check can catch and a reviewer cannot: two files that are each correct and
 * contradict each other. So the gate reads the config and the sources together, and refuses the
 * combination.
 *
 * **It works in both directions**, because the reverse is just as silent: turning `dragDropEnabled`
 * back on would leave the HTML5 `onDragStart`/`onDrop` handlers in the settings editor registered and
 * unreachable, which is the bug that was fixed by turning it off in the first place.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The tree to check. An argument rather than always the repo, so the gate can be run against a
 * fixture instead of the live checkout (rule:testing).
 */
const ROOT = process.argv[2] ?? new URL("../..", import.meta.url).pathname;

const CONFIG = "src-tauri/tauri.conf.json";
const SEARCHED = ["src"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

/** Tauri's own drop events — the ones that need the handler the config can switch off. */
const TAURI_DROP = /onDragDropEvent|["'`]tauri:\/\/drag-drop["'`]/;

/** The webview's own drag events — the ones that need the handler switched OFF. */
const HTML5_DRAG = /\bonDrag(Start|Over|Leave|End)\b|\bonDrop\b|\bdataTransfer\b/;

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
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

let enabled;
try {
  const config = JSON.parse(readFileSync(join(ROOT, CONFIG), "utf8"));
  // Tauri's own default is `true`; an absent key therefore means enabled.
  enabled = config.app?.windows?.[0]?.dragDropEnabled ?? true;
} catch (error) {
  console.error(`check-drag-drop: could not read ${CONFIG} — ${String(error)}`);
  process.exit(1);
}

const banned = enabled ? HTML5_DRAG : TAURI_DROP;
const findings = [];

for (const target of SEARCHED) {
  for (const file of files(join(ROOT, target))) {
    // The gate and its test both quote the very patterns they ban.
    if (/check-drag-drop(\.test)?\.mjs$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, index) => {
      // A comment explaining the trap is not a listener. Only real code counts.
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
      if (banned.test(line)) {
        findings.push({ file: relative(ROOT, file), line: index + 1, text: code });
      }
    });
  }
}

if (findings.length > 0) {
  console.error(
    `check-drag-drop: ${CONFIG} has dragDropEnabled: ${String(enabled)}, which makes these unreachable.\n`,
  );
  for (const found of findings) {
    console.error(`  ${found.file}:${found.line}`);
    console.error(`      ${found.text}`);
  }
  console.error(
    (enabled
      ? `
dragDropEnabled is TRUE, so Tauri intercepts drags at the OS level and the webview's own
onDragStart/onDrop never fire. A component using them is inert in the running app and green in
jsdom, which has no such layer.

What to do:
  - a drop of FILES from outside   -> getCurrentWebview().onDragDropEvent, which is what this
                                      setting exists to deliver
  - dragging WITHIN the interface  -> pointer events, or set dragDropEnabled: false and move the
                                      file drops to a native picker opened by the BACKEND
`
      : `
dragDropEnabled is FALSE — set so the webview's own HTML5 dragging works — so Tauri registers no
drag-drop handler at all (tauri-runtime/src/webview.rs) and tauri://drag-drop can never fire. A
listener for it is a drop zone that silently does nothing, which is exactly what shipped in the
theme import (ADR-PROJ-004).

What to do:
  - a file from outside the app    -> a native picker opened by the BACKEND, as notes_import and
                                      import_terminal_theme do. The path then never enters the
                                      webview either, which is the stronger boundary anyway.
  - genuinely need OS drops        -> flip dragDropEnabled and rebuild the in-window dragging on
                                      pointer events, in the same change. Not one without the other.
`
    ).trim(),
  );
  process.exit(1);
}

console.log(
  `check-drag-drop OK — dragDropEnabled: ${String(enabled)} and nothing listens for the events it cannot deliver.`,
);
