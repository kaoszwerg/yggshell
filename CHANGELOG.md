# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (ADR-CORE-024).

## [Unreleased]

### Changed

- **An active tool in the rail is purple, not green.** Not a matter of taste: purple is the one accent
  in the palette carrying no other meaning here — green already says "the view you are in", gold is
  the DEV badge and warnings, danger is destructive. A tool is a different *kind* of thing from a
  view: it opens beside what you are doing instead of replacing it, and now it looks it.

### Added

- **URLs in the terminal open with ⌘-click** (Ctrl-click elsewhere), in the default browser. The
  modifier is the point: a plain click in a terminal is a selection or a cursor move, and opening a
  browser because somebody clicked a line of log output is the surprise it prevents. The URL goes
  through the backend, which still refuses anything that is not `http(s)` — it came out of somebody
  else's output.
- **Copy on select**, off by default (Settings → Terminal). Off because it silently replaces whatever
  you had copied, which is only welcome when it was expected. Bound to the *end* of a selection rather
  than to every change: `onSelectionChange` fires for every cell the pointer crosses, and a hundred
  clipboard writes during one drag is both wasteful and, on a slow write, wrong. A middle-click still
  pastes the last selection either way.
- **Your tabs come back after a close or a crash.** Which tabs were open, where each one was, its
  profile and its colour scheme — restored, with the tab that was in front still in front.
  - **Two different things are restored, and the difference is the design.** A PTY does not survive
    the app: the shell gets its `SIGHUP` and dies, and no bookkeeping brings it back. So the
    *workspace* comes back as fresh shells in the same places — which is what every terminal means by
    "restore" — while the *process* comes back only through **tmux**, which outlives us by design: a
    tab records the session it attached to and returns to it, finding the work exactly where it was.
  - **What is deliberately not restored**, because it would be false the moment it appeared: a title
    the shell set (`cargo watch` is not running any more), a backend session id, an open diff, and a
    tab's detached-from-tmux state — its profile decides again. Each has a test that says so, and each
    of those tests was run against a version that kept it, to confirm it fails there.
  - A restored directory that has since gone is not an error. The backend logs it and the shell starts
    where it otherwise would have; a project moved between two runs must not leave someone staring at
    a message instead of a terminal.
  - Restored tabs count as the bootstrap, so none is opened on top of them.
- **Diffs and commits now follow the terminal's text size.** Code is code: the size chosen to read a
  terminal at is the size a diff should be read at, and having one follow the setting while the other
  stayed fixed was an oversight. It is not divided by the UI scale like the emulator's, because the
  panel is ordinary DOM and the WebView zoom already applies to it.
- **The Git tool's header names the repository**, beside the column's own name: `GIT · yggshell`. A
  branch on its own does not say where you are — `main` is `main` in every checkout, and this app is
  built to have several open at once. The full path is in a tooltip, because two checkouts of the same
  project share a folder name. Header and panel read through one hook, so they cannot name different
  repositories, and sharing the query key means the header costs a cache hit rather than a second walk
  of the repository.
- **Fourteen colour schemes ship with the app** — three of ours (Yggdrasil, Bifrost, Fimbulwinter) and
  eleven ported ones whose licences were each checked at their own upstream, not at the collection they
  were downloaded from: Solarized (dark/light), Dracula, Nord, Catppuccin (Mocha/Latte), Tomorrow,
  Tomorrow Night and Ayu (dark/mirage/light). All MIT; attribution in
  `src-tauri/resources/themes/CREDITS.md`. **Gruvbox is deliberately absent**: its repository carries no
  licence file, and "widely used" is not a licence. A shipped scheme can be copied and edited, never
  deleted — it is part of the app rather than of your data.
- **`.yggtheme`, which is an iTerm2 plist with our name on it.** Byte for byte the same format, so
  iTerm2 reads our files and we read `.itermcolors` — the extension marks where a file came from and
  changes nothing else. A round-trip test pins that, because the moment it stopped being true the
  extension would be a lie.
