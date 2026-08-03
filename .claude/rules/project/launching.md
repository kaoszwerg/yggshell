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

## Finder: two separate mechanisms, and they are not interchangeable

Both live in `src-tauri/Info.plist`, which Tauri merges (it looks for that name beside
`tauri.conf.json`). Tauri's own `fileAssociations` cannot express either: it speaks only in
**extensions**, and `ext: ["*"]` would register this app as an opener for every file on the machine.

| Want | Mechanism | Also needs |
| --- | --- | --- |
| **Open With ▸ YggShell** on a folder | `CFBundleDocumentTypes` + `public.folder` | nothing |
| **New YggShell Terminal Here**, right-clicking a window's empty area | `NSServices` + `NSSendFileTypes: public.directory` | a provider registered at runtime (`services.rs`) |

**`public.directory`, not `public.folder`, and the difference is not cosmetic**: the folder type does
not produce the entry in the empty-area menu at all. Copied from Apple's own Terminal.app ("New
Terminal at Folder"), which is exactly this case; `com.apple.resolvable` alongside it is what makes it
work on an alias or a symlink.

**Files are accepted too** (`public.item`) — and the point is that the file is **never opened**.
`launch::resolve` turns it into the directory holding it, so right-clicking a script means "a
terminal where that script lives". That is what a terminal has always done with a file dropped on it,
and it is pinned by a test: whatever comes in, a **directory** comes out.

`public.item` alone is not enough: `public.directory` is what produces the entry on a window's empty
area, where there is no selection at all.

**LaunchServices caches document types per bundle identifier, and replacing the app does NOT
invalidate that cache.** After installing a build that declared `public.folder`, `lsregister -dump`
still had no claim for it and Finder showed nothing; one `lsregister -f` fixed both. So the app
re-registers itself at every launch (`services::refresh_launch_services`) — a single call, and it
makes every future update fix itself instead of needing a terminal command nobody would think to run.

**The document type must be `Role: Editor` with no `LSHandlerRank`.** The first attempt used
`Viewer` + `Alternate`, reasoning that the app should offer itself without claiming to be the default
handler for folders. The reasoning was fine and the result was wrong: **the entry did not appear at
all**. iTerm2 uses `Editor` with no rank — measured in its own `Info.plist` — and Finder still owns
folders either way.

**A Service has two halves, and the second one fails silently when missing.** `NSServices` says what
the item is called and what it accepts; `services.rs` registers the object holding the method
`NSMessage` names. Without the provider the item appears and does nothing — no error anywhere, on
either side. The selector is therefore pinned by a test that reads the plist.

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
npx tauri build --config src-tauri/tauri.dev.conf.json --bundles app --debug   # separate identity, safe to run
open -a "…/YggShell Dev.app" /some/dir                                         # cold start, then again while running
grep -E "queued launch requests|outside the app" <app-data>/logs/app.log.*
```

Both lines must appear across the two runs — one per route. Never test this against the app the
maintainer is using (rule:live-app).

**`--debug` is not optional here, and leaving it off is a build error.** `tauri dev --config` exports
its merged configuration as `TAURI_CONFIG`, and any shell that has run it — an agent's shell,
routinely — still carries the variable. `src-tauri/build.rs` refuses a **release** profile compiled
against the dev identifier outright (rule:live-app: it cost two installations and two diagnosis
sessions), so the same command without `--debug` panics instead of building. The guard is right and
this command is the one that has to move: a verification bundle wants the debug profile anyway — it
builds in a fraction of the time, and nothing here is measuring optimised code. The output then lands
under `target/debug/bundle/macos/`, not `target/release/…`.

The bundle it produces is a **real** bundle — a custom-protocol webview, not `tauri dev`'s
`http://localhost`. That difference is load-bearing for anything the webview is only permitted to do
in a secure context, so a feature that works under `app:dev` and nowhere else is exactly what this
step exists to catch.

For the Finder halves, ask the OS rather than reading the source:

```bash
lsregister -f "…/YggShell Dev.app"                 # register the built bundle
pbs -flush && pbs -dump | grep openTerminalHere    # the menu item the system knows about
grep "registered the Finder service" <app-data>/logs/app.log.*   # the provider half
```

The click itself cannot be driven from a script — that part is the maintainer's to confirm.
