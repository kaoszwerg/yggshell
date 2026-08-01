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
| Today          | Terminal, Logs, Settings          | Git                                           | version, repository, command, cwd, tmux, load       |

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

## Where both are right, they are two surfaces over ONE source

Some subjects deserve both — the planned agent session is a tool (what it is doing, which files,
which model) *and* a status item (how full the context is). That is **one reader with two
renderings**, never two readers (ADR-CORE-005). The status item may not grow a second, cheaper copy
of the tool's parsing, or the two will disagree in front of the user.

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