- **Diffs side by side**, old on the left with its line numbers and new on the right with its own,
  which is what makes a reindent or a rename readable at all. A row where one side has no line renders
  as a *gap* rather than a blank line — a blank line is a line that exists. Toggled in the panel header
  and remembered; the interleaved view is still there for a narrow window.
- **Diffs and commits can be read in a scheme of their own** (Settings → Terminal). The chain is
  explicit and every step earns its place: the setting for that kind of view, then the diff setting for
  commits, then the tab's own terminal scheme, then the default. "Same as the terminal" is a button
  rather than the absence of a choice — an inheritance chain nobody can see is one nobody can predict.
- **A colour scheme per tab.** Right-click a terminal → *Colour scheme…* A tab without a choice of its
  own follows its profile, and failing that the setting — so changing the default in Settings repaints
  every tab that has not opted out, immediately.
  - This corrects a wrong call in the profile work: shell, directory and scheme were treated as one
    thing. They are not. A shell is decided once, when the process starts, and a tab cannot change its
    mind about it afterwards; a scheme is decided every frame, which is why the emulator is repainted
    live. Freezing it into the profile made “give this tab another scheme” mean “open another tab”.
- **Terminal profiles** (Settings → Terminal): a named set of overrides for what a new tab starts as —
  its shell, its starting directory, its colour scheme. Right-click the tab strip to open one; the `+`
  stays a one-click terminal with the defaults.
  - **`terminal_open` takes a profile id — a reference, never a command line** (ADR-PROJ-001 §5). The
    backend turns the id into a program. A profile's shell is checked against the same list Settings
    is checked against, so a profile cannot be a way around that check.
  - **Everything is an override and Settings holds the defaults**, so there is no "default profile"
    document to keep in step: a profile that sets only a theme follows Settings for the rest, and
    changing Settings changes it.
  - A tab keeps the profile it was opened with. It decided which shell is running, and a tab whose
    profile changed underneath it would be claiming something about a process that is not true.
  - Two things that have gone stale are handled rather than fatal, because neither is a reason to
    leave someone without a shell: a profile that was deleted falls back to the defaults, and a
    starting directory that no longer exists means the shell starts where it otherwise would.
- **iTerm2 colour schemes, and an editor for them** (Settings → Terminal).
  - **Import is a file drop**: drop an `.itermcolors` file anywhere on the window. A drop hands the
    webview a *path*, never contents, so the backend is what opens the file — extension-checked, size-
    bounded, and parsed by a reader written for this and nothing else.
  - **That reader is hand-written on purpose, and it is a security decision rather than a size one.**
    Every `.itermcolors` opens with a `<!DOCTYPE plist PUBLIC … "http://www.apple.com/DTDs/…">`, and a
    general XML parser is a machine for resolving exactly that — external entities, nested expansion,
    DTDs — on a file the user downloaded from the internet. This one resolves nothing: it walks tags
    and understands five element names, so the class of attack does not exist rather than being
    configured away. There is a test that drops an XXE payload on it.
  - **A scheme carries only what it defines.** Colour has one home in this project and it is the
    frontend (rule:theming); a full palette stored in Rust would be a second source for the same fact.
    Anything a scheme never mentions keeps the HUD's colour — which is also what a user expects,
    rather than a stray black caret on a dark background.
  - **A theme editor** for all twenty-two colours, with a live preview of the palette on the
    background it will actually sit on, and a `ColorField` HUD primitive behind each one: the native
    picker is used as the *mechanism* — it is the OS picker people already know — and never seen, with
    a hex field beside it because schemes are written, pasted and shared as hex.
  - Changing a scheme repaints every open terminal at once. The emulator is not restarted, so nothing
    running is disturbed.
