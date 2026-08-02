# Plan — the Notes tool (working title)

**Status: a plan, not a decision.** Nothing here is built. Six questions below need an answer before
anything is; they are marked **DECIDE**. Raised 2026-08-02.

## What was asked for

Tasks and todos, split by project, checkable. Kept as rendered markdown, so a task can carry a
description. Lists with priorities. Somewhere to put what is still to be discussed with the agents, and
what the next prompt should say. Notes that can be found again — searchable and indexable. And content
that can be copied out of it: the whole thing, a code block, a paragraph.

## What it actually is, and why that decides everything else

It is not a notes app. Every part of the description points the same way: **it is the staging area
between you and the agent.**

- "what the next prompt should say" — written here, handed over there
- "what is still to be discussed with the agents" — a queue whose consumer is a conversation
- "copy code elements, text blocks" — because the destination is a prompt
- "per project" — because the agent works in one repository at a time

That is what makes it belong in YggShell rather than in any of the fifty tools that already track
todos. **If a feature does not make the hand-over to the agent shorter, it is a notes app feature and
belongs to somebody else.** That is the test to apply to everything below.

Two consequences fall straight out of it, and neither was asked for explicitly:

- **Handing over must be one gesture.** Copy is one. Better is the one this app already has: *type it
  into the terminal* — the mechanism built for `cd` in 0.40.0, which puts text at the prompt without
  running it. A note becomes a prompt without touching the clipboard.
- **Capture must be one gesture too.** A staging area you have to retype into is a staging area you
  stop using. What you are looking at when the thought arrives — a file path, a diff line, a failed
  command, a question the agent asked — should become a note where it is.

## What is missing from the description

Answering "what am I forgetting":

1. **Getting things IN.** The description is all about structure and none about capture. Without
   capture-from-context this is a text editor in a sidebar.
2. **Getting things OUT.** Copy was mentioned late and is the whole point; "send to the terminal"
   was not mentioned at all and is better.
3. **What happens to finished items.** A list that only grows becomes unreadable — the exact failure
   the attention signal was rebuilt to avoid (`rule:attention-signals`: *current, informative,
   self-clearing*). Ticking something must move it out of the way without deleting it.
4. **Who else writes to the file.** If the agent can read and edit the notes, half the hand-over
   disappears — but then two writers share one file and external changes must be noticed.
5. **What "project" means** when a tab is in `~/` or in a worktree.
6. **Where it lives**, which decides portability, agent access, and whether it survives moving a repo.
7. **Dates and reminders — an explicit NO.** *"Ich will das nicht zu einer Arbeitsquelle machen die ich
   auch noch managen muss."* A due date makes the tool demand things. Priorities are a sort order, not
   a schedule.

## Open decisions

### DECIDE 1 — where the notes live

| | In the repository (`.ygg/notes/*.md`) | In app data, keyed by project path |
| --- | --- | --- |
| The agent can read them | **yes, directly** | only if told the path |
| Survives cloning elsewhere | yes | no |
| Versioned, diffable | yes | no |
| Pollutes the project | yes — needs `.gitignore` or a commitment to commit them | no |
| Personal notes in a shared repo | awkward | fine |
| Works outside a repository | no | yes |

**Recommendation: app data, with the file path exposed.** Notes are personal and half of them are
about the agent rather than the code; putting them in the repo forces a decision about committing them
on every project. The agent can still read them — the tool shows the path and can type it into the
prompt, which is the same hand-over gesture as everything else.

**But it is genuinely close**, and repo-resident wins outright if the answer to DECIDE 4 is "the agent
should edit them too".

### DECIDE 2 — one file per project, or many

One file is simpler, diffs cleanly, and search is trivial. Many files (one per topic) scale better for
"notes I want to find again" and make a note addressable. **Recommendation: one file per project to
start**, with headings as the structure. A note that deserves its own file is a sign the tool works and
can be added later without moving the data.

### DECIDE 3 — markdown as the source, or a database

Markdown is the source of truth in either case (it is what "rendered markdown" means). The question is
whether search needs an index.

**Recommendation: no database yet.** Notes are kilobytes; a scan is instant at this scale. SQLite would
need its own ADR (`rule:stack-tauri`: *a database arrives only with the feature that needs one*), and
the feature that needs one is cross-project search over years of notes — not this.

**Priorities as a markdown convention, not metadata**: `- [ ] !! ship the thing`. The file stays a file
anyone (and any agent) can read.

### DECIDE 4 — may the agent write to the notes?

Powerful: "add what we just decided to the notes" is exactly the hand-over in reverse. It also means
the file changes under the tool, so the tool must watch it and reload, and a half-typed note must not
be lost when it does.

**Recommendation: not in the first version, and design for it.** Watching the file is small; the
editing conflict is not. Ship read-and-write-by-the-user first, with the path visible so the agent can
be *told* to read it.

### DECIDE 5 — which surface

`mem:surfaces` insists this is decided before code. It needs scrolling, selection and a layout, so it
is a **tool**. But writing prose in a 280 px column is unpleasant, and this is a writing tool.

**Recommendation: a tool AND a view over one reader** — the case `mem:surfaces` already names. The tool
is the list and the quick capture; the view is where you write. One store, two renderings, never two
readers.

### DECIDE 6 — checkboxes in rendered markdown

Clicking a rendered checkbox must write back to the source line, which is the one genuinely fiddly
part. Rendering with a parser that keeps source positions makes it exact; without one it is a
line-number guess that breaks on a task whose text appears twice.

**Recommendation: render with position information** and treat "which source line is this checkbox"
as a pinned test, not a hope.

## Shape of the first version

Only what serves the hand-over:

1. **A file per project**, markdown, rendered, edited in a view.
2. **Checkboxes that tick**, with done items collapsing under a fold rather than vanishing.
3. **Priorities as a convention**, sorted on display.
4. **Copy: everything, a block, a code fence** — a copy control per block, the way documentation sites
   do it.
5. **Send to terminal**, reusing the typed-not-run mechanism from 0.40.0. This is the feature the tool
   exists for.
6. **Capture from context** — at minimum: a file path from the file browser, a commit from the Git
   tool, the front tab's directory. Each as one menu entry that appends a note.
7. **Search across projects**, plain text, over the markdown.

## Explicitly not in it

- Reminders, due dates, notifications. It must not become a source of work to manage.
- Sharing, sync, accounts.
- Editing anything outside its own files.
- A second attention mark. The tab's bell is the one signal; a note does not compete with it
  (`rule:attention-signals`: two marks drift, then disagree in front of the user).

## What it costs

New: one Rust module (read, write, list, search), one DTO, one view, one tool, a markdown renderer
with source positions (`Markdown.tsx` exists — check whether it keeps positions before assuming), the
capture entries in three existing menus, and i18n for all of it. No new dependency if the existing
renderer is enough; a parser change needs the dependency gate (`rule:dependencies`).

The riskiest part is not the code. It is that a staging area which is *slightly* more effort than
retyping gets abandoned in a week — which is why capture and hand-over are numbered 5 and 6 above
rather than left for later.
