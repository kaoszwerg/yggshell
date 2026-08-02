---
id: rule:live-app
title: The maintainer is using this app while you work on it
tldr: YggShell is the maintainer's daily terminal AND the thing being built. Never kill or replace a running instance; dev and prod stay separate installs.
scope: project
load: core
triggers:
  [
    build,
    dmg,
    release,
    kill,
    pkill,
    killall,
    restart,
    dev,
    app:dev,
    tauri,
    instance,
    running,
    settings,
    app-data,
    localstorage,
    identifier,
    bundle,
  ]
applies-to:
  [
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/tauri.dev.conf.json",
    "app.identity.json",
    "scripts/project/**",
  ]
---

# The maintainer is using this app while you work on it

YggShell is not a project that gets launched to be tested. It is **the terminal the maintainer works
in, right now, possibly the one this agent session is running inside**. That changes what "build it
and try it" is allowed to mean.

## The hard rule

**Never terminate, restart or replace a running YggShell.** No `pkill`, no `killall`, no
`kill <pid>` against an app process, no "I'll just restart it to pick up the change". If a change
needs a running app restarted, **say so and let the maintainer do it** — they are the only one who
knows whether the window has work in it.

That includes the indirect routes: do not `rm` an installed `.app` while it runs, do not run an
installer that replaces it, do not `tauri dev` in a way that takes over an instance the maintainer
started.

The one exception is an instance **this session started itself**, for a measurement, with nothing
else in it — kill that by its own PID, never by name, because a name matches theirs too.

## Dev and prod run at the same time, and never touch each other's state

Both are expected to be running: production for real work, development for what is being built.
They are separated by identifier, and the separation is **measured, not assumed** (2026-07-31):

| What                | Production                                             | Development                                           |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Identifier          | `com.kaoszwerg.yggshell`                               | `com.kaoszwerg.yggshell.dev`                          |
| Name                | YggShell                                               | YggShell Dev                                          |
| Settings, logs, crashes | `~/Library/Application Support/com.kaoszwerg.yggshell/` | `…/com.kaoszwerg.yggshell.dev/`                       |
| WebView `localStorage` (tabs, themes, status bar) | `~/Library/WebKit/com.kaoszwerg.yggshell/` | `~/Library/WebKit/yggshell/` (unbundled dev binary) |

The last row is the one that surprises: `tauri dev` runs the **unbundled** binary, so WebKit keys its
storage on the process name rather than a bundle identifier. Separate either way — but it is separate
*for a different reason* than the rest, so a change that starts bundling the dev build must re-check
it rather than assume the row still holds.

**Nothing may reach across.** A migration, a cleanup, a "reset the settings" helper operates on the
directory of the app it is running in — never on both, never on a hardcoded path.

## Building does not disturb a running app

`npm run app:dev` and `tauri build` write to `src-tauri/target/` and `src-tauri/gen/`. A Unix process
keeps running from its original inode when the file is replaced, and the installed `/Applications`
bundle is not touched by a build at all — so **a build is safe to run while the maintainer works**.

Installing is not: mounting and copying a fresh DMG over a running `/Applications/YggShell.app` is
exactly the "replace it while it runs" case above. **Build the DMG, report where it is, and let the
maintainer install it.**

## Build a release with `npm run app:build` — never a bare `tauri build`

`tauri dev --config src-tauri/tauri.dev.conf.json` exports its merged configuration as **`TAURI_CONFIG`**,
and `tauri build` reads that same variable. An agent shell that has it set therefore compiles a release
against the **dev** identity: the bundle says `com.kaoszwerg.yggshell`, installs, starts — and resolves
`app_data_dir()` to `…/com.kaoszwerg.yggshell.dev/`. Every setting, note and log looks **gone**, the real
ones sit untouched next to it, and nothing reports an error. It has now cost the maintainer two
installations and two diagnosis sessions.

```bash
npm run app:build   # strips TAURI_CONFIG, builds, then verifies the identity inside the binary
```

`src-tauri/build.rs` refuses the poisoned combination outright (a release profile plus a `TAURI_CONFIG`
naming the dev identifier is a build error), and `scripts/project/check-release-identity.mjs` re-checks
the finished binary. The gate exists because the symptom points nowhere near the cause — but the command
above is the one to type.

## Why this is a rule and not a comment in a script

The failure is silent and total: the maintainer loses every open tab, every running command, and the
session the agent itself is talking through — and the agent has no way to notice it happened. There is
no gate that can catch it either, because the dangerous command is an ordinary one that is correct in
every other repository. `scripts/project/check-no-process-kill.mjs` (in `check:all`) refuses the
obvious spellings in committed scripts, which is the part that *can* be enforced; the rest is this
document, loaded at boot because an agent about to run `pkill` does not search for a rule about
`pkill`.