- **The Git tool got its layout, and two things to click.**
  - **Branch on top, fixed; changes and history below it, sharing a draggable divider.** The branch is
    two lines whatever happens, so a share of a scroll area would only ever be wasted on it. The other
    two genuinely compete — the file list is long while you work, the graph while you review — so the
    balance is the user's, and it is remembered like the column width. Both scroll on their own, so
    neither can push the other off screen. The divider is a share of the height rather than a pixel
    count: a stored `240px` would be most of a short window and a sliver of a tall one.
  - **Click a changed file to read its diff**, and **click a commit to read it in full** — the whole
    message the graph could only show the first line of, its author and parents, and the files it
    touched with `+n −m`. A file in that list opens its diff inside that commit, with a way back.
  - Both open in a panel **over the terminal** — the widest surface in the window, which is what a diff
    needs — while the shell underneath keeps running. Escape or × gives it straight back.
  - **Syntax highlighting** via `shiki`, which earns its place on three counts: it returns *tokens*, so
    there is no raw HTML injected over a repository somebody else wrote; its theme is ours, built from
    `PALETTE` (rule:theming), so nothing arrives wearing a stock look; and it runs on the JavaScript
    regex engine, so no WASM ships. Grammars load on demand from an explicit map — a variable import
    path would have bundled all two hundred.
  - `Row` and a horizontal `Splitter` are new HUD primitives, both tested. A list of forty native
    `<button>`s in a panel that is meant to be ours is exactly what ADR-APP-026 exists to prevent.
- **Which shell a terminal starts is now a setting** (Settings → Terminal). Until now it was `$SHELL`
  with no way to say otherwise.
  - It is a **list, never a text field**, and that is the point rather than a nicety. `terminal_open`
    deliberately takes no command line so the webview cannot name the program a terminal runs
    (ADR-PROJ-001 §5); a free-text shell path would have handed that straight back. The backend
    produces what this machine offers — `/etc/shells` plus the user's own `$SHELL` on Unix, the known
    interpreter locations plus `COMSPEC` and a `pwsh.exe` on PATH on Windows — the frontend picks from
    it, and anything else is refused when it is stored **and** again before a spawn, because a shell
    can be uninstalled in between and `settings.json` is an ordinary file.
  - Two shells with the same file name (`/bin/zsh` and `/opt/homebrew/bin/zsh` is a common macOS pair)
    are shown by full path. Two buttons both reading `zsh` are not a choice.
  - Changing it affects terminals opened from then on; the ones already running keep their shell.
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

- `SettingsStore::update` takes a `SettingsPatch` instead of a growing list of positional `Option`s.
  At six fields, `update(None, None, Some(x), None, None, None)` said nothing about which setting `x`
  was, and inserting a field in the middle would have silently re-targeted every existing call.
- Looking an executable up on the login shell's `PATH` moved from `tmux.rs` into
  `terminal::environment::which` — the shell list needs the same lookup, and a GUI app's `PATH` trap
  (ADR: launchd hands it four directories) is not something to solve twice.
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

- **Every tab attached to the SAME tmux session.** With attach-or-create, every terminal joined one
  session — and two clients on one session share one *view* of it: same window, same scrollback. A
  second tab therefore appeared to do nothing at all, which is not a multi-terminal app. The first tab
  now takes the configured session, and each one after it gets its own (`work`, `work-2`, …), reusing a
  name as soon as a tab closes. In plain attach mode, a session another tab is already showing yields a
  plain shell instead of a duplicate view.
- **Detaching from tmux closed the tab.** Detaching ends the *client*, not the work: the session keeps
  running and the user asked to be back in a terminal. The tab now gets a plain shell in place of the
  tmux client, keeping its window, its scrollback and its place in the strip. A shell that exited, or a
  client that died with a failure, still closes the tab.
- **The diff and commit panel belonged to the window instead of to a tab.** Two tabs are two
  repositories as often as not, so opening a diff in one and finding it laid over another was the
  natural consequence. Each tab now carries its own.
