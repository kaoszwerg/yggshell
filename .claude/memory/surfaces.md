---
id: mem:surfaces
title: View, tool, status item — the three surfaces, and why "widget" is not one
tldr: "Every feature is one of three surfaces: a view REPLACES the page, a tool ACCOMPANIES the terminal, a status item is a GLANCE. Decide before building."
scope: project
load: core
type: project
---

# The three surfaces

Everything the user can be shown is exactly one of these. The code has drawn the line all along —
three id types, three directories — and only the informal word **"widget"** ran across all of them,
which is what made "is this a sidebar widget or a status bar add-in?" a question at all. It is not a
naming quibble: the answer decides where the code goes, what it may cost, and how it is added.

|                | **View**                          | **Tool**                                     | **Status item**                                    |
| -------------- | --------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Where          | replaces the page                 | its own column beside the terminal            | one cell in the footer                              |
| The terminal   | hidden while it is open           | keeps running, keeps the rest of the width    | untouched                                           |
| Id type        | `ViewId` (`src/store/ui.ts`)      | `ToolId` (`src/store/ui.ts`)                  | `StatusItemId` (`src/lib/statusBar.ts`)             |
| Lives in       | `src/views/`                      | `src/components/tools/`                       | `src/components/layout/statusItems.tsx`             |
| Adding one     | file + rail entry + `App.tsx` case | id + entry in `TOOLS` + its content           | id + renderer + two messages per language           |
| Placement      | fixed, in the rail                | fixed, in the rail                            | **the user drags it**; spacers may repeat           |
| Today          | Terminal, Logs, Settings          | Git, Files, Agent, Activity, Docker, tmux     | version, repository, command, cwd, tmux, load, bells |

## The distinction is a decision, not a label

- A **view** *replaces*. Use it when the terminal is irrelevant while you are looking (settings, logs).
- A **tool** *accompanies*. Use it when you look at it **and** the terminal together — which is the
  whole reason the column exists, and why a tool is never a view.
- A **status item** is *a glance*: one line, no interaction beyond a tooltip, and it must still make
  sense at six characters wide.

Getting it wrong is not cosmetic. A tool put in the footer cannot be read; a glance given a whole
column costs the terminal half its width to show one number. Ask: **does the answer need scrolling,
selection or a layout of its own?** Then it is a tool. **Does it answer a question in a few
characters?** Then it is a status item.

**tmux is the current example of a subject that earns two**, and of how they differ: the status item
answers *which session is this tab in* (per tab, from `attached::session_on_tty`); the tool answers
*which sessions exist on this machine* and lets you act on them (`tmux_sessions`). Different
questions, so different readers — what may never happen is the item growing a cheaper copy of the
tool's list.

## Where both are right, they are two surfaces over ONE source

Some subjects deserve both — the planned agent session is a tool (what it is doing, which files,
which model) *and* a status item (how full the context is). That is **one reader with two
renderings**, never two readers (ADR-CORE-005). The status item may not grow a second, cheaper copy
of the tool's parsing, or the two will disagree in front of the user.

## A tool that is on screen must be current — a glance is the whole contract

A tool *accompanies* the terminal, which means it is read **while** you work rather than opened to be
consulted. That decides how fresh it has to be, and the answer is not "fresh when you ask for it":

> *"Ich will auf einen Blick die aktuelle Situation erfassen können, nicht durch Rumklicken."*

**A panel you have to click to trust is correct at the instant you click it and convincingly wrong
every instant after** — which is worse than one that is obviously empty, because it is read as true.
Three of them shipped that way (Activity behind a refresh button, Files with no interval, Docker's
container list at `staleTime: Infinity`) and each was reported as pointless, in those words.

Two mechanisms, and neither alone is enough:

- **A command ending re-reads what the terminal produces.** OSC 133 already reports the boundary and
  the store carries it per pane (`hooks/useRefreshOnCommandEnd`). Earlier than a timer can be, free
  while nothing happens, and it fires on the **edge** out of `running` — a state check would re-read
  on every title change. It watches every tab: a build finishing over there writes the file you are
  looking at over here.
- **A poll while the tool is on screen.** A dev server that opens a port ten seconds into a run
  crosses no boundary, and neither does a watcher writing files. `refetchInterval` alone is right:
  TanStack stops it when the query unmounts *and* when the window is hidden, so it costs nothing
  closed or in the background. That is what makes even two process spawns per read affordable.

**The exception is the signal, not the tool.** `rule:attention-signals` needs
`refetchIntervalInBackground: true` precisely because its job is to reach somebody looking elsewhere.
A tool's job is the opposite — it is read by somebody looking at it — so it must stop when they are
not. Do not copy either setting to the other kind of surface.

Cost is a real argument and it is not this one: it decides the *interval*, never whether a visible
panel updates at all.

## The rail is not a fourth surface

`Sidebar.tsx` holds three groups — main nav, tools, secondary nav — and they map onto the table
above. Adding an entry there is how a view or a tool becomes reachable; it is not a place features
live.

**Why:** the question "which surface?" is asked before every feature in `PLAN.md` Phase 5, and
answering it wrong costs a rewrite rather than a rename — the id type, the directory and the way it
is registered all differ.

**How to apply:** name the surface in the plan **before** writing code, in these words rather than
as "a widget", and put the file where the table says. Where a subject deserves two surfaces, write
the reader once and render it twice. See [[project-scope]] for what earns a place at all.
