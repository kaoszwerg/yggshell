---
id: ADR-APP-033
title: Maximum defensible posture on this stack — the safety set, and the gate that holds it
status: accepted
tldr: "ADR-CORE-039 for this stack: security-posture.json lists each defensible safety as enabled+wired or deferred-with-reason; an eslint.config.mjs gate holds it."
scope: global
load: conditional
triggers:
  [
    security,
    hardening,
    harden,
    posture,
    scanner,
    sast,
    sbom,
    cve,
    advisory,
    audit,
    cargo-audit,
    npm-audit,
    cargo-deny,
    cargo-vet,
    clippy,
    unsafe,
    overflow-checks,
    fuzzing,
    semgrep,
    gitleaks,
    gate,
    security-posture,
  ]
applies-to:
  [
    "security-posture.json",
    "scripts/lib/security-posture-gate.mjs",
    "eslint.config.mjs",
    "package.json",
    "src-tauri/Cargo.toml",
    "tsconfig.json",
  ]
supersedes: []
superseded-by: null
---

## Context

[ADR-CORE-039](core-039-maximum-defensible-security-posture.md) states the obligation — the security
posture is the **strongest the toolchain can express**, not the absence of known-bad, and a deliberately
dropped safety is **recorded, never silent** — and states just as plainly that the core **cannot enforce
it**: the core knows no toolchain, so it cannot know which scanners this stack has (ADR-CORE-033). It hands
the concrete safety set *and the gate* to the layer that owns the runtime. This is that layer, and this ADR
is that answer — the same split ADR-APP-032 made for crashes.

The floor was already here — `check:all` ran `cargo-audit`, `cargo-deny`, `secretlint`, `eslint-plugin-security`,
`knip`, `clippy -D warnings`, `tsc --strict`. What was missing was (a) the **ceiling**: analyses the
toolchain can express but nobody had turned on, and (b) any **record** of what was deliberately left off,
and any **gate** stopping a future agent from quietly unplugging a scanner from `check:all`.

## Decision

**`security-posture.json` is the project-owned SSOT of the posture.** It enumerates every canonical
defensible-safety category for this stack as either `enabled` (wired into `check:all`, reporting *and*
blocking) or `deferred` (with a non-empty `why`). It is project-owned — every project has a different
toolchain — so it is never pinned and never delivered by `governance:update`.

### Enabled — the floor, plus what this change turned on

Already present: Rust advisory scan (`cargo-audit`), Rust bans/licenses/sources (`cargo-deny`), secret
scanning (`secretlint` + `eslint-no-secrets`), JS SAST (`eslint-plugin-security`), dead code (`knip`),
Rust lint (`clippy -D warnings`), TS strictness (`tsc --strict`), dependency pinning (exact npm versions,
committed lockfiles, `--locked`).

Turned on in this change, each verified green before it landed:

- **JS dependency advisory scanning** — `security:audit-js` (`npm audit --omit=dev --audit-level=high`),
  wired into `check:all`. The Rust tree was scanned for advisories; the JS tree was not. Verified: 0
  production-dependency vulnerabilities today.
- **`clippy::undocumented_unsafe_blocks = "deny"`** (`src-tauri/Cargo.toml [lints.clippy]`) — every
  `unsafe` block must justify itself in a `// SAFETY:` comment. The one block that lacked one
  (`ShellExecuteW` in `commands/mod.rs`) got it in the same change.
- **`overflow-checks = true`** (`src-tauri/Cargo.toml [profile.release]`) — an integer overflow in a
  release build now panics (and is caught by the crash handler, ADR-APP-032) instead of wrapping silently.
- **`noUncheckedIndexedAccess: true`** (`tsconfig.json`) — indexed access is no longer assumed in-bounds.
- **Exact `=` Cargo pins** (`src-tauri/Cargo.toml`) — every direct dependency now carries an exact `=`
  requirement matching the committed `Cargo.lock`, so a `cargo update` cannot silently move a direct dep.
  Enabling this also corrected a latent manifest/lock drift **upward** (the manifest said `2.11.2` while the
  lock had tested `2.11.5`); the pins snap to the tested versions, never a downgrade. Verified: a `--locked`
  build leaves `Cargo.lock` unchanged.