- **Looking at Settings or Logs killed every running terminal.** Navigating away unmounted the
  terminal view, and each pane closed its session on unmount — so a glance at a preferences page took
  down whatever was running in every tab, and coming back left an empty workspace. Two things were
  wrong and both are fixed:
  - **A session now ends when its TAB goes away, never when its component unmounts.** The session
    belongs to the tab, so the tab list is what decides. React unmounts components for reasons that
    have nothing to do with the user closing anything — navigation, StrictMode's double-mount in
    development, a hot reload — and none of them may take a build, an agent or an ssh session with
    them.
  - **The terminal view is hidden when you navigate away, not unmounted.** Even with the first fix,
    unmounting destroys every emulator and resets each pane's session id, so returning would open a
    *second* PTY per tab and leave the first running with nobody reading it — one orphan per
    navigation, and the scrollback gone each time.
  - Both are pinned by tests that were run against the broken code first, to confirm they fail on it.
- **Right-clicking the tab strip did nothing.** `ContextMenu` attaches its handler to the element it
  is given, and it was given `<Tabs>` — a component, which does not forward unknown props to a DOM
  node and therefore dropped it in silence. It now wraps a real element, and the primitive warns in
  development when it is handed a component, because the failure has no other symptom.
- **The Git detail panel sat *under* the terminal instead of over it, and would not scroll.** One
  cause for both: `.hud-panel` declares `position: relative` so its `::before` can draw the chamfered
  border, that declaration is unlayered, and unlayered CSS beats every `@layer` — including the one
  Tailwind's utilities live in. So `absolute inset-0` did nothing, the panel stayed in the flow, it
  had no height of its own, and the `overflow-auto` region inside it never became a scroll container.
  `.hud-popover` is the same border with `position` left to the caller, which is what a floating
  surface wants.
  - **Now gated**, because nothing reported any of it — not the type checker, not the linter, not a
    test: a project ESLint rule (`hud/floating-panel-position`, with its own tests) refuses
    `hud-panel` together with `absolute`/`fixed`, in a string or a template literal.
  - Worth recording: the first attempt added the check to the base config's `no-restricted-syntax`
    entry, which **silently switched off its bans on native `<button>`, `<input>` and the `title`
    tooltip** — flat config replaces a rule's options rather than merging them. Caught by probing the
    gate instead of trusting it. Hence a rule of our own.
- **The Git tool no longer sits blank for a tick after a terminal opens.** Its working-directory poll
  starts when the pane mounts, at which point there is no session yet — so its first ask hit a `null`
  id and did nothing, and inside tmux (where the poll is the only source) the tool waited a full
  interval for its first answer. It now waits for the session and asks immediately.
