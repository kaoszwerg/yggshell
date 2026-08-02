# Plan — the Notes tool (working title)

**Status: designed and decided, not built.** Every open question was answered by the maintainer on
2026-08-02. What stands between this and code is **ADR-PROJ-003** — the notes sync sends data off the
device, and `rule:privacy` requires that decision to be recorded before it is written, not after.

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

## Decided (2026-08-02)

### Storage — a notes repository the app keeps in sync

Neither of the two options offered. **A dedicated git repository holds the notes, configured once, and
the app manages it automatically** — so any machine running YggShell has them, at any time.

That is a bigger feature than either alternative and it is worth saying what it drags in:

- **It is network egress, and this project forbids that by default.** `rule:privacy`: *no telemetry,
  no remote anything, unless a specific feature requires it — and then as an explicit, opt-in feature
  with its own ADR stating exactly what leaves the device and where to.* So this needs
  **ADR-PROJ-003** before a line is written. It qualifies easily (the user names the remote; nothing
  goes anywhere until they do) but the ADR is not optional.
- **Credentials: none of our business, deliberately.** Shell out to the user's own `git`, which uses
  their SSH agent and their config. The app never sees a token, never stores one, and
  `rule:security`'s "secrets in the keyring" question never arises because there is no secret. It also
  means a repository they can already push to works with no setup at all.
- **Offline is the normal case, not the error case.** Notes are written locally and always readable;
  sync is best-effort and says when it last succeeded. A note must never be lost because a push failed.
- **Conflicts are the part that can lose data**, so they are the part that gets designed rather than
  discovered. Two machines editing the same note is rare and must still be safe: pull with rebase, and
  on a conflict keep *both* versions side by side in the file rather than resolving it silently. A
  merge marker the user can see beats a note that quietly lost a paragraph.

### The agent gets no access

**Full control stays with the maintainer.** The agent does not read and does not write the notes.

Two consequences, and the second is an honest limit rather than a feature:

- It settles the "may the agent write" question outright, and removes the file-watching and
  write-conflict work with it. Version one is smaller for it.
- **It is a design stance, not a boundary that holds.** The agent runs as the same user on the same
  machine and can read any file it is pointed at. What this decision buys is that nothing *invites* it:
  the notes are not in the project repository, the path is not advertised to it, and no tool hands it
  over. A determined agent is not stopped by any of that, and pretending otherwise would be the kind
  of claim `ADR-CORE-004` exists to prevent.
- The hand-over therefore runs entirely through **you**: copy, or type into the prompt. Which was the
  recommendation anyway — the agent reading the file directly was only ever the shortcut.

### Surface — a tool and a view over one reader

As proposed: the tool is the list and the quick capture, the view is where you write and search. One
store, two renderings, never two readers (`mem:surfaces`).

### Layout — a folder per project, several files in it

```
<notes-repo>/
  <project>/
    inbox.md          ← where a quick capture lands with no topic chosen
    <topic>.md
```

Which raises the one question these answers created, below.

### Configuration — the repository is named by the user, and nothing happens before it is

**Settings › Notes**, and it is the on-switch as much as a setting: with no repository configured the
tool is local-only and **nothing leaves the device**. That is not a nicety, it is what makes the
feature satisfy `rule:privacy` at all — egress is opt-in, and the opt-in is naming a remote.

What is configurable:

| | |
| --- | --- |
| **Remote URL** | Any repository the user can already push to (`git@…`, `https://…`). Empty means local-only. |
| **Branch** | Defaults to the remote's default. Named, so a shared repository can keep notes on their own branch. |
| **Sync on/off** | Independent of the URL: keep the remote configured and pause syncing without losing it. |
| **Status** | Last successful sync, and the last error verbatim if there was one. |
| **Disconnect** | Stops syncing and keeps every local note. |

Three things that must be decided *because* it is configurable, and would otherwise be discovered:

- **Where the clone lives is NOT configurable.** It sits in the app's data directory, managed by the
  app. A user-chosen checkout would be a second thing to keep consistent and a way to point the app at
  a working tree somebody else is using. The path is *shown*, because a directory you cannot find is a
  directory you cannot back up.
- **Changing the remote must not silently discard notes.** Local notes are kept and offered to the new
  repository; the old clone is left on disk rather than deleted. "I switched the URL and my notes were
  gone" must be impossible, and the safe answer costs nothing but disk.
- **A URL that does not work is reported where it was typed**, with git's own message. A sync that
  fails silently is the worst version of this feature: it looks like it is working and the second
  machine is simply empty.

### Project identity — the git remote, falling back to the folder name

`github.com/kaoszwerg/yggshell` becomes the folder name, so the same project is the same folder on
every machine however differently it is checked out. No remote falls back to the folder name.

**The key is shown and can be changed**, and that part is not decoration: a wrong guess otherwise
splits a project's notes in two and nothing says so — the same silent-divergence failure as a stale
cache. A repository with two remotes, or none, needs a way out that is not "rename your folder".

### Sync — automatic, with the last success visible

Pull on start and on window focus; commit and push after an edit, debounced. A manual push stays, for
the moment the network comes back.

**The visible "last synced" is the honest half of "automatic".** This app has now twice concluded that
a panel you must click to trust is wrong the rest of the time (`mem:surfaces`); a sync that silently
stopped three days ago is the same failure with worse consequences.

### One repository for everything

One notes repository, a folder per project inside it. One setup, one sync, one conflict story, and
cross-project search costs nothing.

### Conflicts — keep both, visibly

Rebase; on a conflict, both versions stay in the file, marked, and the user resolves them when they
next look. The file is briefly ugly and nothing is ever lost.

The alternative — newest wins — is clean and silently drops a paragraph written on the other machine,
which is discovered only by going to look for it. Stopping the sync and demanding a resolution is safe
and turns the tool into something to manage, which is what this whole app keeps refusing to build.

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
