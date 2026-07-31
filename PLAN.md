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
- The three new HUD primitives the milestone needs, with tests (`src/components/ui/`):
  - [x] `Tabs` — WAI-ARIA tab strip, roving tabindex, close/add, middle-click close. Lives in the
        title bar (ADR-PROJ-001), so it scrolls rather than wraps.
  - [x] `ContextMenu` — WAI-ARIA menu on right-click: portal, viewport clamp, arrow keys over
        enabled rows only, Escape returns focus to the trigger.
  - [x] `TerminalSurface` — the `@xterm/xterm` wrapper; the only file allowed to name xterm.
- [x] Backend: PTY spawn/resize/kill per tab, streamed output, process lifecycle, structured logging
      of every session's start/exit (rule:logging).
- [x] Frontend: a terminal view with multiple independent tabs, tabs in the title bar, HUD context
      menu, HUD scrollbars.
- [x] Tests on both sides (292 frontend + 43 backend).
- [x] Search over the scrollback: `@xterm/addon-search` plus a HUD search bar (⌘F / Ctrl+Shift+F).
- [x] Copy/paste — ⌘C/⌘V on macOS, Ctrl+Shift+C/V elsewhere (never plain Ctrl+C, which is SIGINT),
      middle-click pastes the primary selection as on X11, and pasting is bracketed.
- [x] The shell's own title sequence (OSC 0/2) names the tab.
- [ ] **Deferred by the maintainer:** behavioural verification on Windows and Linux. Only macOS has
      been driven for real; the ConPTY path compiles but is untested.

## Phase 3 — First sidebar widget: Git integration

The reason the product exists: enriching an AI development harness.

- [x] **The tool column.** The rail navigates and nothing renders in it; a tool opens its own
      resizable, collapsible column beside it, and the terminal keeps the rest of the width instead of
      being replaced. Width and choice are remembered; a fresh install starts collapsed. Logs and
      Settings stay full views — a view replaces, a tool accompanies.
- [x] **How the app learns which repository to show:** OSC 7. The shell reports its working directory
      after every prompt, so the tool follows a `cd`. The hook is installed through a generated rc file
      in the app's own data directory (`ZDOTDIR` for zsh, `--rcfile` for bash) which sources the user's
      real configuration first — their files are never touched, and a failure costs the hook, not the
      terminal.
- [x] Current branch, with ahead/behind against its upstream.
- [x] List of changed files, staged and unstaged, with status marks.
- [x] Branch history, drawn: lanes assigned as the walk proceeds, merges given their own lane, refs
      labelled on the commit they point at.
- [x] The history covers **every local branch**, sorted by commit time, with a colour per lane.
- [x] **Inside tmux the working directory comes from tmux itself** (`pane_current_path`), polled by the
      active tab. Measured: tmux consumes OSC 7 and forwards nothing, with or without its DCS
      passthrough. The upside is subtraction — inside tmux no shell integration is installed at all.
- [x] **The layout the tool needed:** branch fixed on top, changes and history each in their own scroll
      region with a draggable divider between them whose position is remembered as a share of the
      height (`Splitter` gained a horizontal mode; `Row` is the new activatable-row primitive).
- [x] **Reading, not just listing.** A changed file opens its diff; a commit opens in full — whole
      message, author, parents, files with `+n −m`, each of which opens its own diff inside that commit.
      In a panel over the terminal (Escape closes), with syntax highlighting from `shiki`: tokens rather
      than HTML, our palette rather than a stock theme, and no WASM.
- [ ] Still open here: fish and other shells get no hook (fish reports OSC 7 itself; the rest do not).
      Remote-only branches are not drawn — only local ones and HEAD. A diff is highlighted per hunk, so
      a hunk starting inside a block comment can be mis-coloured.

## Phase 4 — Terminal configuration (done, bar split panes)

Ordered as they should be built; each is discussed before it starts (rule:clarify-and-plan).

- [x] **Which shell to start** (Settings → Terminal). A list the backend produced, never a text field:
      `terminal_open` takes no command line on purpose (ADR-PROJ-001 §5), and a free-text shell path
      would have handed that back. `/etc/shells` + `$SHELL` on Unix, the known interpreters on Windows;
      checked when stored and again before a spawn.
- [x] **iTerm2 theme import** — drop an `.itermcolors` file on the window. A drop hands over a *path*;
      the backend opens it, bounded and extension-checked, with a reader written for this format that
      resolves no entities and follows no DTD (a scheme is a file downloaded from the internet).
      A scheme stores only what it defines; the frontend lays it over the HUD palette, so colour keeps
      one home.
- [x] **Theme editor** — all twenty-two colours, live preview, `ColorField` primitive (native picker
      as the mechanism, never its look; hex field beside it because schemes are shared as hex).
- [x] **Per-terminal configuration** — named profiles overriding shell, starting directory and colour
      scheme; Settings holds the defaults, so there is no second copy to keep in step. `terminal_open`
      takes a profile **id** — a reference, never a command line (ADR-PROJ-001 §5) — and a profile's
      shell is checked against the same list Settings is. Right-click the tab strip to start one.
- [ ] Split panes, and session persistence across restarts. Both explicitly outside milestone 1.

## Phase 5 — More sidebar tools

The column, the rail and the persistence are built (ADR-PROJ-001); a second tool is now only its own
content plus one entry in `TOOLS` and `ToolId`.

- [ ] Remote branches in the Git graph (only local ones and HEAD are drawn today).
- [ ] Whatever the harness workflow actually needs next — decided with the maintainer, not guessed.

## Known gaps carried forward

See `.claude/memory/open-work-backlog.md`, which holds the *diagnosed but unclosed* defects and the
traps around them (a GUI app's empty PATH, `void` promises, tmux and OSC 7, screenshots). Read it
before re-investigating anything.
