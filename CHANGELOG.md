# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (ADR-CORE-024).

## [Unreleased]

### Added

- **The terminal — YggShell's first running feature** (ADR-PROJ-001). A real PTY per tab, multiple
  independent tabs, and the emulator behind the primitive layer:
  - Backend: `src-tauri/src/terminal/` — a session registry the backend owns, `portable-pty` behind
    the single module allowed to name it, and two threads per session whose deaths are both declared
    in `crash-boundaries.json`. Output is coalesced before it reaches the IPC (~8 ms or 64 KiB),
    because the PTY delivers roughly a kilobyte per read.
  - Security: `terminal_open` takes geometry and an optional working directory, never a command
    line. The shell is resolved in the backend and logged; the directory is canonicalised and must
    exist. No terminal content is ever logged, in either direction.
  - Frontend: `TerminalSurface` (the only file that may import `@xterm/*`), a `TerminalView` whose
    panes all stay mounted so scrollback survives tab switches, and tabs in the **title bar** — which
    cost no extra height, so the tagline yields to them once a terminal is open.
  - Closing a tab takes the foreground process group with it, so a build or an AI harness started
    inside the shell does not survive as an orphan.
- **Unix middle-click paste, on the tab too.** A middle-click on a tab pastes into *that* terminal
  and brings it to the front first — text arriving in a terminal the user cannot see is alarming.
  It routes through the emulator, so it is bracketed like every other paste.
- **Unix middle-click paste.** Selecting text in a terminal fills an app-scoped PRIMARY selection —
  on Unix, selecting *is* the copy — and a middle-click pastes it. A WebView cannot reach the real
  X11 PRIMARY (`navigator.clipboard` maps to CLIPBOARD on every platform), so the stand-in works
  between YggShell terminals but not across applications; that limit is the browser's.
- **Copy, paste and search shortcuts.** ⌘C/⌘V/⌘F on macOS, Ctrl+Shift+C/V/F elsewhere — never plain
  Ctrl+C, which a terminal owes to SIGINT. Every paste goes through the emulator so it is bracketed:
  a multi-line paste must not execute line by line as it arrives.
- **Search over the scrollback** (`@xterm/addon-search`): a HUD search bar with next/previous, Enter
  and Shift+Enter, Escape to dismiss, and a visible "not found" rather than a silent no-op. It
  searches the active terminal's scrollback — not other tabs, not the filesystem.
- **The shell names its own tab.** A title set by the shell (OSC 0/2) replaces the `Terminal N`
  fallback, so a tab can read `cargo watch` instead of a number.
- **HUD scrollbars, applied globally.** 6px, no track, no stepper arrows, cyan at 22% and 45% on
  hover. A native scrollbar is stock OS chrome (ADR-APP-026) and in a terminal it also simply
  competes with the text.
- **`ContextMenu` HUD primitive** (`src/components/ui/ContextMenu.tsx`) — the right-click menu the
  terminal and the tab strip need. Portal-rendered so a parent's `clip-path` cannot crop it, measured
  and clamped into the viewport so a menu opened near an edge stays on screen, and suppressing the
  native menu itself rather than relying on `useNativeContextMenuGuard` having run. WAI-ARIA menu
  keyboard model: first enabled row focused on open, arrows skip disabled rows and wrap, Home/End
  jump, Enter/Space activate, Escape closes and returns focus to the trigger.
- **`Tabs` HUD primitive** (`src/components/ui/Tabs.tsx`) — the tab strip behind the terminal's tabs,
  which live in the title bar (ADR-PROJ-001) and therefore scroll rather than wrap. WAI-ARIA tabs
  pattern with automatic activation: arrow keys move selection and focus, Home/End jump, Delete
  closes, and a roving tabindex keeps the whole strip to a single Tab stop. Closing a background tab
  does not select it. Middle-click is handed to the caller rather than bound to close: in a browser
  that is the convention, but in a terminal middle-click means paste, and one gesture meaning two
  opposite things inside the same window is how a user loses a running process.
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

