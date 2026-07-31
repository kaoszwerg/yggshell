---
id: mem:project-scope
title: YggShell scope summary
tldr: "A developer terminal on the saga-rust-template shell: full terminal tabs + iTerm2 themes, and sidebar tools that enrich AI harnesses (Claude Code)."
scope: project
load: core
type: project
---

# YggShell — scope summary

**One-line:** `YggShell` is a cross-platform **developer terminal**: a genuine replacement for the
system terminal — multiple independent tabs, each launchable with its own iTerm2-compatible colour
theme, plus a theme editor and granular per-terminal configuration — whose **defining purpose** is to
enrich **AI development harnesses** (in the maintainer's case, Claude Code) with tools in the sidebar.

The terminal is the substrate; the sidebar is the product. A feature earns its place by making working
in an AI harness better, not by being a terminal feature someone could name.

## Its place in the governance cascade (ADR-CORE-033)

```
kaoszwerg/althing              owns 'core' — stack-agnostic
   └── kaoszwerg/saga-rust-template   owns + publishes 'app' (the Tauri/HUD shell)
          └── kaoszwerg/yggshell      ← this repo: a LEAF. Owns no layer.
```

This repo **consumes and publishes nothing**: `governance/config.json` says
`upstream: kaoszwerg/saga-rust-template`, `layer: null`. Every core *and* app file — `CLAUDE.md`, the
rules, the ADRs, `scripts/`, `eslint.config.mjs` — is **read-only here**. An in-place edit is drift and
the gate refuses it; improve it upstream and `npm run governance:update`, or diverge one of the four
legal ways (rule:upstream-changes).

**Never repoint the upstream at `althing`.** `saga-rust-template` is the only publisher of the app
layer; pointing at the core would strip the entire desktop shell governance out of this repo.

## What exists today (inherited from the shell, no product code)

- Frameless HUD window (custom title bar, sidebar rail, status bar, About dialog); an **optional**
  system tray + close-to-tray behind the `minimize_to_tray` setting (default off); persisted geometry.
- Typed IPC surface (`app_version`, `build_info`, `get_recent_logs`, `get_settings`, `update_settings`,
  `open_external`) with `ts-rs`-generated TypeScript bindings.
- Logging per ADR-APP-025: console + rotating JSON file + in-memory ring buffer streamed live into the
  Logs view.
- Settings persisted as an atomically written JSON document under the OS app-data dir.
- Single-source app identity (`app.identity.json` → `identity:sync`, ADR-APP-031).

## What is NOT built yet

**Everything.** No PTY, no tabs, no theme parsing, no theme editor, no sidebar widgets — the product is
entirely ahead. The agreed order is:

1. **The terminal component with multiple independent tabs**, at the full feature set of a real
   terminal — explicitly *not* a reduced emulation.
2. **The first sidebar widget: a Git integration** — the current branch visualised the way VS Code
   does it, a list of changed files, and below it the branch history showing where each branch stands,
   with the divergence between branches drawn out.

Everything else (iTerm2 theme import, the theme editor, granular per-terminal config, further sidebar
tools) is discussed before it is built.

**Why:** the shell is deliberately domain-free, so the product is defined on top of a running, governed
base — and scope drift into half-features stays visible immediately.

**How to apply:** before adding anything, check it against this file. If it is not the agreed milestone
and not shell infrastructure, it is not in scope yet — ask (rule:clarify-and-plan). Governance for
**this** project goes in the project line (`.claude/rules/project/`, `docs/adr/project/`); governance
for every project on this stack belongs upstream in `saga-rust-template`, never here.
See [[open-work-backlog]].
