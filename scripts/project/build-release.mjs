#!/usr/bin/env node
/**
 * Build the release bundle with an environment that cannot poison it.
 *
 * ## Why this is a script and not a shell one-liner
 *
 * The build must run without `TAURI_CONFIG`. `tauri dev --config …` exports that variable, and
 * `tauri build` reads the same one — so building in the shell you just tested in compiles the release
 * against the *dev* configuration, and the result silently uses the dev data directory
 * (`check-release-identity.mjs` explains the failure in full).
 *
 * Stripping it with `env -u TAURI_CONFIG` works and was the first version. It is also **Unix-only**:
 * `env` is not a thing on Windows' cmd or PowerShell, so the documented build command would simply
 * fail there — and, worse, whoever worked around it would be building without the gate that runs
 * afterwards, on the one platform where nobody would notice it had gone (rule:cross-platform).
 *
 * Node deletes a variable from a child's environment on every platform, so the safe path is the same
 * path everywhere.
 */
import { spawnSync } from "node:child_process";

const env = { ...process.env };
if (env.TAURI_CONFIG !== undefined) {
  // Say it out loud: this is the situation that cost an install and a diagnosis session, and silently
  // fixing it would hide how easy it is to get into (rule:logging — no silent recovery either).
  console.log(
    "build-release: TAURI_CONFIG was set in this environment (a `tauri dev --config …` ran here);\n" +
      "               removing it so the release is built against tauri.conf.json.",
  );
  delete env.TAURI_CONFIG;
}

const result = spawnSync("npx", ["tauri", "build", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  // Windows resolves `npx` through the shell; without this the spawn fails with ENOENT there.
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`build-release: could not start the build — ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
