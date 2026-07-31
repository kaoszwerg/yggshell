# Implementation plan

## Phase 0 — Shell (done, inherited from `saga-rust-template`)

The running, empty, reusable application shell.

- [x] Repo, toolchain and quality gate (`check:all`): ESLint, Prettier, Vitest, knip, secretlint,
      rustfmt, Clippy, cargo-deny, cargo-audit, husky + lint-staged, Conventional Commits.
- [x] Governance: ADRs, rule packs, repo-resident memory, generated + hash-checked indexes.
- [x] Tauri 2 shell: frameless transparent HUD window, persisted geometry, tray icon with
      close-to-tray, DEV badge for dev builds.
- [x] HUD design system: palette, chamfered panels/buttons, Inter / JetBrains Mono / Orbitron.
- [x] Typed IPC surface with `ts-rs`-generated bindings: `app_version`, `build_info`,
      `get_recent_logs`, `get_settings`, `update_settings`, `open_external`.
- [x] Logging (ADR-APP-025): console + rotating JSON file + ring buffer streamed live into the Logs view.
- [x] Settings: atomically written JSON under the OS app-data dir; UI scale applied to the WebView.
- [x] Views: Home, Logs, Settings, About dialog.

## Phase 1 — Bootstrap into YggShell (done)

- [x] Identity: `app.identity.json` → `YggShell` / `com.kaoszwerg.yggshell`, propagated by
      `identity:sync`; version reset to `0.1.0`, CHANGELOG reset.
- [x] Icon: Yggdrasil as a rune-stave on a shell prompt (`src-tauri/icons/icon.svg` → full icon set).
- [x] Fork marker: `governance/config.json` → consumes `kaoszwerg/saga-rust-template`, owns no layer.
- [ ] **`node scripts/governance-update.mjs --adopt`** — blocked on a git credential that can read the
      private upstream (see `.claude/memory/open-work-backlog.md`).

## Phase 2 — The terminal

The substrate. A genuine terminal, not a reduced emulation.

- [x] **[ADR-PROJ-001](docs/adr/project/proj-001-terminal-architecture.md)** — emulator (`@xterm/xterm`),
      PTY (`portable-pty`, behind one module, with three named tripwires), transport (Tauri Channel with
      mandatory coalescing), session model, threat model, and what is explicitly outside milestone 1.
- [ ] The three new HUD primitives the milestone needs, with tests: `Tabs`, `ContextMenu`,
      `TerminalSurface` (`src/components/ui/`).
- [ ] Backend: PTY spawn/resize/kill per tab, streamed output, process lifecycle, structured logging
      of every session's start/exit (rule:logging).
- [ ] Frontend: a terminal view with multiple independent tabs — full keyboard handling, scrollback,
      selection/copy-paste, resize, links. Every control the user touches is a HUD primitive
      (rule:ui-design).
- [ ] Tests on both sides; the IPC contract pinned by tests on the producing side (rule:testing).

## Phase 3 — First sidebar widget: Git integration

The reason the product exists: enriching an AI development harness.

- [ ] Current branch, visualised the way VS Code shows it.
- [ ] List of changed files in the working tree.
- [ ] Branch history below it: where each branch stands, and the divergence between branches drawn out.

## Later — discussed before it is built

- [ ] iTerm2 theme import, per-tab theme selection.
- [ ] Theme editor.
- [ ] Granular per-terminal configuration.
- [ ] Further sidebar tools for the AI harness.
- [ ] Release: signing and notarisation (ADR-APP-023) — no `APPLE_*` secrets are set yet.
