---
id: ADR-CORE-039
title: Maximum defensible security posture — the gate seeks the ceiling, not the floor
status: accepted
tldr: "The posture is the strongest the toolchain can express, not just the absence of known-bad: every defensible safety runs in the gate, a dropped one is recorded."
scope: global
load: conditional
triggers:
  [security, hardening, harden, posture, scanner, sast, static-analysis, sbom, supply-chain, audit, advisory, cve, fuzzing, lint, gate, input, injection, sanitize, validation]
applies-to: [".claude/rules/security.md", ".claude/rules/core-principles.md", ".claude/rules/dependencies.md"]
supersedes: []
superseded-by: null
---

## Context

Grep this governance for what it demands of security and the answer is a **floor** — the absence of
known-bad, everywhere:

- `rule:security` — *"advisories block the push"*, *"validate every input at the trust boundary"*. A
  finding is caught; a known-bad input is rejected.
- `rule:dependencies` — *"reject anything with a known unpatched CVE"*, *"a new advisory blocks the push"*.
- `rule:code-quality` — *"zero tolerated warnings"*, *"Dead code: none"*.
- `ADR-CORE-011` — least-privilege capabilities, strict CSP, keyring, HTTPS-only.

Every one of those answers the same question — *is there anything **known** to be wrong?* — and blocks
when the answer is yes. That is necessary and it is not sufficient. **Nothing here obliges a project to
turn the toolchain up to the strongest posture it can express**: to *enable* the analyses that find the
unknown-bad, not merely to react to the known one. The difference between *"the scanners we run are green"*
and *"we run every scanner that carries its weight"* is exactly the defect surface this ADR closes — and it
is nowhere written down as an obligation.

It was also **unreachable as an obligation.** An agent scaffolding a new project's gate types `security`,
`hardening`, `scanner`, `sast`, `posture` — and the governance handed it the floor rules and stopped. No
document told it: *the default posture is the maximum the toolchain supports, and anything less is a
decision you must record.* An agent cannot honour a ceiling nobody stated.

## Decision

**The security posture is the strongest the toolchain can express — not the absence of known-bad.**

Every safety a project's toolchain offers **that carries its weight** is *enabled by default* and wired
into the one gate (`check:all`, pre-commit + pre-push, ADR-CORE-008), where it **reports *and* blocks** —
never merely warns. Stated in stack-agnostic categories, because the core may name no stack (ADR-CORE-033):

- **Static analysis / SAST** beyond the compiler's own diagnostics.
- **Supply-chain, advisory and secret scanning**; **dependency vetting and provenance**; an **SBOM**.
- **Compiler / linker hardening** the platform offers, and **memory-safety constraints** where the
  language has an escape hatch to forbid.
- **The strictest lint and type rulesets** the language supports (building on `--max-warnings 0`).
- **Fuzzing** for anything that parses untrusted input.
- **Untrusted-input handling at every trust boundary** — validated on the way in (rule:security),
  encoded on the way out — with every client treated as hostile even when we wrote it.

Four constraints make this an obligation an agent can actually discharge rather than a slogan:

- **Report-and-fix, never suppress-to-green.** A finding is fixed or escalated to the maintainer, never
  auto-silenced. This is not new — `rule:security` and `rule:dependencies` already forbid it — and it is
  the hinge the whole ADR turns on: a ceiling reached by muting the tools that report on it is lower than
  the floor.
