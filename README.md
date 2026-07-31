# YggShell

**Developer terminal for AI harnesses.**

A cross-platform (Windows / macOS / Linux) developer terminal: a genuine replacement for the system
terminal — multiple independent tabs, each launchable with its own iTerm2-compatible colour theme,
plus a theme editor and granular per-terminal configuration — whose defining purpose is to **enrich AI
development harnesses** (Claude Code) with tools in the sidebar.

The terminal is the substrate; the sidebar is the product.

## Status

**The application shell is complete; nothing of the product is built yet.** What runs today is the
frameless HUD window, navigation rail, Home / Logs / Settings views, About dialog, tray icon with
close-to-tray, live log streaming, JSON-persisted settings, and the full governance + quality pipeline.

Agreed order of work:

1. **The terminal component with multiple independent tabs** — the full feature set of a real terminal,
   not a reduced emulation.
2. **The first sidebar widget: a Git integration** — the current branch visualised the way VS Code does
   it, the list of changed files, and below it the branch history with each branch's position and the
   divergence between branches drawn out.

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
