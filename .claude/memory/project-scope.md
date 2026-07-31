---
id: mem:project-scope
title: saga-rust-template scope summary
tldr: "A governed, reusable Tauri 2 + React HUD desktop shell. It owns the 'app' layer, consumes the agnostic core from althing, and publishes both to its forks."
scope: project
load: core
type: project
---

# saga-rust-template — scope summary

**One-line:** `saga-rust-template` is a reusable, cross-platform (Windows/macOS/Linux) desktop
application shell — HUD UI, structured logging, settings persistence, single-source app identity, full
quality gate — with **no product features**. New projects are created from it and renamed.

## Its place in the governance cascade (ADR-CORE-033)

```
althing  (owns 'core' — stack-agnostic)
   └── saga-rust-template  (consumes 'core', OWNS + publishes 'app')   ← this repo
          └── ivaldi       (leaf project; owns no layer)
```

This repo is a **consumer and a publisher at the same time**:

- It **consumes** the agnostic core (`CLAUDE.md`, the portable rules/ADRs, the governance scripts). Those
  files are **read-only here** — an in-place edit is drift. Improve them in `althing`, then
  `npm run governance:update`.
- It **owns** the **`app` layer**: the Tauri/Rust/React/HUD governance (ADR-APP-001, 020, 021, 023, 025, 026,
  031; `rust-conventions`, `theming`, `ui-design`, `frontend-architecture`, `cross-platform`,
  `stack-tauri`, `stack-release`), `sync-version.mjs`, `sync-identity.mjs`, `bootstrap.mjs`,
  `eslint.config.mjs`, `knip.config.js`, `deny.toml`, the CI/release workflows. It pins them with
  `governance:sync` and publishes them to its forks.
- **`ivaldi` must never be repointed at `althing`.** Its upstream is this repo — the only publisher of
  the app layer. Pointing it at the core would strip the entire desktop shell out of it.

## What exists today

- Frameless HUD window (custom title bar, sidebar rail, status bar, About dialog); an **optional**
  system tray + close-to-tray behind the `minimize_to_tray` setting (default off); persisted geometry.
- Typed IPC surface (`app_version`, `build_info`, `get_recent_logs`, `get_settings`, `update_settings`,
  `open_external`) with `ts-rs`-generated TypeScript bindings.
- Logging per ADR-APP-025: console + rotating JSON file + in-memory ring buffer streamed live into the Logs
  view.
- Settings persisted as an atomically written JSON document under the OS app-data dir.
- **Single-source app identity** (`app.identity.json` → `identity:sync`, ADR-APP-031).

## What it is not (yet)

- No domain logic, no network calls, no database. A project's purpose is defined on top of this shell.

## Renaming a new project (ADR-APP-031)

Edit `app.identity.json`, then run `node scripts/bootstrap.mjs --upstream <owner/repo>` +
`npm run identity:sync` (the `/bootstrap` agent prompt does this, plus icons). Everything else is
derived; `identity:check` guards drift.

**Why:** the shell is deliberately domain-free, so a new product is defined on top of a running, governed
base — and scope drift into half-features stays visible immediately.

**How to apply:** before adding anything to a fresh copy, check it against this file: if it is not shell
infrastructure and not part of an agreed feature, it does not belong yet. Governance for **this** project
goes in the project line (`.claude/rules/project/`, `docs/adr/project/`); governance for **every** project
belongs in `althing`, never here.
