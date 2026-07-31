---
id: mem:open-work-backlog
title: Open follow-up work on YggShell
tldr: "Live backlog + the diagnoses behind them: OSC 7 in tmux unverified, zsh EOL mark, HISTFILE locking, no screenshots without Screen Recording."
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
  ]
applies-to:
  [
    ".github/workflows/**",
    "app.identity.json",
    ".claude/memory/**",
    "governance/**",
    "src-tauri/src/terminal/**",
    "PLAN.md",
  ]
type: project
---

# Open work

**Read this before re-diagnosing anything.** Every entry below was measured, not guessed; repeating
the measurement costs an hour that has already been spent. `PLAN.md` holds the feature roadmap — this
holds defects, their evidence, and the traps around them.

## Defects with a diagnosis, not yet closed

- **OSC 7 inside tmux — fix written, NOT verified.** tmux consumes OSC 7 for its own
  `pane_current_path` and does not forward it, so the Git tool stops following `cd` in a tmux session.
  The hook in `shell_integration.rs` now wraps the sequence in tmux's DCS passthrough
  (`ESC P tmux; <esc-doubled> ESC \`) and turns on `allow-passthrough` for its own pane. **Nobody has
  seen this work.** Verify by: enabling tmux in Settings → Terminal, opening a terminal, `cd` into a
  repository, and watching the Git tool. If it fails, check `tmux show -p allow-passthrough` inside
  the pane first.
- **zsh prints its `%` end-of-line mark at the top of a fresh terminal.** Reproduced in a captured
  PTY stream: our OSC 7 goes out, then `ESC[1m ESC[7m %`. Removing the hook's immediate self-call did
  **not** fix it, so the cause is elsewhere — most likely a column mismatch (zsh's `COLUMNS` vs the
  emulator's real width) making zsh's `mark + COLUMNS-1 spaces + CR` wrap instead of overwrite. Next
  step: capture the stream and compare `stty size` inside the session against `term.cols`.
- **`zsh: locking failed for <appdata>/shell/.zsh_history: no such file or directory`** was seen once
  in a probe. macOS' `/etc/zshrc` sets `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history` and runs *between*
  our generated `.zshenv` and `.zshrc`, which is why the repair line in `.zshrc` exists. Verified
  working once (`HISTFILE=/Users/…/.zsh_history`, 2939 entries) — so this is either a probe artefact
  or a path the repair misses. Re-check with tmux enabled, which changed which files get written.

## Things that are true and will bite you

- **A GUI app has almost no `PATH`.** launchd hands it `/usr/bin:/bin:/usr/sbin:/sbin`;
  `launchctl getenv PATH` is empty. `terminal::environment` captures a login shell's environment once
  and every terminal starts from it. **None of this reproduces in `tauri dev`**, where the app
  inherits the launching terminal — so a bug of this class is invisible until a real build is run.
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
