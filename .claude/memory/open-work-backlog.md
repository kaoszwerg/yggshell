---
id: mem:open-work-backlog
title: Open follow-up work on YggShell
tldr: "Traps this repo already paid for — hud-panel beats `absolute`, flat config REPLACES rule options — plus the live backlog and its measurements."
scope: project
load: conditional
triggers:
  [
    backlog,
    open,
    follow-up,
    todo,
    gap,
    defect,
    bug,
    handover,
    resume,
    signing,
    notarisation,
    release,
    scope,
    next,
    tmux,
    osc7,
    history,
    screenshot,
    upstream,
    css,
    layer,
    tailwind,
    position,
    absolute,
    overlay,
    panel,
    tooltip,
    popover,
    clip,
    clip-path,
    chamfer,
    nowrap,
    wrap,
    truncate,
    ellipsis,
    eslint,
    lint,
    gate,
    flat-config,
    no-restricted-syntax,
    diff,
    xterm,
    theme,
    itermcolors,
    profile,
    path,
    which,
    claude,
    zshrc,
    zprofile,
    login-shell,
    interactive,
    environment,
    not-found,
  ]
applies-to:
  [
    ".github/workflows/**",
    "app.identity.json",
    ".claude/memory/**",
    "governance/**",
    "src-tauri/src/terminal/**",
    "src/**",
    "eslint.config.project.mjs",
    "scripts/project/**",
    "PLAN.md",
  ]
type: project
---

# Open work

**Read this before re-diagnosing anything.** Every entry below was measured, not guessed; repeating
the measurement costs an hour that has already been spent. `PLAN.md` holds the feature roadmap — this
holds defects, their evidence, and the traps around them.

## Closed — but read the measurement before you touch it again

Both of these were re-diagnosed once already because the note here said something the measurement
later contradicted. The measurements are kept so the next agent does not pay for them twice.

- **OSC 7 inside tmux — closed, and the approach that shipped is not the one written down here
  before.** The DCS-passthrough hook was measured and it does not work: an end-to-end probe counted
  **0** OSC 7 sequences and **0** passthrough DCS reaching the outer terminal, with and without
  `-e ZDOTDIR=…` on `new-session` (tmux panes inherit the *server's* environment, and `ZDOTDIR` is
  not in `update-environment`). What works is asking tmux — `display-message -p '#{pane_current_path}'`
  — which the same probe showed answering correctly. So inside tmux the frontend polls `terminal_cwd`
  every 2 s and **no shell integration is installed at all**. Do not re-attempt the passthrough.
- **The `%` at the top of a fresh terminal — closed.** It was ours, and it was a race, not the shell
  integration: it appeared with and without the hook. zsh's mark is `%` + (`COLUMNS`-1) spaces + CR +
  `ESC[K`, which erases itself when the shell and the emulator agree on the width. A measurement that
  landed while `terminal_open` was still in flight used to be **dropped** (`if (opening.current)
  return`), so the shell drew for a stale, wider window, the spaces wrapped, and the erase cleared the
  second line. `TerminalView` now parks that geometry and applies it when the session id arrives, and
  has tests. Measurements behind it, so nobody repeats them: `$COLUMNS`/`stty size` match the spawn
  size exactly (the column-mismatch-at-spawn theory in this file was wrong); xterm.js fed zsh's exact
  bytes leaves `%` at 80 real vs. 100 believed columns and nothing at 100 vs. 100.
## Defects with a diagnosis, not yet closed

- **`zsh: locking failed for <appdata>/shell/.zsh_history: no such file or directory`** was seen once
  in a probe. macOS' `/etc/zshrc` sets `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history` and runs *between*
  our generated `.zshenv` and `.zshrc`, which is why the repair line in `.zshrc` exists. Verified
  working once (`HISTFILE=/Users/…/.zsh_history`, 2939 entries) — so this is either a probe artefact
  or a path the repair misses. **Inside tmux the question no longer arises**: no rc file is generated
  there at all any more. It can therefore only affect a plain shell session.

