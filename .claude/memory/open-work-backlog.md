---
id: mem:open-work-backlog
title: Open follow-up work on YggShell
tldr: "Backlog: three fixes owed upstream (crash-report collision, Node>=26 tests, sync-identity misses examples/); no macOS signing secrets; the terminal is unbuilt."
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

## Three fixes that belong UPSTREAM in `saga-rust-template`

Each was found and fixed **here**, so every other fork still carries it. Upstreaming is a proposal to
the maintainer, never a commit the agent makes in the other repo (rule:upstream-changes §3). The
briefing to hand over is `docs/upstream-report.md`.

- **`crash.rs` could erase a crash report.** Report names came from a millisecond timestamp alone; two
  panics in the same millisecond (or two processes at once) collided and the second `fs::write`
  overwrote the first. Now claimed atomically with `create_new` + a bounded suffix search.
- **`src/test/setup.ts` — the whole suite is red on Node >= 26.** Node's own, unavailable
  `localStorage`/`sessionStorage` globals are non-enumerable and therefore survive vitest's jsdom
  population, shadowing jsdom's working Storage. `engines` allows Node 26, so any fork on a current
  Node hits it.
- **`sync-identity.mjs` misses `src-tauri/examples/`.** It rewrites the crate references in
  `src-tauri/src/main.rs` and `src-tauri/tests/contracts.rs` but not in `examples/crash_probe.rs`, so
  `cargo clippy --all-targets` breaks after every rename.
- **No code signing / notarisation** configured. `release.yml` supports macOS signing when the `APPLE_*`
  secrets are set (ADR-APP-023); none are set yet.
- **The terminal is unbuilt.** See [[project-scope]] for what is agreed and what is not.

**Why:** These are known gaps, not oversights — recording them keeps a later agent from "fixing" them by
inventing infrastructure the maintainer has not asked for.

**How to apply:** Pick items from here only when the maintainer asks; do not expand scope on your own.
