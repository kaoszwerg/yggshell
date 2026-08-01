---
id: rule:shortcuts
title: Keyboard shortcuts, and the keys that are not ours to take
tldr: A shortcut must carry ⌘ (macOS) or Ctrl+Shift (elsewhere) — anything else reaches the shell. Enforced in lib/shortcuts, not merely documented.
scope: project
load: conditional
triggers:
  [
    shortcut,
    shortcuts,
    keybinding,
    keybindings,
    hotkey,
    keyboard,
    keydown,
    accelerator,
    binding,
    ctrl,
    cmd,
    meta,
    sigint,
    help,
  ]
applies-to:
  [
    "src/lib/shortcuts.ts",
    "src/hooks/useShortcuts.ts",
    "src/components/settings/ShortcutEditor.tsx",
    "src/components/ui/TerminalSurface.tsx",
  ]
---

# Keyboard shortcuts, and the keys that are not ours to take

## The rule that is not configurable

**A shortcut must carry the modifier the terminal never receives**: `⌘` on macOS, `Ctrl+Shift`
everywhere else. Anything else — a bare key, `Ctrl+C`, `⌥`+something — belongs to the **shell**, and
binding it would take `SIGINT`, `EOF` or reverse-search away from every program the user runs, with no
way for them to get it back.

This is a **gate, not a paragraph**: `isReservedForShell` refuses the binding in the editor, and
`sanitiseBindings` refuses it again on the way out of `localStorage`, so a hand-edited payload cannot
smuggle one in. The test that matters most asserts the negative — `Ctrl+C` and friends reach the
terminal untouched.

The test is about **modifiers, not keys**, and deliberately so: which letters a given program cares
about is unknowable, but "this arrives as a control character" is not.

## Where the pieces are

| Piece | File |
| --- | --- |
| Actions, defaults, matching, the shell rule | `src/lib/shortcuts.ts` |
| Running them (one window listener) | `src/hooks/useShortcuts.ts` |
| Rebinding them, and the help list | `src/components/settings/ShortcutEditor.tsx` |

**Adding an action** is three things: an id in `ACTIONS`, a default in `defaultBindings` for both
platforms, and a case in the runner. Two messages per language follow from the id
(`keys.action.<id>`), and the compiler asks for them.

## Why the list in Settings *is* the help

A separate help page listing defaults is wrong the moment somebody rebinds one — and then it is worse
than no list, because it names a key that does nothing. The Keyboard section reads the same store the
runner does, so it cannot go stale.

## Two things that are easy to get wrong

- **Listen on the window, not on the emulator.** xterm's key handler only fires while the terminal
  holds focus, so a binding there is unreachable the moment the caret is in a search box or on the
  settings page. `preventDefault` is called **only** when something actually matched — everything
  else must still reach the terminal.
- **Recording captures.** While a row is recording, the editor listens in the **capture phase** and
  stops the event, or binding `⌘W` would close the tab on the way to being bound.

## Clearing the screen sends a key, not a command

`clear` sends `Ctrl+L` through the same channel as typing, and the shell answers by redrawing its
prompt. It is a method on the terminal handle (`clear()`), never "send this string": a general
send would be a way for the interface to put a **command** into a terminal, which ADR-PROJ-001 §5
forbids — the webview never chooses what runs.
