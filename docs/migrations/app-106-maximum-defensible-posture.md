# app-106 — the security posture seeks the ceiling, and a gate holds it (ADR-APP-033)

## What changed

Upstream core now requires the **maximum defensible security posture** (ADR-CORE-039, briefing
`core-010-maximum-defensible-posture.md`): every safety the toolchain can express is enabled and wired into
`check:all`, and a deliberately dropped one is recorded, never silent. This app layer implements that for
the Tauri/Rust/React stack (ADR-APP-033):

- **`security-posture.json`** (project-owned) is the SSOT of the posture — every safety category, `enabled`
  or `deferred` with a reason.
- **`scripts/lib/security-posture-gate.mjs`**, loaded from `eslint.config.mjs`, enforces it on every
  `npm run lint`.
- `check:all` gained `security:audit-js` (npm advisory scan); `src-tauri/Cargo.toml` gained
  `[lints.clippy] undocumented_unsafe_blocks = "deny"` and `[profile.release] overflow-checks = true`;
  `tsconfig.json` gained `noUncheckedIndexedAccess`.

## What you must do

You consume this app layer, so you receive the **gate** (`security-posture-gate.mjs`) and the rule, but
**not** `security-posture.json` — it is project-owned, because your toolchain is yours.

1. After `governance:update`, run `npm run lint`. The posture gate will fail until **your**
   `security-posture.json` exists and accounts for every canonical safety category.
2. Create `security-posture.json` at your repo root. Declare each category `enabled` (with the `check:all`
   script that runs it) or `deferred` (with a non-empty `why`). Copy this layer's file as the starting
   point and adjust to your project's actual `check:all` and config.
3. Make sure every `enabled` safety is really wired into your `check:all`, reporting **and** blocking, and
   that `overflow-checks` / `undocumented_unsafe_blocks` / `noUncheckedIndexedAccess` are set where you
   declare them enabled — the gate reads those config files directly.
4. Run `npm run check:all` until green.

## What is now forbidden

- **Unplugging a scanner from `check:all` while the manifest still claims it** — the gate goes red.
- **Deferring a safety with no reason** — a `deferred` entry needs a `why` a reviewer can see.
- **Weakening `--max-warnings 0` or `clippy -D warnings`** — the gate checks the teeth are still there.
- **Suppressing a finding to make the gate green** (`rule:security`, `rule:dependencies`) — fix it or
  escalate to the maintainer.

## The line to hold

This is the **strongest defensible** posture, not a tool count. A scanner whose noise trains suppression or
drives `--no-verify` is a net regression — deferring it (on the record) is the correct call. The deferred
list in this layer's `security-posture.json` (cargo-vet, semgrep, CodeQL, gitleaks, SBOM, cargo-fuzz, …)
shows the shape: each is off *with a reason*, not by silent omission.
