---
id: mem:open-work-backlog
title: Open follow-up work on YggShell
tldr: "Backlog: the three upstream fixes are done (shipped in v0.10.3) — do not re-report them; no macOS signing secrets; the terminal itself is still unbuilt."
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
    scope,
    next,
    althing,
    saga-rust-template,
    upstream,
    adopt,
    governance-update,
  ]
applies-to: [".github/workflows/**", "app.identity.json", ".claude/memory/**", "governance/**"]
type: project
---

# Open work

- **The upstream is private, and only the `kaoszwerg` credential can read it.** `governance:update`
  clones over HTTPS; under any other GitHub account it fails with `Repository not found`. Switch first
  (`gh auth switch --user kaoszwerg`), then update. The one-time `--adopt` has already run.

## The three upstream fixes are DONE — do not re-report them

All three defects in `docs/upstream-report.md` were accepted and shipped in
`saga-rust-template` v0.10.3, pulled here on 2026-07-31. Nothing is owed upstream any more.

- `sync-identity.mjs` now scans `src-tauri/examples/` and has `scripts/sync-identity.test.mjs`
  pinning it. Arrived with the update; nothing to do.
- The crash-report collision and the Node-Web-Storage shim concern **project-owned** files
  (`src-tauri/src/crash.rs`, `src/test/setup.ts`), so `governance:update` cannot fix them for a fork.
  They ship as briefings — `docs/migrations/app-107-*`, `app-108-*` — and were ported by hand here.
- **The upstream's Web Storage shim replaced ours, on purpose.** Ours re-pointed the globals at
  jsdom's Storage via `globalThis.jsdom` — a vitest internal — and probed the existing value first,
  which throws on Node ≤ 25. The upstream installs an in-memory `Storage` unconditionally, guarded
  only on `typeof document`. Do not "simplify" it back: `app-108` says exactly why each part is
  load-bearing.
- **No code signing / notarisation** configured. `release.yml` supports macOS signing when the `APPLE_*`
  secrets are set (ADR-APP-023); none are set yet.
- **The terminal is unbuilt.** See [[project-scope]] for what is agreed and what is not.

**Why:** These are known gaps, not oversights — recording them keeps a later agent from "fixing" them by
inventing infrastructure the maintainer has not asked for.

**How to apply:** Pick items from here only when the maintainer asks; do not expand scope on your own.
