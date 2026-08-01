#!/usr/bin/env node
/**
 * Refuse a release build that carries the DEV identity inside it.
 *
 * ## The failure this exists for, exactly as it happened
 *
 * `tauri dev --config src-tauri/tauri.dev.conf.json` exports its merged configuration to the
 * environment as `TAURI_CONFIG` — a JSON blob naming the dev product and the dev identifier.
 * **`tauri build` reads that variable too.** Run the two in the same shell — which is precisely what
 * building right after testing looks like — and the release binary is compiled against the dev
 * configuration.
 *
 * **And it looks completely fine from the outside.** The bundle's `Info.plist` still says
 * `com.kaoszwerg.yggshell`, the app is called YggShell, it installs and it starts. What changed is
 * where it *lives*: `app_data_dir()` resolves from the compiled-in identifier, so the app silently
 * reads and writes `…/com.kaoszwerg.yggshell.dev/` — a different settings file, different themes,
 * different logs, different agent events. The maintainer's real data sits untouched next to it while
 * the app behaves like a fresh install, and nothing anywhere reports an error.
 *
 * That is why this is a build gate and not a note: the symptom does not point at the cause, and the
 * one artefact that betrays it is the binary itself.
 *
 * ## What it checks
 *
 * Tauri embeds the configuration in the executable, so the identifier it will actually use is
 * readable there. The dev identifier must not appear; the production one must. Verified against both
 * a poisoned and a clean build before this script was written:
 *
 * ```
 * poisoned: com.kaoszwerg.yggshell.devindex.htmldefault
 * clean:    com.kaoszwerg.yggshellindex.htmldefault
 * ```
 *
 * `npm run app:build` also strips `TAURI_CONFIG` before invoking the build, so the poisoning cannot
 * happen through the documented path at all. This gate is the second belt: it catches a bare
 * `npx tauri build`, a CI runner that inherited the variable, and whatever the next way in turns out
 * to be.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(new URL("../..", import.meta.url).pathname);
const BINARY = resolve(REPO, "src-tauri/target/release/yggshell");

/** The identifier a release is supposed to carry, from the config that owns it. */
function expectedIdentifier() {
  const conf = JSON.parse(readFileSync(resolve(REPO, "src-tauri/tauri.conf.json"), "utf8"));
  if (typeof conf.identifier !== "string" || conf.identifier.length === 0) {
    throw new Error("src-tauri/tauri.conf.json has no identifier");
  }
  return conf.identifier;
}

/** The identifier the dev channel uses, which must never end up in a release. */
function devIdentifier() {
  const path = resolve(REPO, "src-tauri/tauri.dev.conf.json");
  if (!existsSync(path)) return null;
  const conf = JSON.parse(readFileSync(path, "utf8"));
  return typeof conf.identifier === "string" ? conf.identifier : null;
}

/**
 * The binary as searchable text.
 *
 * **Read directly rather than shelling out to `strings`** — which is what this did first, and it made
 * the gate macOS/Linux-only: `strings` does not exist on Windows, so a developer building there would
 * have lost the check silently, on the one platform where nobody would notice it was missing
 * (rule:cross-platform). Reading the file and searching it needs no external tool at all, and the
 * identifiers we look for are plain ASCII in the embedded configuration.
 *
 * `latin1` because it maps every byte to exactly one character: a binary is not valid UTF-8, and a
 * lossy decode could destroy the very bytes being searched for.
 */
function binaryAsText(binary) {
  return readFileSync(binary).toString("latin1");
}

const expected = expectedIdentifier();
const dev = devIdentifier();

if (!existsSync(BINARY)) {
  console.error(`check-release-identity: no release binary at ${BINARY} — build it first.`);
  process.exit(1);
}

/**
 * The identifier as it appears **inside the embedded configuration**, which is the only occurrence
 * that decides anything.
 *
 * A bare string match is not good enough and the first version of this gate proved it: the binary
 * also contains loose copies of both identifiers (linker leftovers from earlier incremental builds),
 * so matching `dev` anywhere raised a false alarm on a perfectly good build. A gate that cries wolf
 * gets ignored or removed, which leaves the posture lower than having none (ADR-CORE-039).
 *
 * Tauri serialises the config with `frontendDist`'s entry point directly after the identifier, so the
 * embedded form is `<identifier>index.html`. Measured on both a poisoned and a clean build:
 *
 * ```
 * poisoned: com.kaoszwerg.yggshell.devindex.htmldefault
 * clean:    com.kaoszwerg.yggshellindex.htmldefault
 * ```
 */
const embedded = (identifier) => `${identifier}index.html`;

const text = binaryAsText(BINARY);
const problems = [];

if (dev !== null && text.includes(embedded(dev))) {
  problems.push(
    `the DEV identifier "${dev}" is in the release binary's embedded configuration.\n` +
      `  This app would read and write ~/Library/Application Support/${dev}/ — a different\n` +
      `  settings file, themes and logs than the one it claims to be, with no error anywhere.\n` +
      `  Cause: TAURI_CONFIG was set in the environment (\`tauri dev --config …\` exports it) and\n` +
      `  \`tauri build\` inherited it. Fix: build via \`npm run app:build\`, which strips it, or run\n` +
      `  \`env -u TAURI_CONFIG npx tauri build\`.`,
  );
}

if (!text.includes(embedded(expected))) {
  // Either the build is wrong, or Tauri changed how it serialises the config and this gate has gone
  // blind. Both must be loud: a check that silently stops checking is worse than one that fails.
  problems.push(
    `the expected identifier "${expected}" was not found in the embedded configuration.\n` +
      `  Looked for "${embedded(expected)}". If the build is otherwise fine, Tauri may have changed\n` +
      `  its config layout — re-derive the pattern rather than deleting the check.`,
  );
}

if (problems.length > 0) {
  console.error("check-release-identity FAILED\n");
  for (const p of problems) console.error(`- ${p}\n`);
  process.exit(1);
}

console.log(`check-release-identity OK — release binary carries ${expected}.`);
