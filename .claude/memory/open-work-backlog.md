---
id: mem:open-work-backlog
title: Open follow-up work on the shell
tldr: "Backlog: no macOS signing secrets; a second, non-Tauri consumer would be the first real proof the core is portable. The cascade itself is live and green."
scope: project
load: conditional
triggers:
  [
    backlog,
    open,
    follow-up,
    todo,
    gap,
    signing,
    notarisation,
    release,
    template,
    scope,
    next,
    althing,
    ivaldi,
    upstream,
  ]
applies-to: [".github/workflows/**", "app.identity.json", ".claude/memory/**", "governance/**"]
type: project
---

# Open work

- **No code signing / notarisation** configured. `release.yml` supports macOS signing when the `APPLE_*`
  secrets are set (ADR-APP-023); none are set yet.
- **The core is not yet *proven* portable.** `althing` is stack-agnostic by construction and by gate, but
  no project outside this desktop stack consumes it. Until one does, "portable" is a claim backed by a
  check, not by a user. (Tracked in althing's own `PLAN.md`.)
- **Product definition is per-fork:** a new project defines its purpose on top of the shell and renames
  the identity via `app.identity.json` (ADR-APP-031).

## The cascade is live — do not re-derive it

```
kaoszwerg/althing            owns 'core'  (private, GitHub template)
   └── kaoszwerg/saga-rust-template   owns 'app'   ← this repo
          └── kaoszwerg/ivaldi        leaf, owns nothing
```

- **`ivaldi`'s upstream stays `saga-rust-template`.** Repointing it at `althing` would strip the entire
  app layer out of it. It needs no `governance/config.json` — a leaf is derived from the manifest.
- Core files (`CLAUDE.md`, the agnostic rules/ADRs, `scripts/`) are **read-only here**. Improve them in
  `althing`, then `npm run governance:update`. The drift-gate refuses the in-place edit and names the
  three real options (overlay, upstream it, opt out).
- A **new project** starts from the `althing` template and must immediately run
  `npm run governance:init -- --from kaoszwerg/althing`. Without it the copy keeps `upstream: null`,
  quietly owns a private fork of the core, stays green, and never receives another update.

**Why:** These are known gaps, not oversights — recording them keeps a later agent from "fixing" them by
inventing infrastructure the owner has not asked for.

**How to apply:** Pick items from here only when the owner asks; do not expand scope on your own.