## Traps this session paid for — do not re-learn them

- **An animated custom property inside a `conic-gradient` is a PAINT across the element's whole box,
  every frame, for ever.** `.window-frame` animated `--frame-angle` at `linear` over an element that
  *is the whole window*, to show a 1.5 px border — the rest is covered by `.window-frame-inner` and
  painted anyway. Measured on an idle release build, same instance, CSS swapped by hot-reload:
  **27.7 % of a core in the WebKit GPU process vs 3.0 % with `steps(60)`**, `sample` showing
  `CA::OGL::MetalContext::draw_elements` on top. It presented as *"tab switches feel sluggish"* —
  every interaction was competing with a permanent full-window repaint, and nobody would look for it
  in a stylesheet. **A decorative animation is a per-frame cost times the element's area; a 12 s
  revolution does not need 60 fps.** If you raise the step count, re-measure — the cost is in the
  paint, not in the animation.
- **`.hud-panel` pins `position: relative`, and unlayered CSS beats every `@layer` — including
  Tailwind's utilities.** `className="hud-panel absolute inset-0"` therefore does NOT float: the
  element stays in the flow, `inset-0` does nothing, and an `overflow-auto` child never bounds. Use
  `.hud-popover` (same chamfered border, `position` left to the caller) for anything floating. Gated
  now by `hud/floating-panel-position` (`scripts/project/eslint-hud-position.mjs`).
- **ESLint flat config REPLACES a rule's options, it does not merge them.** Adding an entry to the
  base config's `no-restricted-syntax` from the project overlay silently switched off its bans on
  native `<button>`, `<input>` and the `title` tooltip — config loaded, lint passed, gate gone. If you
  need a check the base config already owns the rule name for, write your own rule in
  `scripts/project/` instead. **Probe a gate you just added with a file that should fail**; that is
  the only reason this was caught.
- **`title` is banned as a JSX ATTRIBUTE, wherever it appears** — including as a prop name on your own
  component. Name such a prop `heading`.
- **imara-diff hands back lines WITH their terminator.** Strip it, or every rendered diff line is
  followed by a blank one.
- **xterm.js `write()` is asynchronous.** A test that writes and immediately reads the buffer reads an
  empty one and passes for the wrong reason. Await the callback.
- **A `hud-clip*` element does not hide an overflow — it AMPUTATES it.** `clip-path` cuts at the
  polygon, with no ellipsis and no scrollbar, so nothing on screen says text is missing. The tooltip
  carried `whitespace-nowrap` next to a `max-w-[240px]` and showed
  `/Users/steve/git-projects/private/yggshe` — a control that lied about its own content. Anything
  clipped **and** width-limited must be allowed to wrap (`wrap-break-word`). A `nowrap` element with
  no width cap (a `Button`) is fine: it grows instead of overflowing. Pinned in `Tooltip.test.tsx`
  (*"fitting its content"*); not lint-gated, because whether an element is width-limited depends on
  its parent and the check would be guesswork.