- **Linker/compiler hardening** (`.cargo/config.toml`) — Windows Control Flow Guard and Linux full
  RELRO + BIND_NOW, applied on every build so the gate exercises them. Verified building on Windows; the
  Linux/macOS legs surface in the release build (rule:automation), which runs on every target. macOS stays
  at the toolchain default (PIE + hardened runtime).

### Deferred — on the record, with a reason

`cargo-vet` (≈450 crates to audit), `semgrep` (needs a curated ruleset to not be high-noise), `CodeQL`
(its push-CI model contradicts this stack's release-only CI), `gitleaks`/history secret scanning (a Go
binary in the local gate), `SBOM` (a release artifact, not a per-commit gate), and `cargo-fuzz` (no
untrusted-input parser exists yet). Each is a `deferred` entry in `security-posture.json` with its full
rationale. **Deferring is legitimate; deferring silently is not.**

### The gate (`scripts/lib/security-posture-gate.mjs`)

Loaded from `eslint.config.mjs`, exactly like the crash gate (ADR-APP-032) and the UI boundary
(ADR-APP-026), and for the same reason: `package.json` is project-owned and a consumer could drop a step
from `check:all`, while `npm run lint` runs in every project, always. It fails the lint run when:

- a canonical category is **not declared** (enabled or deferred) — none silently vanishes;
- an `enabled` safety's `gate` script is **not in `check:all`**, or its config assertion no longer holds
  (`overflow-checks`, `undocumented_unsafe_blocks`, `noUncheckedIndexedAccess` are read directly, because
  no `check:all` step exercises them);
- a `deferred` safety has **no `why`**;
- `lint` drops `--max-warnings 0` or `rust:clippy` drops `-D warnings` — the teeth of the existing gates.

## Alternatives

- **Turn on every available tool, no deferrals** — rejected, per ADR-CORE-039's own line: a high-noise
  scanner (`semgrep --config=auto`, full `cargo-vet`) trains suppression and drives `--no-verify`, which
  *lowers* the real posture. Defensible, not maximal-literal.
- **`semgrep`/`SBOM`/`cargo-vet` in this change** — deferred, not rejected: each needs work (a ruleset, a
  release-workflow step, an audit set) to be net-positive. Recorded so the deferral is visible, not
  forgotten.
- **Gate it as a `package.json` script** — rejected: a consumer can silently drop it, the exact bypass
  ADR-APP-026 and ADR-APP-032 already closed once.
- **Put the safety set in the core** — impossible: the core may not name `cargo` or `npm` (ADR-CORE-033).
  Only the obligation is portable; the tool list is ours.

## Consequences

- New: `security-posture.json` (project-owned), `scripts/lib/security-posture-gate.mjs`, its wiring in
  `eslint.config.mjs`, `rule:stack-security-posture`; `check:all` gains `security:audit-js`;
  `src-tauri/Cargo.toml` gains `[lints.clippy]` + `[profile.release]`; `tsconfig.json` gains
  `noUncheckedIndexedAccess`; one `// SAFETY:` comment added.
- Changing the posture is now a governed act: enable a safety and wire it, or defer it with a reason — the
  gate refuses anything else.
- Consumers of this layer must act: [`docs/migrations/app-106-maximum-defensible-posture.md`](../migrations/app-106-maximum-defensible-posture.md).

## References

- [ADR-CORE-039](core-039-maximum-defensible-security-posture.md) — the obligation, and why the gate had to
  land here.
- [ADR-APP-032](app-032-crash-handling-mechanism.md) — the gate pattern this reuses (loaded from
  `eslint.config.mjs`, covering both runtimes), and the crash handler that catches an `overflow-checks` panic.
- [ADR-APP-026](app-026-no-native-ui-primitives.md) — the original reason a gate lives in ESLint, not a
  droppable `package.json` step.
- `rule:security` (the portable obligation) · `rule:dependencies` (advisories block the push, never
  auto-suppress) · `rule:stack-security-posture` (the operational form on this stack).