- **Web Storage in tests now comes from an in-memory `Storage`, per upstream briefing `app-108`.**
  The previous shim re-pointed the globals at jsdom's Storage through `globalThis.jsdom` — a vitest
  internal — and probed the existing global first, which throws on Node ≤ 25 (a version `engines`
  still allows). The replacement installs unconditionally and is guarded only on `typeof document`.
  `src/test/environment.test.ts` now also pins *ownership* of the globals, not just their behaviour,
  so the setup block cannot be tidied away without a test failing.
- `hudButtonClass`'s `ghost` variant now honours the `accent` instead of always brightening to cyan.
  A close `×` on a cyan-filled active tab used to disappear exactly when the pointer reached it. The
  accent-to-class mapping is spelled out rather than interpolated — Tailwind scans for literal class
  names, so a built-up `text-${accent}` would ship as no colour at all.

### Fixed

- **Middle-click did not paste at all.** It listened for `auxclick`, but xterm's selection service
  calls `preventDefault` on `mousedown` and WebKit then never dispatches the auxclick — so the
  handler simply never ran. It listens on `mousedown` in the *capture* phase now, which runs before
  any descendant listener. On Linux it deliberately does nothing: xterm already moves the textarea
  under the cursor there so the WebView performs a **native** paste of the real X11 PRIMARY — text
  selected in any other application included — and the app-scoped stand-in would be strictly worse.
- **Paste inserted everything twice on macOS.** ⌘V is handled natively by the WebView — Tauri's
  default Edit menu supplies the key equivalent and xterm listens for the resulting `paste` event —
  so the custom handler was a second paste on top of it. `return false` from xterm's key handler
  stops xterm's own key processing, not the browser default that produces the event. The shortcut is
  now intercepted only on Windows and Linux, where `Ctrl+Shift+C/V` are not browser shortcuts and
  nothing happens unless the app does it.
- `useTerminalStore.closePane` left `activeKey` pointing at the pane it had just removed when that
  pane was the only one open: `Array.at(index - 1)` wraps to the END of the list at index 0. Found by
  the test written for it, not in the app.
- **A crash report could erase the one before it.** `crash.rs` named reports from a millisecond
  timestamp alone, so two panics inside the same millisecond — or two processes crashing at once —
  produced the same path and the second `fs::write` overwrote the first. Report names are now claimed
  atomically with `create_new` and a bounded suffix search, so no crash record is lost
  (rule:crash-handling). Reproduced by the existing `two_crashes_never_overwrite_each_other`, which was
  passing only by luck of the clock; pinned deterministically by
  `a_second_crash_in_the_same_millisecond_does_not_erase_the_first` and
  `the_collision_search_is_bounded` — the latter now also asserting, per upstream briefing `app-107`,
  that an exhausted search leaves every earlier report intact.
- Test suite was red on Node >= 26 (11 failures): Node defines its own, unavailable
  `localStorage`/`sessionStorage` as non-enumerable globals, which shadow jsdom's working Storage
  because vitest copies only the enumerable window keys. `src/test/setup.ts` now re-points both
  globals at the jsdom window's Storage objects.
- `src-tauri/examples/crash_probe.rs` still referenced the old crate as `saga_rust_template_lib`:
  `sync-identity.mjs` does not cover `src-tauri/examples/`, so `cargo clippy --all-targets` broke
  after the rename. (The script fix belongs upstream — see `.claude/memory/open-work-backlog.md`.)
- `README.md` claimed Node >= 22 while `package.json#engines` requires >= 20.19.

### Removed

- **The Home view.** It described the empty template — "no product features yet", "add a backend
  module under src-tauri/src/" — which stopped being true the moment this became a terminal. The one
  thing it was good for, the build identity, is now the About section of Settings. A persisted
  `view: "home"` falls back to the terminal instead of leaving a blank pane.
- Two of the three copies of the build-identity block. `BuildIdentity` is the one source now; the
  About dialog and the About section both render it (rule:reusability).
- Template-creation artifacts: `docs/howto/new-project-from-template.md`, the `/bootstrap` command,
  and the "Create a project from this template" section of the README.
- Mobile icon assets emitted by `tauri icon` (`src-tauri/icons/android/`, `ios/`, `64x64.png`) —
  unreferenced by `tauri.conf.json` on a desktop-only app.
