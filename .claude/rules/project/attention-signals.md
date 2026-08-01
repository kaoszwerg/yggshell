---
id: rule:attention-signals
title: A signal that reaches someone who is looking elsewhere
tldr: An attention signal must not depend on a mounted panel, on the front tab's cwd, or on the window being visible. State, never a log. Marks the tab.
scope: project
load: conditional
triggers:
  [
    attention,
    signal,
    notification,
    notify,
    alert,
    bell,
    hook,
    waiting,
    idle,
    poll,
    polling,
    refetch,
    refetchinterval,
    background,
    hidden,
    visibility,
    occlusion,
    badge,
    mark,
    marker,
    tab,
    unread,
    queue,
    events,
  ]
applies-to:
  [
    "src/hooks/useAgentAttention.ts",
    "src/hooks/useAttentionBell.ts",
    "src/components/tools/AttentionPanel.tsx",
    "src-tauri/src/agent/hooks.rs",
    "src/store/terminal.ts",
  ]
---

# A signal that reaches someone who is looking elsewhere

An attention signal has exactly one job: **tell you about something you are not currently looking
at.** Every requirement below follows from that sentence, and every one of them was broken at once in
the first implementation — which is why the feature looked absent rather than broken, for days, while
the events sat correctly in the file the whole time.

## The four ways it silently switches itself off

Each of these was real here, and each alone is enough to kill the feature.

1. **Mounted inside the thing it reports on.** The query lived in `AttentionPanel`, which rendered
   only when the front tab had a recognised agent session. **An unmounted query polls nothing.** So
   the signal worked only when you already had the panel open — the exact case where you do not need
   it.
2. **Gated on the front tab's state.** It was `enabled: cwd !== null`, keyed to the *active* tab's
   directory. The events are machine-wide and are *about other tabs*; making them depend on this one
   meant a terminal that had not yet reported its directory silenced the whole app.
3. **Paused when the window was not visible.** TanStack Query stops an interval refetch as soon as
   the page is `hidden`, and macOS reports a window as hidden the moment another app fully covers it.
   Default behaviour, correct for everything else, fatal here: it sleeps precisely when you are
   working in another window.
4. **Rendered where you would have to go looking.** A panel inside a collapsible tool is not a
   signal, it is a report. The signal is the **mark on the tab**.

## The rules

- **Poll at the shell root**, never inside the component that displays it. `useAttentionBell` runs in
  `App.tsx` for exactly this reason. A panel may *also* render it; it may never be what keeps it
  alive.
- **`refetchIntervalInBackground: true` — for this query and no other.** It is the one poll whose job
  is to reach a user who is looking somewhere else. Every other poll in this app deliberately stops
  when hidden: a git status nobody can see is wasted battery, and that default is a feature.
- **Never gate it on the active tab.** Anything the front tab contributes (here: which account's
  settings to check) is optional and costs only itself when absent.
- **It marks the tab.** Reuse `ringBell` rather than inventing a second mark: that one already skips
  the tab in front, already clears on a visit, and is already counted in the status bar. Two marks
  drift, and then they disagree in front of the user (ADR-CORE-005).

## State, not a log — and nothing to manage

The events file is append-only and nobody prunes it. Reporting *its contents* meant reporting every
turn that had ever finished, until somebody pressed a button.

- **Only an event that asks for something counts.** `Stop` fires at the end of every single turn; it
  means "finished", which is the opposite of "waiting for you". A mark that is always on is not a
  signal.
- **The newest event per directory IS the state** (`hooks::waiting_now`). When the user answers, the
  agent runs on and its next event replaces the question — so the entry clears **by itself**, with no
  "mark as seen". Clearing by hand may stay possible; it must never be the only way out.
- **The maintainer's words, and they are the acceptance test:** *"ich will das nicht zu einer
  arbeitsquelle machen die ich auch noch managen muss"* — current, informative, self-clearing.

## Read the tail, never the file

An append-only file grows with how much the app has been used. Reading it whole on every poll is a
feature that gets slower the more useful it is. Read a bounded tail (`agent::read_tail`, reused —
same function, same first-line trap) so the cost is the same in month six as on day one.

**And bound a search by what it READS, not by how many files it opens.** The transcript search
counted six candidates; every slash command mints a fresh ~5 kB transcript newer than the live
session, so a few minutes of work pushed the real one out of view. A fixed count is a race against
the user's own typing, and raising the number is the same bug with more headroom. A budget is not:
cheap files draw on it in proportion to what they cost.

**Why this is a rule and not a lint:** every one of these is a *default* being correct somewhere else
in the same app. `enabled`, a paused background refetch, a query inside the component that shows it —
all four are good practice for an ordinary panel, and only wrong for the one surface whose purpose is
to reach somebody who is looking away. No checker can tell those apart; the question "does this have
to work while nobody is looking at it?" is the whole judgement.
