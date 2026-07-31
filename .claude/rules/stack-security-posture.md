---
id: rule:stack-security-posture
title: Security posture on this stack — the safety set and its gate
tldr: "The defensible safety set for this stack lives in security-posture.json; an eslint.config.mjs gate holds it. Change it there, never by unplugging a scanner."
scope: global
load: conditional
triggers: [security, hardening, harden, posture, scanner, sast, sbom, cve, advisory, audit, npm-audit, cargo-audit, cargo-deny, cargo-vet, clippy, unsafe, overflow-checks, fuzzing, semgrep, gitleaks, gate, security-posture, check]
applies-to: ["security-posture.json", "scripts/lib/security-posture-gate.mjs", "eslint.config.mjs", "package.json", "src-tauri/Cargo.toml", "tsconfig.json"]
supersedes: []
superseded-by: null
---

# Security posture on this stack (ADR-CORE-039, ADR-APP-033)

`rule:security` carries the portable obligation — the posture is the **strongest the toolchain can
express**, a dropped safety is **recorded, never silent**. This is that obligation made concrete for the
Tauri 2 + Rust + React stack: *which* safeties, and *how they are held*.

- **`security-posture.json` is the SSOT.** Every canonical defensible-safety category is listed there as
  `enabled` (with the `check:all` gate script that runs it) or `deferred` (with a non-empty `why`). It is
  project-owned — never pinned, never delivered by `governance:update` — because every project's toolchain
  differs.
- **Change the posture by editing that file — never by quietly unplugging a scanner.** The gate
  `scripts/lib/security-posture-gate.mjs`, loaded from `eslint.config.mjs` (so it runs on every
  `npm run lint`, not as a droppable `package.json` step), fails the build when a canonical category is
  undeclared, an `enabled` safety is missing from `check:all` (or its config assertion is dropped), a
  `deferred` safety has no reason, or `--max-warnings 0` / `-D warnings` are weakened.
- **Enabled today:** `cargo-audit`, `cargo-deny`, `npm audit` (production, high), `secretlint` +
  `eslint-no-secrets`, `eslint-plugin-security`, `knip`, `clippy -D warnings` + `undocumented_unsafe_blocks`,
  `tsc --strict` + `noUncheckedIndexedAccess`, `[profile.release] overflow-checks`, exact `=` Cargo pins +
  committed lockfiles, and `.cargo/config.toml` linker hardening (Windows CFG, Linux full RELRO).
- **Deferred (on the record, in the file):** `cargo-vet`, `semgrep`, `CodeQL`, `gitleaks`/history, `SBOM`,
  `cargo-fuzz` — each with its rationale. Reaching for one of these means moving it to `enabled` and wiring
  it, then proving `check:all` stays green.
- **Adding a new safety:** wire it into `check:all` (reporting *and* blocking), flip its entry to
  `enabled`, and confirm the gate passes. A safety that only warns is not enabled (ADR-CORE-039).
- **Never suppress a finding to green** (`rule:security`, `rule:dependencies`): fix it, or escalate to the
  maintainer, who may record a time-boxed exception. An `#[allow]` / disabled rule added to pass the gate
  is the regression this rule exists to prevent.
