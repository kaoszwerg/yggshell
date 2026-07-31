// The security-posture gate (ADR-CORE-039, ADR-APP-033) — a defensible safety silently dropped from the
// gate, or deferred with no reason, is a red build, not a review comment.
//
// ADR-CORE-039 states the obligation — the posture is the STRONGEST the toolchain can express, and a
// dropped safety is RECORDED, never silent — and states just as plainly that the core CANNOT check it:
// the core knows no toolchain, so it cannot know which scanners this stack has (ADR-CORE-033). The app
// layer does. So the obligation to gate it lands here, and this is that gate.
//
// It is loaded from `eslint.config.mjs`, not wired as another `package.json` script, for the crash-gate
// reason (ADR-APP-032): `package.json` is project-owned, so a consumer could simply drop the step from
// `check:all`. `npm run lint` runs in every project, always.
//
// What it enforces, reading `security-posture.json` (the project-owned SSOT of the posture decision):
//   1. Every canonical safety category is declared — enabled and wired, or deferred with a reason. None
//      silently vanishes.
//   2. Every `enabled` safety is actually verifiable: its `gate` script is present in `check:all`, and/or
//      its config assertion still holds. A safety the manifest claims cannot be quietly unplugged.
//   3. Every `deferred` safety carries a non-empty `why` — a drop is always on the record (ADR-CORE-039).
//   4. The key gates keep their teeth: `lint` runs `--max-warnings 0`, `rust:clippy` denies warnings.
import fs from "node:fs";
import path from "node:path";

export const POSTURE_REL = "security-posture.json";

// The canonical defensible-safety categories for this stack. Each MUST be accounted for in
// `security-posture.json` — enabled and wired, or deferred with a reason. Adding a category here raises
// the floor for every consumer; removing one is a governance act (ADR-APP-033), not a quiet edit.
const REQUIRED = [
  "rust-advisory-scan",
  "rust-supply-chain-bans",
  "js-advisory-scan",
  "secret-scan",
  "sast",
  "dead-code",
  "rust-lint-strict",
  "ts-lint-strict",
  "compiler-hardening",
  "dep-pinning",
  "rust-supply-chain-vet",
  "sast-semgrep",
  "sast-codeql",
  "secret-scan-history",
  "sbom",
  "fuzzing",
  "cargo-exact-pins",
  "linker-hardening",
];

function read(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

function packageJson(root) {
  const raw = read(root, "package.json");
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** True when `npm run <name>` appears as a step in the check:all chain. */
function inCheckAll(chain, name) {
  if (chain === null) return true; // a missing check:all is reported once, separately.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bnpm run ${escaped}(\\s|&|$)`).test(chain);
}

// Config assertions for the safeties no `check:all` step exercises (a build-profile flag, a lint level in
// a manifest). Each returns null when satisfied, or an error string. Only run for an ENABLED entry.
const CONFIG_VERIFIERS = {
  "compiler-hardening": (root) => {
    const t = read(root, "src-tauri/Cargo.toml") ?? "";
    return /\[profile\.release\][\s\S]*?overflow-checks\s*=\s*true/.test(t)
      ? null
      : `src-tauri/Cargo.toml [profile.release] no longer sets overflow-checks = true — integer-overflow hardening has been dropped.`;
  },
  "rust-lint-strict": (root) => {
    const t = read(root, "src-tauri/Cargo.toml") ?? "";
    return /undocumented_unsafe_blocks\s*=\s*"(deny|forbid)"/.test(t)
      ? null
      : `src-tauri/Cargo.toml [lints.clippy] no longer denies undocumented_unsafe_blocks — an unsafe block need no longer justify itself in a // SAFETY comment.`;
  },
  "ts-lint-strict": (root) => {
    const t = read(root, "tsconfig.json") ?? "";
    return /"noUncheckedIndexedAccess"\s*:\s*true/.test(t)
      ? null
      : `tsconfig.json no longer sets "noUncheckedIndexedAccess": true — indexed access is unchecked again.`;
  },
  "cargo-exact-pins": (root) => {
    const t = read(root, "src-tauri/Cargo.toml");
    if (t === null) return `src-tauri/Cargo.toml is missing — cannot verify exact dependency pins.`;
    const offenders = [];
    let table = "";
    for (const raw of t.split("\n")) {
      const line = raw.trim();
      const header = line.match(/^\[([^\]]+)\]/);
      if (header) {
        table = header[1];
        continue;
      }
      if (!/dependencies$/.test(table)) continue; // only *dependencies tables
      const req = (line.match(/version\s*=\s*"([^"]*)"/) ??
        line.match(/^[A-Za-z0-9_-]+\s*=\s*"([^"]*)"\s*$/))?.[1];
      if (req !== undefined && !req.startsWith("=")) offenders.push(line);
    }
    return offenders.length
      ? `src-tauri/Cargo.toml has direct dependencies without an exact "=" pin: ${offenders.join("; ")} — dep-pinning is enabled at maximum (ADR-APP-033).`
      : null;
  },
  "linker-hardening": (root) => {
    const t = read(root, ".cargo/config.toml");
    return t && /rustflags\s*=/.test(t)
      ? null
      : `.cargo/config.toml is missing or sets no rustflags — linker/compiler hardening is enabled (ADR-APP-033) but not configured.`;
  },
};

