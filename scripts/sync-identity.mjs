#!/usr/bin/env node
// App identity SSOT (ADR-APP-031): app.identity.json is the ONLY place the app name/identifier is edited.
// This propagates it into every derived location. Edits are value-level (formatting preserved), so
// Prettier and the identity:check gate agree. Run `identity:sync` after editing app.identity.json.
//   node scripts/sync-identity.mjs           apply
//   node scripts/sync-identity.mjs --check   verify no drift (runs in check:all)
//
// The Rust targets are DISCOVERED, not listed one by one (see `rustCrateRefTargets`): a rename that
// misses a single `<crate>_lib::` reference breaks `cargo clippy --all-targets` — and it breaks it
// immediately after this script has reported that everything matches, which is the worst possible
// moment to be wrong.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/governance.mjs";

export const IDENTITY_FILE = "app.identity.json";

/** Rust sources outside `src/` that reference the library crate by name. Scanned, never enumerated. */
const RUST_CRATE_REF_DIRS = ["src-tauri/examples"];
/** Rust sources that reference the library crate and are not in a scanned directory. */
const RUST_CRATE_REF_FILES = ["src-tauri/src/main.rs", "src-tauri/tests/contracts.rs"];

const q = (v) => JSON.stringify(v);

/** Replace the first `"key": "..."` value in a JSON string, preserving surrounding formatting. */
const setKey = (text, key, value) =>
  text.replace(new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`), (_m, g1) => g1 + q(value));

/** Replace a `NAME = "..."` string-literal value in TS. */
const setConst = (text, name, value) =>
  text.replace(new RegExp(`(\\b${name}\\s*=\\s*)"[^"]*"`), (_m, g1) => g1 + q(value));

function syncCargo(t, id) {
  t = t.replace(/^(name\s*=\s*)"[^"]*"/m, (_m, g) => g + q(id.crateName)); // [package] name (first)
  t = t.replace(/^(description\s*=\s*)"[^"]*"/m, (_m, g) => g + q(id.description));
  t = t.replace(/^(default-run\s*=\s*)"[^"]*"/m, (_m, g) => g + q(id.binaryName));
  t = t.replace(/(\[lib\][\s\S]*?\nname\s*=\s*)"[^"]*"/, (_m, g) => g + q(`${id.crateName}_lib`));
  t = t.replace(/(\[\[bin\]\][\s\S]*?\nname\s*=\s*)"[^"]*"/, (_m, g) => g + q(id.binaryName));
  return t;
}

/**
 * Rewrite every reference to the library crate — `use old_lib::x`, `old_lib::crash::y`, any form.
 *
 * The old name is unknown at this point (that is the whole problem: the file still carries it), so
 * the match is by the `_lib` convention the crate name follows. These files may therefore not
 * reference a *foreign* crate whose name ends in `_lib`; nothing in the template does.
 */
export const withCrateRefs = (text, libCrate) =>
  text.replace(/\b[A-Za-z_]\w*_lib::/g, `${libCrate}::`);

/**
 * Every Rust file that names the library crate: the fixed entry points plus whatever lives in the
 * scanned directories today.
 *
 * `src-tauri/examples/` is scanned rather than listed because an example is exactly the kind of file
 * a project adds later — and a missed one turns `identity:sync` into a broken build that the very
 * next `identity:check` calls "OK". Paths are POSIX-separated: they are repo-relative keys, not
 * filesystem paths.
 */
export function rustCrateRefTargets(root) {
  const scanned = RUST_CRATE_REF_DIRS.flatMap((dir) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return [];
    return fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".rs"))
      .sort()
      .map((f) => `${dir}/${f}`);
  });
  return [...RUST_CRATE_REF_FILES, ...scanned];
}

/**
 * Every derived location, as `{ [repoRelativePath]: (text) => text }`.
 *
 * @param {object} id parsed app.identity.json
 * @param {string} root repo root to scan for the discovered targets
 */
export function targetsFor(id, root) {
  const libCrate = `${id.crateName}_lib`;
  const targets = {
    "package.json": (t) => setKey(setKey(t, "name", id.packageName), "description", id.description),
    "src-tauri/Cargo.toml": (t) => syncCargo(t, id),
    "src-tauri/tauri.conf.json": (t) =>
      setKey(
        setKey(
          setKey(setKey(t, "productName", id.displayName), "mainBinaryName", id.binaryName),
          "identifier",
          id.identifier,
        ),
        "title",
        id.displayName,
      ),
    "src-tauri/tauri.dev.conf.json": (t) =>
      setKey(
        setKey(t, "productName", `${id.displayName} Dev`),
        "identifier",
        `${id.identifier}.dev`,
      ),
    "src/lib/app.ts": (t) =>
      setConst(
        setConst(setConst(t, "APP_NAME", id.displayName), "APP_TAGLINE", id.tagline),
        "APP_DESCRIPTION",
        id.description,
      ),
    "index.html": (t) =>
      t.replace(/(<title>)[^<]*(<\/title>)/, (_m, a, b) => a + id.displayName + b),
  };
  for (const rel of rustCrateRefTargets(root)) {
    targets[rel] = (t) => withCrateRefs(t, libCrate);
  }
  return targets;
}

/**
 * Propagate (or, with `check`, verify) app.identity.json into every derived location.
 *
 * @param {{root?: string, check?: boolean}} options
 * @returns {{identity: object, checked: string[], written: string[], drift: string[]}}
 *   `drift` is populated in check mode only; `written` in apply mode only. A target that does not
 *   exist in this project is skipped, not an error.
 * @throws when app.identity.json is missing or unparseable — never silently skipped.
 */
export function syncIdentity({ root = ROOT, check = false } = {}) {
  const identity = JSON.parse(fs.readFileSync(path.join(root, IDENTITY_FILE), "utf8"));
  const checked = [];
  const written = [];
  const drift = [];

  for (const [rel, fn] of Object.entries(targetsFor(identity, root))) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    checked.push(rel);
    const cur = fs.readFileSync(p, "utf8");
    const next = fn(cur);
    if (cur === next) continue;
    if (check) {
      drift.push(rel);
    } else {
      fs.writeFileSync(p, next);
      written.push(rel);
    }
  }

  return { identity, checked, written, drift };
}

function main() {
  const check = process.argv.includes("--check");
  let result;
  try {
    result = syncIdentity({ check });
  } catch (err) {
    console.error(`identity: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (check) {
    if (result.drift.length) {
      console.error(
        "identity:check FAILED — derived from app.identity.json is stale (run `npm run identity:sync`):",
      );
      for (const d of result.drift) console.error(`  - ${d}`);
      process.exit(1);
    }
    console.log(
      `identity:check OK — ${result.checked.length} derived locations match app.identity.json.`,
    );
    return;
  }

  for (const rel of result.written) console.log(`identity: updated ${rel}`);
  console.log("identity: sync complete. Run `npm run gen:types` if the crate name changed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
