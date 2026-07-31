# Implementation plan

## Phase 0 — Shell (done)

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

## Phase 1 — Product definition (next)

- [ ] Decide the product's purpose and its final name; run the rename checklist in
      `.claude/memory/project-scope.md`.
- [ ] Replace the placeholder logo if the new name calls for a different mark.
- [ ] Write the ADR(s) for the domain architecture before writing domain code.

## Phase 2 — First feature

- [ ] Backend module + DTOs + commands; regenerate bindings.
- [ ] Frontend view + hooks + sidebar entry.
- [ ] Tests on both sides; extend CSP and capabilities only as the feature actually requires.

## Later

- [ ] Release CI: cross-platform build, signing and notarisation (ADR-APP-023).