/**
 * Check the declared security posture of this repo against what the gate actually enforces.
 *
 * @param {string} root repo root
 * @returns {{errors: string[]}} empty when the posture is fully declared, wired and honest
 */
export function checkSecurityPostureGate(root) {
  const errors = [];

  const raw = read(root, POSTURE_REL);
  if (raw === null) {
    errors.push(
      `${POSTURE_REL} is missing — the security posture is undeclared. Record every defensible safety as enabled (wired into check:all) or deferred (with a reason). ADR-CORE-039, ADR-APP-033.`,
    );
    return { errors };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    errors.push(`${POSTURE_REL} is not valid JSON: ${e.message}`);
    return { errors };
  }
  const safeties = parsed?.safeties;
  if (!safeties || typeof safeties !== "object" || Array.isArray(safeties)) {
    errors.push(`${POSTURE_REL} needs a "safeties" object keyed by category.`);
    return { errors };
  }

  const pkg = packageJson(root);
  const chain = pkg?.scripts?.["check:all"] ?? null;
  if (chain === null) {
    errors.push(
      `package.json has no "check:all" script — the posture cannot be verified as wired.`,
    );
  }

  // 1 — every canonical category is accounted for.
  for (const cat of REQUIRED) {
    if (!(cat in safeties)) {
      errors.push(
        `${POSTURE_REL} does not account for the "${cat}" safety — declare it enabled (with its check:all gate) or deferred (with a reason). A category may not silently vanish (ADR-CORE-039).`,
      );
    }
  }

  // 2 + 3 — shape, wiring, config, and recorded deferral.
  for (const [cat, entry] of Object.entries(safeties)) {
    if (!entry || typeof entry !== "object") {
      errors.push(`${POSTURE_REL}: "${cat}" must be an object with a "status".`);
      continue;
    }
    const { status, gate, why } = entry;
    if (status !== "enabled" && status !== "deferred") {
      errors.push(
        `${POSTURE_REL}: "${cat}" has status "${status ?? "(none)"}" — must be "enabled" or "deferred".`,
      );
      continue;
    }

    if (status === "enabled") {
      const verifier = CONFIG_VERIFIERS[cat];
      const hasGate = typeof gate === "string" && gate.length > 0;
      if (!hasGate && !verifier) {
        errors.push(
          `${POSTURE_REL}: "${cat}" is enabled but nothing verifies it — give it a "gate" script that runs in check:all, or a config assertion.`,
        );
      }
      if (hasGate && !inCheckAll(chain, gate)) {
        errors.push(
          `${POSTURE_REL}: "${cat}" is enabled via "${gate}", but "npm run ${gate}" is not in check:all — a safety the manifest claims is unplugged from the gate (ADR-CORE-039: report AND block).`,
        );
      }
      if (verifier) {
        const problem = verifier(root);
        if (problem) errors.push(problem);
      }
    } else {
      if (typeof why !== "string" || !why.trim()) {
        errors.push(
          `${POSTURE_REL}: "${cat}" is deferred without a "why" — a dropped safety is a recorded, maintainer-visible decision, never a silent omission (ADR-CORE-039).`,
        );
      }
    }
  }

  // 4 — the key gates keep their teeth.
  const lint = pkg?.scripts?.["lint"];
  if (typeof lint === "string" && !lint.includes("--max-warnings 0")) {
    errors.push(
      `package.json "lint" no longer runs "--max-warnings 0" — the zero-warning gate has been weakened (rule:code-quality).`,
    );
  }
  const clippy = pkg?.scripts?.["rust:clippy"];
  if (typeof clippy === "string" && !/-D\s+warnings/.test(clippy)) {
    errors.push(
      `package.json "rust:clippy" no longer denies warnings ("-D warnings") — the Rust lint gate has been weakened.`,
    );
  }

  return { errors };
}
