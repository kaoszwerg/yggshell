# saga-rust-template

**The shell, ready for a product.**

A cross-platform desktop application shell (Windows / macOS / Linux): frameless HUD window,
structured logging, persisted settings, tray integration, typed IPC — and no domain logic. It runs,
it looks finished, and it does nothing yet, which is exactly the point: the product is built on top
of it.

> `saga-rust-template` is a working title. The final name and the app's purpose are decided in a later step; the
> rename checklist is in [`.claude/memory/project-scope.md`](.claude/memory/project-scope.md).

## Status

The shell is complete: window chrome, navigation rail, Home / Logs / Settings views, About dialog,
tray icon with close-to-tray, live log streaming, JSON-persisted settings, and the full governance +
quality pipeline. No product features exist.

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

- **Node.js ≥ 22** and npm
- **Rust** (stable) with the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your
  platform

### Run

```bash
npm install
npm run app:dev     # dev build — own identifier, DEV badge in the title bar
```

The first run compiles the Rust backend and writes `src-tauri/Cargo.lock`; commit that file.

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

## Create a project from this template

Starting a new product from this shell? Run the **`/bootstrap`** agent command in Claude Code, or
follow [`docs/howto/new-project-from-template.md`](docs/howto/new-project-from-template.md). Bootstrap
removes this section and that howto (they are template-creation artifacts), so a bootstrapped fork
carries neither.

## Licence

Private and proprietary — see [LICENSE](LICENSE).
