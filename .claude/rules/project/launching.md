---
id: rule:launching
title: Opening a terminal from outside the app
tldr: ygg and Finder's Open With both arrive as a macOS opened-event; launch.rs validates the path, which becomes a working directory — never a command line.
scope: project
load: conditional
triggers:
  [
    ygg,
    cli,
    launcher,
    launch,
    finder,
    open,
    openwith,
    "open-with",
    association,
    uti,
    plist,
    "info.plist",
    document,
    folder,
    argv,
    deeplink,
    "single-instance",
  ]
applies-to:
  [
    "src-tauri/src/launch.rs",
    "src-tauri/src/cli_install.rs",
    "src-tauri/resources/cli/**",
    "src-tauri/Info.plist",
    "src/hooks/useLaunchRequests.ts",
  ]
---

# Opening a terminal from outside the app

Two routes, deliberately converging on one path through the code:

```
ygg ~/project ──► open -a YggShell <dir> ──┐
                                            ├──► RunEvent::Opened ──► launch.rs ──► event/queue ──► a tab
Finder ▸ Open With ▸ YggShell ─────────────┘
```

## What the path is allowed to be

**A working directory. Never a command line** (ADR-PROJ-001 §5). It arrives from a shell, a drag, a
stale bookmark — untrusted, so `launch::resolve` checks it once, before anything acts on it:

- it must **exist** (a missing path is refused, never quietly replaced by the home directory);
- a **file becomes its parent**, which is what dropping a file on a terminal means;
- it is **canonicalised**, so the tab, the Git tool and the shell agree about where they are.

Anything else is logged and dropped. The shell that runs there is still the one the *settings* choose.

## The cold-start queue is not an optimisation

`ygg .` when the app is **not** running delivers the path while the webview is still loading, so an
emit at that moment reaches nobody — the app opens and the terminal is in the wrong place. So
`launch::Pending` keeps it and the frontend drains it on mount (`pending_launches`). Draining, not
reading: a reload must not reopen terminals the user already has.

**Both halves are needed.** The event alone breaks the cold start; the queue alone breaks the case
where the app is already open. Measured, both ways, against a built bundle.

## Why `open -a` and not the binary

Launching the executable directly starts a **second instance** beside the running one — on macOS a
broken thing, with no dock entry and no focus. `open` hands the path to the instance that is there
and starts one only if there is none. That is the whole reason the launcher is a three-line shell
script rather than a binary.

The script also resolves the path itself, because `open` resolves a relative path against **its own**
working directory: without that, `ygg .` lands somewhere unrelated.

## The Finder association lives in `src-tauri/Info.plist`

Tauri's `fileAssociations` only speaks in **extensions**, and `ext: ["*"]` would register this app as
an opener for every file on the machine — it would appear in every "Open With" menu in the system.
A folder is a **UTI** (`public.folder`), which needs a merged `Info.plist`; Tauri picks that file up
from beside `tauri.conf.json`.

`LSHandlerRank` is `Alternate` on purpose: the app offers itself, it does not claim to be the default
handler for folders. Finder is. Taking that over would be a hostile thing for a terminal to do.

## Installing the command is a button, never a side effect

`cli_install` writes `ygg` and `yggshell` only when Settings › Tools › Command line is pressed. It
prefers `/usr/local/bin` **if it is already writable** — never creating it, never asking for an admin
password — and falls back to `~/.local/bin`, which it may create.

It reports whether that directory is on `PATH`, and the UI says so when it is not: **installed and
not found is worse than not installed**, because the user types `ygg`, gets nothing, and has no
reason to suspect where the problem is.

The candidate list is a **parameter**, not a constant inside `install()`. A test calling it directly
would otherwise write into `/usr/local/bin` on any machine where that is writable — which is most
developer Macs. A test suite that can install software on the machine running it is a defect
(rule:testing).

## Verifying a change here

Unit tests cover the parsing and the file writing, but the wiring — does the OS actually deliver the
event — is only provable against a **built bundle**:

```bash
npx tauri build --config src-tauri/tauri.dev.conf.json --bundles app   # separate identity, safe to run
open -a "…/YggShell Dev.app" /some/dir                                  # cold start, then again while running
grep -E "queued launch requests|outside the app" <app-data>/logs/app.log.*
```

Both lines must appear across the two runs — one per route. Never test this against the app the
maintainer is using (rule:live-app).