- **A dropped safety is on the record, never silent.** The default is *on*. Turning one off — because it
  is inapplicable, or its false-positive rate would do more harm than good — is a **recorded,
  maintainer-visible decision** (`governance/opt-out.json` for governed config, or the feature's ADR), not
  an implicit omission. This is what *"without exception"* means once it is made honest: not that every
  tool must run, but that every tool that does **not** run leaves a reason a reviewer can see.
- **Defensible, not maximal-literal.** A tool whose noise trains people to suppress findings, or pushes
  them to `--no-verify` (rule:git-workflow), is a **net regression** — it lowers the real posture while
  raising the nominal one. *"Defensible"* excludes it. The boundary is the same floor-vs-noise judgement
  `rule:security` already draws, made once, on the record, not rediscovered per finding.
- **The obligation is portable; the mechanism and its gate are the stack's.** *Which* SAST, which SBOM
  tool, which hardening flags — each names a stack, so the concrete list and the `check:all` wiring that
  enforces it live in the app/stack layer (ADR-CORE-033), the only layer that can see the toolchain and
  therefore the only one that can gate this. The core states the ceiling and **cannot check it** — that is
  a layer boundary, not an oversight (identical in shape to ADR-CORE-037).

## Alternatives

- **"Literal maximum — every available tool on, no opt-out."** Rejected, and it is the request's first
  framing. It sounds stronger and is weaker: a tool with a high false-positive rate trains the team to
  suppress — the exact anti-pattern `rule:security` and `rule:dependencies` forbid — and a pre-commit
  bloated with every scanner gets bypassed with `--no-verify` (`rule:git-workflow`). A posture is only as
  strong as the findings people still read. *Defensible* ≠ *maximal-literal*, and the difference is the
  whole point.
- **A new standalone principle (#13).** Rejected: it would split the security topic across two principles,
  #6 saying *"secure by design"* and #13 saying *"…but more"*. This is not a second subject; it is #6
  **sharpened from floor to ceiling**, and it belongs in one home (ADR-CORE-005). Extending #6 still lands
  the ceiling vocabulary in every agent's always-loaded context, which is the only reason to touch a
  principle at all.
- **Put the whole thing in the stack layer.** Rejected, and this is load-bearing (as in ADR-CORE-037):
  *that the posture must seek the ceiling* is equally true of a CLI, a service and a desktop app — it names
  no framework. Pushing it downstream would force it to be **rewritten identically in every stack layer**,
  the duplication ADR-CORE-005 exists to prevent. Only the *tool list* names a stack, and only the tool
  list goes there.
- **Gate it in the core.** Rejected as **impossible**, not undesirable. A check that "every defensible
  scanner is enabled" must know which scanners this stack *has*, and the core may not (ADR-CORE-033). The
  gate is therefore an obligation **on the stack layer**, stated as such, so a future agent reads the
  absence of one here as a layer boundary — not an oversight to fix by teaching the core about a stack.
- **Leave the floor as-is.** Rejected: a floor answers *"any known-bad?"* and is silent on *"did we enable
  everything that finds the unknown-bad?"*. The most expensive defect is the one no enabled tool was
  looking for — and by ADR-CORE-004, *"it is probably secure"* is the guess this governance forbids.

## Consequences

- **Core principle #6 gains the ceiling clause** — the always-loaded vocabulary, because an agent wiring a
  new project's gate never thinks *"is this the strongest posture the toolchain can express?"* unless the
  always-on context puts the question in front of it.
- **`rule:security` gains the operational obligation** (enable every defensible safety, wire it into
  `check:all`, record a dropped one, never suppress) **and broadened triggers** (`hardening`, `scanner`,
  `sast`, `sbom`, `posture`, `input`, `injection`) so a hardening task actually loads it.
- **Consumers must act:** every stack layer publishes the concrete safety set for its toolchain, wires it
  into its `check:all` (pre-commit + pre-push), **gates** it, and records any deliberately dropped safety.
  A leaf project verifies every defensible safety its stack layer offers is on, and records the ones it
  drops. Briefing: [`docs/migrations/core-010-maximum-defensible-posture.md`](../migrations/core-010-maximum-defensible-posture.md).
- **Not gate-enforceable in this layer** — stated openly, here and in the rule, so it is not mistaken for a
  gap.

## References

- [ADR-CORE-008](core-008-quality-pipeline.md) — the one gate this posture is wired into.
- [ADR-CORE-009](core-009-dependency-policy.md) · `rule:dependencies` — the advisory/CVE floor this builds
  on and the *"never auto-suppress"* rule it leans on.
- [ADR-CORE-011](core-011-security-by-design.md) · `rule:security` — the input/secret/least-privilege floor;
  the operational form of this ADR lives there.
- [ADR-CORE-033](core-033-governance-layers-cascade.md) — why the ceiling is portable and the tool list is
  not.
- [ADR-CORE-005](core-005-reusability-policy.md) — why this is not rewritten once per stack layer.
- [ADR-CORE-004](core-004-verify-first-no-guessing.md) — *"probably secure"* is not a verification.
- [ADR-CORE-037](core-037-no-silent-death.md) — the same obligation/mechanism split, and the same reason
  the core cannot gate it.
