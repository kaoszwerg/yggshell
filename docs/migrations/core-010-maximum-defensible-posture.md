# core-010 — the security posture seeks the ceiling, not the floor (ADR-CORE-039)

## What changed

The core used to demand a **floor**: no known CVE, advisories block the push, zero warnings, inputs
validated. It never demanded the **ceiling** — that a project *enable* every analysis its toolchain can
express, not merely stay green on the few it happens to run. `ADR-CORE-039` and core principle #6 now make
the maximum defensible posture the default, and a deliberately dropped safety a recorded decision.

The core states the **obligation** and, by design, **cannot check it** — it may name no stack, so it cannot
know which scanners your toolchain has. **The mechanism and its gate are yours.**

## What you must do

**If you own a stack/app layer** (you publish a shell others consume):

1. Publish an app-layer rule **and** ADR (`ADR-APP-NNN`) that names the concrete safeties for your
   toolchain — the SAST, the supply-chain/secret scanners, the dependency-vetting/provenance tool, the
   SBOM generator, the compiler/linker hardening flags, the strictest lint/type rulesets, fuzzing for
   untrusted-input parsers. Cite `ADR-CORE-039` as the obligation you are implementing.
2. **Wire every one of them into `check:all`** (pre-commit fast subset + pre-push full), where they
   **report and block** — never merely warn.
3. **Gate it.** The core cannot; your layer is the only one that can. A missing or disabled safety must
   fail `check:all`, not pass silently.
4. **Record every dropped safety.** A safety you deliberately do not enable — inapplicable, or too noisy to
   be net-positive — is opted out visibly (`governance/opt-out.json` for governed config, or the feature's
   ADR), never omitted in silence. Default on; off needs a reason a reviewer can see.
5. Ship an **app-layer briefing** (`app-NNN-<slug>.md`) telling *your* consumers what their gate now
   enforces and how to record a drop.

**If you are a leaf project** (you consume a stack layer, own no layer): verify every defensible safety your
stack layer offers is enabled in your `check:all`, and record — via `governance/opt-out.json` or an
`ADR-PROJ-NNN` — any you deliberately drop. No silent omissions.

## What is now forbidden

- **Suppressing a scanner finding to make the gate green.** Fix it or escalate to the maintainer
  (rule:security, rule:dependencies) — never auto-silence.
- **Disabling a safety without a recorded reason.** An off switch with no opt-out entry / ADR is a silent
  omission, and is exactly what ADR-CORE-039 closes.
- **Treating "no known CVE" as a security posture.** That is the floor; the posture is the ceiling.

## The line to hold — defensible, not maximal-literal

Do **not** read this as *"turn on every tool that exists"*. A scanner whose false-positive rate trains the
team to suppress findings, or pushes anyone toward `--no-verify` (rule:git-workflow), **lowers** the real
posture while raising the nominal one — enabling it is a regression, and dropping it (on the record) is the
correct call. The obligation is the strongest **defensible** posture, decided once and written down, not a
tool count.
