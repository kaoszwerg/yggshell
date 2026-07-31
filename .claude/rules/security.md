---
id: rule:security
title: Security
tldr: "Validate every input at the boundary; least privilege; secrets in the keyring; advisories block the push; every defensible safety on, a dropped one recorded."
scope: global
load: conditional
triggers: [security, secret, redaction, capability, permission, network, path, boundary, threat, hardening, harden, posture, scanner, sast, sbom, static-analysis, fuzzing, input, injection, sanitize, validation, audit]
applies-to: []
---

# Security (ADR-CORE-011)

- **Every boundary validates its input.** Anything crossing from a less-trusted context (a UI, a
  network, a file, a user) is validated at the point it enters — never deeper, never "the caller checked
  it". Treat the client as hostile even when you wrote it.
- **Least privilege.** A permission, capability or scope is granted only when a feature actually needs
  it, and only as wide as that feature requires. The default posture is deny.
- **Secrets.** Credentials belong in the OS keyring — never in the binary, in a config or data file, in
  logs, or in a client. A client may learn *that* a credential exists, never its value.
- **Filesystem.** Write only inside the location the platform designates for the app's data, resolved
  through the platform API — never next to the binary, never to a path supplied by a client without
  validation. Canonicalise any user-supplied path and verify it against an allowed root (no traversal).
- **Network.** HTTPS only, with an explicit timeout on every request.
- **Threat model per feature.** Every feature that adds an input, a capability, a network host or a
  stored secret records its trust boundary and the abuse cases it defends against — a short note in the
  feature's ADR. The posture is decided up front, not patched after a report.
- **Advisories block the push.** The supply-chain and secret scanners run in `check:all` and before every
  push. A finding **stops the push** and goes to the maintainer, who decides the course (patch, upgrade,
  replace, or an explicit, time-boxed, recorded exception). **Never silence or auto-suppress a finding to
  make the gate green** (rule:dependencies).

## Maximum defensible posture (ADR-CORE-039)

The rules above are the **floor** — the absence of known-bad. The posture is the **ceiling the toolchain
can express**: every safety the project's toolchain offers that carries its weight — static analysis /
SAST, supply-chain and secret scanning, dependency vetting and provenance, an SBOM, compiler/linker
hardening, the strictest lint/type rulesets, fuzzing for anything that parses untrusted input, and
output-encoding on every value that leaves a boundary — is **enabled by default and wired into `check:all`**
(pre-commit + pre-push), where it **reports and blocks**, never merely warns.

- **Never suppress to green.** A finding is fixed or escalated to the maintainer, never auto-silenced (as
  in *Advisories block the push*, above; rule:dependencies). A ceiling reached by muting the tools that
  report on it is lower than the floor.
- **A dropped safety is on the record.** Turning a safety off — because it is inapplicable, or its
  false-positive rate would do more harm than good — is a **recorded, maintainer-visible decision**
  (`governance/opt-out.json` for governed config, or the feature's ADR), never an implicit omission.
  Default on; off needs a reason. This is what *"without exception"* means once it is honest.
- **Defensible, not maximal-literal.** A tool whose noise trains people to suppress findings, or pushes
  them to `--no-verify` (rule:git-workflow), is a **net regression** — it lowers the real posture while
  raising the nominal one. *"Defensible"* excludes it; the boundary is the same floor-vs-noise judgement
  drawn above, made once and written down.

**The concrete mechanisms** — which keyring, which capability file, which CSP, *which scanners and hardening
flags, and the gate that runs them* — are the stack layer's business (ADR-CORE-033): the only layer that can
see the toolchain, and so the only one that can wire the posture into its `check:all` and gate it. The
obligations above are not the stack's to reinterpret — they are portable, and they hold everywhere.