- **The stray `%` at the top of a fresh terminal.** It was a race in this app, not the shell. zsh
  draws its end-of-line mark as `%` + (`COLUMNS`-1) spaces + CR + erase-line, which erases itself —
  *if* the shell and the emulator agree on the width. They did not always: the settings query
  resolves shortly after a terminal mounts, the font size changes with it and the pane re-measures,
  and that second measurement was **dropped** whenever it landed while `terminal_open` was still in
  flight. The shell then drew for a wider window, the spaces wrapped onto a second line, and the
  erase cleared the wrong one. A geometry measured during the open is now remembered and applied the
  moment the session exists.
  - Measured, not reasoned: a PTY probe showed `$COLUMNS` and `stty size` matching what was passed
    exactly (so the backlog's column-mismatch-at-spawn theory was wrong), and the mark appearing with
    *and without* our shell integration; feeding zsh's exact byte sequence into the emulator at 80
    real vs. 100 believed columns leaves `%` on the first line, at 100 vs. 100 it leaves nothing.
  - `TerminalView` now has tests at all — the view where this lived had none.
- **The Git tool now follows a `cd` inside tmux.** It never did: tmux consumes OSC 7 for its own
  `pane_current_path` and does not forward it, so the sequence the shell hook emits was measured
  arriving zero times at the outer terminal — wrapping it in tmux's DCS passthrough changed nothing.
  What does work is asking tmux, which tracks the path itself; the active tab polls
  `terminal_cwd` while the backend answers `null` for an ordinary shell, where OSC 7 has already said
  so instantly. It also covers a session that existed **before** this app started and could never have
  had a hook injected into it.
  - Consequence, and a welcome one: **inside tmux no shell integration is installed at all.** No
    injected `ZDOTDIR`, none of the repairs that go with it — a tmux user's shell starts untouched.
- **A tmux detach took the whole interface down.** Sessions end underneath pending calls constantly —
  the user typed `exit`, tmux detached, the tab closed a keystroke ago — and the backend answers
  `no terminal session N`. Those rejections were unhandled, reached the app's global handler and
  became a **fatal screen over everything**. Every terminal call, and the clipboard and link paths
  with them, now handles its own failure. `void somePromise` satisfies the linter and throws the
  rejection away; it is gone from this view.
- **HUD buttons were broken by their own text.** `Button` carried no padding at all — every caller had
  been passing its own, and the fatal screen was the one that did not, so its label sat inside the
  chamfer. Padding and `whitespace-nowrap` belong to the primitive: a clipped shape whose label wraps
  is not taller, it is cropped.
- **With tmux enabled, shell integration silently stopped being installed.** It was prepared for the
  program being spawned, which is `tmux` and not a shell, so no hook was written and the Git tool
  stopped following `cd`. It is prepared for the shell now — the environment reaches every shell tmux
  starts either way. On top of that, tmux *consumes* OSC 7 for its own pane tracking: the hook now
  wraps the sequence in tmux's DCS passthrough and enables `allow-passthrough` for its own pane only.
- **A bundled app could not find anything the user has installed.** macOS launches a GUI app through
  `launchd`, which hands it `PATH=/usr/bin:/bin:/usr/sbin:/sbin` — so the user's own `.zshrc` failed
  with `command not found: direnv`, and the tmux integration reported "not installed" for a `tmux`
  sitting in `/opt/homebrew/bin`. Both were true of the *process* and neither of the machine, and
  neither shows in `tauri dev`, where the app inherits the terminal that started it. A login shell is
  now asked once what environment it would set; that answer is the base for every terminal and the
  search path for anything the backend looks up. Bounded by a timeout, because a profile that blocks
  must cost a short PATH rather than a window that never opens.
- **The app icon had a grey border, and filled its whole canvas.** The border was a 22%-opacity cyan
  hairline of ours, which on a near-black plate reads as dull grey — gone. And macOS expects the
  artwork inside 824×824 of the 1024 canvas (the Big Sur template); full-bleed made it larger and
  squarer than every neighbour in the Dock, with corners disagreeing with the system squircle.
- **Window size and position are written when the window closes**, not only on a clean process exit.
  The window-state plugin keeps everything in memory until `RunEvent::Exit`, so any other ending — a
  signal, a crash, a `tauri dev` restart — lost the geometry silently. The tray's Quit already had to
  save explicitly for the same reason; the × button and hide-to-tray now do too, from one place.
- **Your shell history was empty, and completion was degraded.** The shell integration points
  `ZDOTDIR` at a generated directory so its rc files are found — but macOS' `/etc/zshrc` runs
  *between* those two files and contains `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history`, so every terminal
  wrote its history into this app's data directory and opened with nothing in it. `ZDOTDIR` is now
  restored around each hand-off, and a `HISTFILE` that points into our directory is put back. Verified
  against the real shell: `HISTFILE=/Users/…/.zsh_history` with 2939 entries, `ZSH_COMPDUMP` back in
  `$HOME`. The shell itself was never the problem — it reported `INTERACTIVE=on ZLE=on` with 421
  widgets loaded throughout.
- The terminal now reports geometry only when the row/column count actually **changed**. Dragging the
  tool column fires the resize observer every frame, but a terminal's size only moves every whole
  cell — without the filter one drag would have been a hundred IPC calls and a hundred `SIGWINCH`s
  for a terminal that had not resized.
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
