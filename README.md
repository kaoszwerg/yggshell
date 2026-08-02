# YggShell

**The everyday terminal for agentic development.**

A cross-platform (Windows / macOS / Linux) developer terminal, and a genuine replacement for the
system one: independent tabs, iTerm2-compatible colour themes with an editor, per-terminal
configuration, and tmux sessions that outlive the app — including a crash.

**What it adds is the work that surrounds the terminal.** Running an agentic workflow means watching a
repository, a directory, a set of processes and ports, some containers, and what the harness itself is
doing — normally across half a dozen windows. Here each of those is a tool in the sidebar, beside the
shell rather than instead of it, reading the same directory the shell is in and refreshing when a
command ends.

The terminal is the substrate; the sidebar is the product.

## What it does today

**Terminal.** Independent tabs, full VT/ANSI, mouse reporting, search, links, copy-on-select,
iTerm2-compatible themes and an editor, per-tab colour scheme and profile, rebindable shortcuts, a
crash-safe last-resort handler in both runtimes. Launch a tab anywhere with `ygg <dir>`, from Finder's
"Open With", or from the "New Terminal Here" service.

**tmux, properly.** A tab can attach to or create a session; a restored tab returns to *its own*
session by name after a crash; a tab that was not in tmux comes back that way. A tool lists every
running session with what it is running, attaches to one, renames it (carrying the tabs across) or
ends it behind a confirmation. Closing a tab detaches — closing the app never kills a session.

**Sidebar tools**, each reading the front tab's directory:

| Tool | What it answers |
| --- | --- |
| **Git** | Branch, changed files, history graph, diffs and commits in a terminal colour scheme |
| **Files** | The tree, read here with syntax highlighting, opened in a terminal, or revealed |
| **Activity** | What this tab is running, and which ports it holds |
| **Docker** | Containers, their state, CPU and memory |
| **Agent** | What the AI harness is doing, its context and usage — and what it is waiting for |
| **tmux** | Every session on the machine, and what to do with it |

**Attention that reaches you.** A harness asking for something marks *its* tab — gold when it is
blocked on an answer, green when it merely finished — and the mark clears itself when the agent carries
on. It works while the window is in the background, which is the only time it matters.

**Status bar.** A row of small readings you arrange yourself: version, repository, running command,
directory, tmux session, machine load, waiting tabs.

## Where it is going

It is built to be **used every day and extended continuously**. The direction is always the same: fewer
windows for the same work. Anything that would otherwise mean leaving the terminal — to look something
up, to check a state, to see what a process is doing — is a candidate for the sidebar, provided it can
be answered at a glance and read without being managed.

Two things it deliberately does not do: it does not edit, and it does not run commands of its own
choosing. A tool that starts and stops things, sitting next to an agent that already does, is a
combination this project keeps declining (ADR-PROJ-001 §5). The one exception, made deliberately, is
handing a file to the platform's default application — recorded where it is implemented.

## Tech stack

| Layer | Choice |
| --- | --- |
| Desktop shell | [Tauri 2](https://tauri.app) (system WebView, frameless HUD window) |
| Backend | Rust — logging (`tracing`), settings (atomic JSON), tray, typed commands |
| Frontend | React 19 + TypeScript + Vite, Tailwind 4, Zustand, TanStack Query |
| Type safety | `ts-rs` generates the TS boundary types from the Rust DTOs (single source of truth) |
| Quality | ESLint, Prettier, Vitest, Clippy, rustfmt, knip, secretlint, cargo-deny, cargo-audit |
| Governance | ADRs, rules and repo-resident memory with generated, hash-checked indexes |

## Getting started

### Prerequisites

- **Node.js ≥ 20.19** and npm (the version `package.json#engines` requires)
- **Rust** (stable) with the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your
  platform

### Run

```bash
npm ci
npm run app:dev     # dev build — own identifier, DEV badge in the title bar
```

### Build

```bash
npm run app:build   # installers under src-tauri/target/release/bundle/
```

### Quality gate

```bash
npm run check:all
```

Runs version sync, typecheck, ESLint, Prettier, Vitest, knip, secretlint, the governance checks,
rustfmt, Clippy, the Rust tests, cargo-deny and cargo-audit. Pre-commit hooks (husky + lint-staged)
enforce the same rules — never bypass them with `--no-verify`.

## Layout

```
src/                 React frontend — views, components, hooks, store, styles
  api/commands.ts    typed wrappers around the Tauri commands
  bindings/          GENERATED from the Rust DTOs (npm run gen:types)
src-tauri/src/       Rust backend
  lib.rs             app assembly: plugins, state, tray, command surface
  logging.rs         tracing -> console + rotating JSON file + live UI stream
  settings.rs        atomically persisted JSON settings
  commands/          the IPC surface
docs/adr/            architecture decision records (+ generated index)
.claude/             rules and repo-resident memory (+ generated indexes)
scripts/             governance and version tooling
```

## Adding a feature

1. Backend: a module under `src-tauri/src/`, its DTOs in `dto.rs`, its commands in `commands/`.
2. `npm run gen:types` to regenerate the TypeScript bindings.
3. Frontend: a view under `src/views/`, one entry in the sidebar nav, one branch in `App.tsx`.
4. Tests, an ADR if the decision is structural, then `npm run check:all`.

## Governance

YggShell consumes its governance from `kaoszwerg/saga-rust-template` (which in turn consumes the
stack-agnostic core from `kaoszwerg/althing`) — see [`CLAUDE.md`](CLAUDE.md) and ADR-CORE-033. Pull
updates with `npm run governance:update`; governance that is true only for YggShell goes in the
project line (`.claude/rules/project/`, `docs/adr/project/`).

## Licence

Private and proprietary — see [LICENSE](LICENSE).
