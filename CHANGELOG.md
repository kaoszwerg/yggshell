# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (ADR-CORE-024).

## [Unreleased]

### Added

- **`ContextMenu` HUD primitive** (`src/components/ui/ContextMenu.tsx`) — the right-click menu the
  terminal and the tab strip need. Portal-rendered so a parent's `clip-path` cannot crop it, measured
  and clamped into the viewport so a menu opened near an edge stays on screen, and suppressing the
  native menu itself rather than relying on `useNativeContextMenuGuard` having run. WAI-ARIA menu
  keyboard model: first enabled row focused on open, arrows skip disabled rows and wrap, Home/End
  jump, Enter/Space activate, Escape closes and returns focus to the trigger.
- **`Tabs` HUD primitive** (`src/components/ui/Tabs.tsx`) — the tab strip behind the terminal's tabs,
  which live in the title bar (ADR-PROJ-001) and therefore scroll rather than wrap. WAI-ARIA tabs
  pattern with automatic activation: arrow keys move selection and focus, Home/End jump, Delete and
  middle-click close, and a roving tabindex keeps the whole strip to a single Tab stop. Closing a
  background tab does not select it.
- **ADR-PROJ-001 — terminal architecture.** Emulator, PTY crate, transport, session model and threat
  model decided before any code, each against a measurement: `@xterm/xterm` behind the primitive layer,
  `portable-pty` behind a single module with three named re-evaluation tripwires, and a Tauri Channel
  whose backend side *must* coalesce (66.7 MB of PTY output arrives as 68 267 reads of ~1 KB).
- Bootstrapped `saga-rust-template` into **YggShell**: identity `YggShell` /
  `com.kaoszwerg.yggshell` in `app.identity.json`, propagated by `identity:sync` to all 8 derived
  locations; version reset to `0.1.0`; CHANGELOG reset.
- New app icon: Yggdrasil as a rune-stave standing on a shell prompt (`src-tauri/icons/icon.svg`),
  rasterized into the desktop icon set.
- `src/test/environment.test.ts` — pins that the test environment exposes working `localStorage` and
  `sessionStorage`.

### Changed

- `hudButtonClass`'s `ghost` variant now honours the `accent` instead of always brightening to cyan.
  A close `×` on a cyan-filled active tab used to disappear exactly when the pointer reached it. The
  accent-to-class mapping is spelled out rather than interpolated — Tailwind scans for literal class
  names, so a built-up `text-${accent}` would ship as no colour at all.

### Fixed

- **A crash report could erase the one before it.** `crash.rs` named reports from a millisecond
  timestamp alone, so two panics inside the same millisecond — or two processes crashing at once —
  produced the same path and the second `fs::write` overwrote the first. Report names are now claimed
  atomically with `create_new` and a bounded suffix search, so no crash record is lost
  (rule:crash-handling). Reproduced by the existing `two_crashes_never_overwrite_each_other`, which was
  passing only by luck of the clock; pinned deterministically by
  `a_second_crash_in_the_same_millisecond_does_not_erase_the_first` and
  `the_collision_search_is_bounded`.
- Test suite was red on Node >= 26 (11 failures): Node defines its own, unavailable
  `localStorage`/`sessionStorage` as non-enumerable globals, which shadow jsdom's working Storage
  because vitest copies only the enumerable window keys. `src/test/setup.ts` now re-points both
  globals at the jsdom window's Storage objects.
- `src-tauri/examples/crash_probe.rs` still referenced the old crate as `saga_rust_template_lib`:
  `sync-identity.mjs` does not cover `src-tauri/examples/`, so `cargo clippy --all-targets` broke
  after the rename. (The script fix belongs upstream — see `.claude/memory/open-work-backlog.md`.)
- `README.md` claimed Node >= 22 while `package.json#engines` requires >= 20.19.

### Removed

- Template-creation artifacts: `docs/howto/new-project-from-template.md`, the `/bootstrap` command,
  and the "Create a project from this template" section of the README.
- Mobile icon assets emitted by `tauri icon` (`src-tauri/icons/android/`, `ios/`, `64x64.png`) —
  unreferenced by `tauri.conf.json` on a desktop-only app.
