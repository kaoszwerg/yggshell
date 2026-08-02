---
id: mem:project-scope
title: YggShell scope summary
tldr: "The everyday terminal for agentic development: real terminal tabs, tmux that survives, sidebar tools replacing the windows around the shell. Built to grow."
scope: project
load: core
type: project
---

# YggShell — scope summary

**One-line:** `YggShell` is **the everyday terminal for agentic development** — a genuine replacement
for the system terminal (independent tabs, iTerm2-compatible themes and an editor, per-terminal
configuration, tmux sessions that outlive the app) whose **defining purpose** is to put the work that
*surrounds* the terminal beside it: the repository, the files, the processes and ports, the containers,
the sessions, and what an AI harness such as Claude Code is doing right now.

The terminal is the substrate; the sidebar is the product. A feature earns its place by making working
in an AI harness better, not by being a terminal feature someone could name.

## The goal, and what it settles (stated 2026-08-02)

**It is built to be used every day and extended continuously.** Not a demo, not a shell to be
completed and left: the direction is always *fewer windows for the same work*, and anything that would
otherwise mean leaving the terminal — to look something up, to check a state, to see what a process is
doing — is a candidate.

That answers a question this project kept re-asking, and answering too narrowly. **"Is this too much
for a terminal?" is the wrong test**; the product is a development environment, and the right test is
whether it removes a window. Two decisions were reversed on exactly that reasoning, both after the
narrow answer had been argued and both by the maintainer:

- **Files may be opened.** The tool was deliberately limited to reveal-and-copy; a PDF or an image now
  opens with the platform's default application, and a text file is read inline with highlighting
  instead. The security argument against the first (the *file* chooses the program) is recorded where
  it is implemented rather than deleted — it was overruled, not refuted.
- **A panel that is on screen must be current.** "Read on demand, never on a timer" was a defensible
  cost argument and the wrong trade: a panel you must click to trust is right at the instant you click
  it and wrong every instant after (see [[surfaces]]).

**What still holds, and is not up for the same reversal:** the interface does not edit, and it does not
choose what runs (ADR-PROJ-001 §5). A tool that starts and stops things, next to an agent that already
does, is the combination this project keeps declining. Where a feature needs to put a command in a
terminal, it *types* it and the user presses Enter.

**Describing it to a user names the tool, never a person.** The About text, the README and the taglines
say what YggShell is and what it is for — not whose work it simplifies.

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
- **Five sidebar tools** — the product itself (see [[surfaces]] for what a *tool* is):
  **Git**, **Files** (the tab's tree, one directory per open), **Agent** (what the harness is doing,
  which Claude account, subscription usage, and switching that account), **Activity** (the process
  tree and listening ports — the whole tmux session where there is one) and **Docker** (containers by
  compose project). Every one of them **reads and does not act**: the terminal is beside the panel and
  already has every signal a process understands (ADR-PROJ-001 §5).
  The Git tool is the oldest and the deepest: branch with ahead/behind, staged and unstaged changes,
  a drawn history of every local branch with lanes and merges, and a diff for any changed file or
  whole commit.
- **The shell around it:** frameless HUD window, configurable status bar (drag-and-drop editor,
  spacers, system load, tmux session, working directory), rebindable keyboard shortcuts that can
  never take a key the shell needs (rule:shortcuts), English/German throughout (rule:i18n), rendered
  changelog and credits, crash handling on both runtimes (ADR-APP-032), logging into console + file +
  a live Logs view.
- **Two attention signals.** The terminal bell marks the tab that rang — the only signal that
  survives tmux, and it says no more than "something happened". A Claude Code **hook**, installable
  from the Agent tool, says *which* directory is waiting and *why*; it writes to a file, so events
  from a time the app was closed are there when it opens.
- **Getting in from outside:** `ygg` / `yggshell` on the command line, Finder's *Open With* and *New
  Terminal Here* — all converging on one validated path (rule:launching).
- **A typed IPC surface** (around fifty commands), `ts-rs`-generated bindings, settings as an atomically written JSON
  document, single-source identity (`app.identity.json`).

## What is not built

- **Further sidebar tools.** Five are built; `PLAN.md` Phase 5 lists what is left — worktrees, a
  session-scoped diff — and the two decisions deliberately *not* taken while building the rest:
  acting on a container (a command, so it needs an ADR) and remote branches in the graph. A new tool
  is still the maintainer's call, never guessed into existence.
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