- **An unexplained light-grey surface, reported 2026-08-01 and not found.** A screenshot showed three
  backgrounds meeting: `#0a0a0f` (the app's deep) and `#1a1a2e` (`bg-elevated`, a panel) — both
  accounted for and one of them fixed (the diff's scroll container now carries the scheme) — plus a
  **light grey block, roughly `#eceef0`, that matches no colour in the palette**. The crop was too
  small to place it and the maintainer was not asked in time.

  **Narrowed since.** The maintainer guessed the tmux status bar; the arithmetic rules that out on
  its own — the lightest colour that bar requests is `colour8`, which is `#6a6a8c` in Yggdrasil and
  `#3c4812` in Alien Blood, nowhere near. But `status-style bg=default` means "the terminal's
  background", so the guess points somewhere useful: a **light scheme drawn where a dark one was
  expected**. Three bundled ones land almost exactly on the observed colour — `fimbulwinter`
  `#f2f5f8`, `ayu-light` `#f8f9fa`, `catppuccin-latte` `#eff1f5`. Look for a surface taking its
  scheme from the wrong tab, or a per-tab theme where the tab is not the one being drawn.

## Things that are true and will bite you

- **A GUI app has almost no `PATH` — and the login shell is only HALF the fix.** This cost three
  separate defects that looked unrelated, on three different days:
  1. the launcher panel read the *process* `PATH` → "not on your PATH" about a directory in constant
     use;
  2. it then read a **login** shell's (`zsh -l`) → the same message, because `~/.local/bin` is added
     in **`.zshrc`**, which only an *interactive* shell reads;
  3. the usage bars stayed empty, because `claude` lives in that same `~/.local/bin` and
     `which("claude")` therefore found nothing.

  **The capture is `-l -i`** (`terminal::environment`). Measured: 110 ms, once, cached, behind the
  timeout that already existed — the old comment's objection ("prompt frameworks, for an answer that
  does not depend on any of it") was simply wrong here, because the answer depends on it entirely.
  Two tests hold it now: one scans this module for the `-i`, the other scans the WHOLE backend for
  `Command::new("name")` with a bare program name, which searches the process `PATH` and finds
  nothing a user installed. Use `environment::which()` or an absolute path; the exception list in
  that test is for OS-shipped tools only and `claude`/`docker`/`direnv`/`tmux` will never join it.
  **Also true, and unchanged:** `launchctl getenv PATH` is empty, and **none of this reproduces in
  `tauri dev`** — there the app inherits the launching terminal's environment, so a defect of this
  class is invisible in development and total in an installed build.

- **Killing the app with a signal loses window geometry.** The window-state plugin only writes on a
  clean `RunEvent::Exit`; `pkill` never triggers it. `tray.rs::save_geometry` covers the × button,
  hide-to-tray and the tray's Quit. If you restart the app with `pkill` while testing, do not read
  anything into geometry not being restored.
- **`void somePromise` is not error handling.** It satisfies the linter and discards the rejection,
  which this app turns into a fatal screen over the whole interface. The rule that would catch it
  (`no-floating-promises`, `ignoreVoid: false`) is type-aware and this project runs no type-aware
  linting — see the note in `eslint.config.project.mjs`. Until that changes it is a review habit.
- **Screenshots are not available to the agent.** `screencapture` fails with *"could not create image
  from rect"* because the terminal running the agent has no macOS **Screen Recording** permission.
  Granting it (System Settings → Privacy & Security → Screen Recording, for the terminal app) is what
  makes visual verification possible; window geometry can already be read via System Events
  (`osascript -e 'tell application "System Events" to tell process "yggshell" to get {position, size}
  of window 1'`).
- **The upstream is private.** `governance:update` clones over HTTPS and fails under any other GitHub
  account; run `gh auth switch --user kaoszwerg` first. The same applies to `git push`, which flips
  back to the other account on its own more than once per session.

## Deferred by the maintainer

- **Windows and Linux behavioural verification.** The ConPTY path compiles and is untested; so is
  WebKitGTK. Three of this session's defects were platform behaviour in a WebView that no test caught.
- **macOS signing / notarisation.** `release.yml` supports it once the `APPLE_*` secrets exist
  (ADR-APP-023); none are set. Builds are ad-hoc signed, so a fresh `.app` needs right-click → Open.

## Not owed upstream any more

All three defects reported in `docs/upstream-report.md` shipped in `saga-rust-template` v0.10.3 and
were pulled in. Do not re-report them.

**Why:** these are known gaps with their evidence attached, not oversights — recording them keeps a
later agent from re-deriving a diagnosis or "fixing" something the maintainer deliberately deferred.

**How to apply:** pick items from here only when the maintainer asks; verify the unverified ones
before building anything on top of them. See [[project-scope]] for what the product is.
