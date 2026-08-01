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

## What exists today

The product is real and in daily use — the maintainer works in it while it is being built
(rule:live-app). `PLAN.md` holds the phase-by-phase detail; this is the shape of it.

- **The terminal** (ADR-PROJ-001): real PTY per tab, `@xterm/xterm`, independent tabs in the title
  bar, scrollback search, copy/paste on the platform's own keys, OSC 0/2 titles, OSC 7 working
  directory — and inside tmux the directory comes from tmux itself, because the passthrough hook was
  measured and does not work ([[open-work-backlog]]).
- **Terminal configuration:** shell picked from a list the backend produced, iTerm2 `.itermcolors`
  import by drag-and-drop, a 22-colour theme editor with live preview, and named profiles overriding
  shell, directory and theme.
- **The Git tool** — so far the only sidebar tool: branch with ahead/behind, staged and unstaged
  changes, a drawn history of every local branch with lanes and merges, and a diff for any changed
  file or whole commit.
- **The shell around it:** frameless HUD window, configurable status bar (drag-and-drop editor,
  spacers, system load, tmux session, working directory), rebindable keyboard shortcuts that can
  never take a key the shell needs (rule:shortcuts), English/German throughout (rule:i18n), rendered
  changelog and credits, crash handling on both runtimes (ADR-APP-032), logging into console + file +
  a live Logs view.
- **Getting in from outside:** `ygg` / `yggshell` on the command line, Finder's *Open With* and *New
  Terminal Here* — all converging on one validated path (rule:launching).
- **32 typed IPC commands**, `ts-rs`-generated bindings, settings as an atomically written JSON
  document, single-source identity (`app.identity.json`).

## What is not built

- **Further sidebar tools — PLAN.md Phase 5, deliberately undecided.** Candidates and the
  measurements behind them are listed there; none is agreed. This is the part where the product is
  still ahead of itself, and it is the part that decides whether the app achieves its purpose.
- **Split panes and session persistence across restarts** — explicitly outside milestone 1.
- **Windows and Linux behavioural verification** — deferred by the maintainer; only macOS is proven.
- **Remote branches in the Git graph**, and a shell-integration hook for fish.

**Why:** the shell is deliberately domain-free, so the product is defined on top of a running, governed
base — and scope drift into half-features stays visible immediately.

**How to apply:** before adding anything, check it against this file. A **sidebar tool** is the
product and needs a decision from the maintainer before it is built (`PLAN.md` Phase 5,
rule:clarify-and-plan) — never guess one into existence. A **terminal** feature that nobody asked for
is scope drift even when it is a good idea. Governance for **this** project goes in the project line
(`.claude/rules/project/`, `docs/adr/project/`); governance for every project on this stack belongs
upstream in `saga-rust-template`, never here. See [[open-work-backlog]].
