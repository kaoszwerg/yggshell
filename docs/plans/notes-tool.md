# Plan — the Notes tool (working title)

**Status: fully decided, not built.** Every question is answered — the maintainer's on 2026-08-02, and
the ones the answers themselves created, taken here rather than left for whoever writes the code. That
is deliberate: this is to be **implemented autonomously**, so an unanswered question in this document
would become an invented decision at the keyboard, which `rule:clarify-and-plan` forbids as squarely as
`rule:no-guessing` forbids an invented fact.

The one thing that must exist before the first line of code is **ADR-PROJ-004**: the sync and the
remote-image loader both send data off the device, and `rule:privacy` requires that recorded *before*
it is written, not after. What it has to say is listed at the end; none of it is an open question any
more, all of it is writing.

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
  **ADR-PROJ-004** before a line is written. It qualifies easily (the user names the remote; nothing
  goes anywhere until they do) but the ADR is not optional.
- **Credentials: none of our business, deliberately — and this is how a tokenless app pushes.** The
  app shells out to the user's own `git`, which finds the credentials where they already are: the SSH
  agent for `git@…`, the platform credential helper (osxkeychain, manager, libsecret) for `https://…`,
  plus `~/.gitconfig` and `~/.ssh/config`. Nothing is copied, stored or transmitted. `rule:security`
  says a client may learn *that* a credential exists and never its value; here it does not learn even
  that. A repository the user can already push to from their terminal works with no setup at all.

  **The mechanism exists already** — `git/fetch.rs`, built for the auto-fetch (ADR-PROJ-002) — and the
  notes sync reuses it rather than inventing a second way to run git:

  - `environment::which("git")` resolves the binary from the **captured login environment**, not from
    the process's own `PATH`. That distinction is not theoretical: this app is launched from the dock,
    not from a shell, and the capture had to be fixed once already because `~/.local/bin` is added in
    `.zshrc` and was therefore invisible — three separate symptoms, one root.
  - **Every prompt is disabled**: `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=`, `SSH_ASKPASS=`, and
    `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`. There is no terminal attached to a background sync, so a
    credential prompt would block until the timeout with nothing on screen to explain it — a silent
    hang, which is the failure this project refuses on principle (`rule:crash-handling`).
  - **A deadline on its own thread**, because `Command` has none and an unreachable host would
    otherwise hold the sync indefinitely.

  **The honest consequence, stated rather than discovered:** a key with a passphrase that is not in the
  agent means the sync will *never* succeed — `BatchMode` makes it fail instead of asking. That is the
  right trade for a background task and it is exactly why the status line carries **git's own error,
  verbatim**: "Permission denied (publickey)" is actionable, "sync failed" is not.

  **One addition over the fetch path**, because pushing raises the stakes: `SSH_AUTH_SOCK` is carried
  over from the captured login environment when the app's own process lacks it. Otherwise "it works in
  my terminal but not in the app" is a real and very confusing state on a desktop launch.
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

**This question was left dangling by the answers above and is now decided: what are topics, in the
interface?** Several files per project is a storage layout; it says nothing about who makes a topic,
what the narrow column shows when a project has five of them, or where a quick capture lands once a
topic exists. Each part below follows from a rule already in force rather than from taste:

- **The tool shows one project as ONE list**, its topic files as sections, `inbox` first. No file
  picker in a 280 px column: *"ich will auf einen Blick die aktuelle Situation erfassen können, nicht
  durch Rumklicken"* was said about exactly this kind of panel.
- **A quick capture always lands in `inbox.md`.** Capture is one gesture; a "which topic?" prompt makes
  it two, and a staging area that costs two gestures is one you stop using (see the closing paragraph).
- **Topics are made in the VIEW, never in the tool** — a new file, renamed and deleted there. Filing a
  captured note into a topic is a deliberate act, and deliberate acts belong on the page with room for
  them.
- **Which project is shown follows the front tab.** This is a panel you are reading, not a signal that
  has to reach you elsewhere, so `rule:attention-signals`' warning about front-tab gating does not
  apply — the opposite does. A tab with no project falls back to a shared `_inbox` folder, so a thought
  is never refused for being had in the wrong window.

### Getting into the view — from the tool, never from a second rail entry

The plan said "the tool is the list, the view is where you write" and never said how you cross. Notes
is the **first feature in this app that is both**: every tool so far escalates inside itself (the Git
tool's detail panel), and every view so far has no tool. So the route has to be decided rather than
inherited.

- **One rail entry**, in the tools group, toggling the column exactly like `git` or `files`. The rail
  is one entry per thing; a second "Notes" beside it would be two marks for one feature, which is the
  failure `rule:attention-signals` describes — they drift, and then they disagree in front of the user.
- **One shortcut, not two.** `toggleNotesTool`, `⌘N` / `Ctrl+Shift+N` — free in this app, mnemonic,
  and the same shape every other tool has (`⌘G` Git, `⌘E` files, `⌘J` activity, `⌘D` Docker, `⌘I`
  agent). The **view has no binding of its own**: it is reached from the tool, by its header control
  or by clicking an item, so a second near-identical combination never has to be remembered.
  Not `⌘B`: that is bold in every editor, and this feature has a text editor in it.
  (Unrelated gap found while checking: `toggleTmuxTool` has no default binding at all — the tmux tool
  is mouse-only today. Its own change, not this one.)
- **Opening a note from its `⋮` menu** goes to the view with that file open, at that note.
- **The tool STAYS OPEN beside the view — it is the navigation.** This replaces the opposite decision
  taken an hour earlier, and the maintainer's sentence is what corrects it: *"das Widget selbst ist die
  Navigation und das Tool zum Abhaken, die Detailinformationen und die Edits finden im View statt."*

  The earlier reasoning — that `ToolPanel` renders in every view, so the column would show the same
  notes twice — was right about the mechanism and wrong about the content. The two surfaces do not
  show the same thing: the column is the **list** and the page is **one note**. That is master and
  detail, not a duplicate, and it is the arrangement the column's width was always right for.

  What follows from it, and it is a boundary rather than a preference:

  | | The tool | The view |
  | --- | --- | --- |
  | Shows | one line per item: checkbox, priority, title | the note itself, in full |
  | Never shows | a body, a code block, a table, an image | — |
  | You can | tick, capture, search, navigate | read, edit, copy a block |

  **A note's body does not appear in a 280 px column.** The moment it does, the column stops being a
  list you can take in at a glance — which is the failure `mem:surfaces` describes and the maintainer
  has already objected to once, about panels: *"ich will auf einen Blick die aktuelle Situation
  erfassen können."*

- **Search lives in the tool**, because search is navigation. It spans every project; results replace
  the list, and picking one opens that note in the view.

- **The view therefore carries no file tree of its own.** A second navigator beside the first would be
  two things to keep in agreement (`ADR-CORE-005`). When the tool is closed the view's header shows
  `project · topic` and a control that opens the tool — the navigator is fetched, never duplicated.
- **Back is the rail**, like every other view. There is no special exit, and nothing to learn.

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

### Capture is one gesture, and it grows

**A captured line is not just a heading.** As first drawn the field took one line, which makes the
smallest thought cheap and a three-line one a trip to the view — and a staging area that is *slightly*
more effort than retyping is the failure mode named at the bottom of this plan.

- **Enter files it. Shift+Enter adds a line.** The field grows with the text. A one-liner is one
  gesture and so is a paragraph; there is no mode, no dialog and no second surface.
- That is also the split the maintainer already types every day: YggShell sends `Shift+Enter` to the
  harness as a newline (`rule:shortcuts`). The same keys mean the same thing one panel over.
- **A captured item is a task** — `- [ ] …`, with any further lines indented under it as its body.
  Not because everything is a todo, but because everything here is *handed over and then done*, which
  is what a checkbox says and what makes the done-fold work for prompts as well as chores.
- **A leading `!` or `!!` sets priority** and is stripped from the text. That is the whole syntax; a
  capture field with a language to learn is a capture field you avoid.

### Writing markdown against seeing it — per block, never a mode

**`lib/markdown.ts` is not enough, verified rather than assumed** (the check this plan asked for). It
has no task items, no fenced code blocks — only inline `code` — and, decisively, **no source
positions**. It was written to render two documents that ship in the binary, and says so.

**Reading and writing are two states, named, and you are always in exactly one.** This is a revision:
the first proposal made every block individually editable in place, and the maintainer's objection to
it is correct — *"das eine ist ich will das gerenderte Markdown sehen, das andere ist ich will es
verändern"*. Per-block editing is neither. It leaves the page looking rendered while parts of it are
not, and when you actually sit down to write it fights you: markdown is written as continuous text,
with paragraphs pasted and moved between, not one box at a time.

So:

- **LESEN is the default and is never accidentally editable.** Rendered markdown, copy control per
  block, links, images, tables. **Both states live in the view only.** The tool has neither: it is a
  list, and a list has nothing to render and nothing to edit.
- **SCHREIBEN is the whole file as raw markdown**, one continuous monospace editor, which is how
  markdown is actually written.
- **Clicking a block while reading is not a third state.** It switches to SCHREIBEN with the caret at
  that block's source. That is what the positions buy: "write, *here*" instead of "write, now find it".
- **Escape returns to LESEN**, and the header carries the same switch for the mouse. Both are local
  keys inside the view — nothing global is bound, so nothing is taken from the shell
  (`rule:shortcuts`).
- **There is no save.** Writing persists debounced, like every other setting in this app, so switching
  back costs nothing and there is nothing to lose. A save button would make the two states feel like a
  commitment; they are a lens.

**Ticking a checkbox belongs to neither state.** It flips `- [ ]` to `- [x]` in the source and writes
the file, from the reading surface, in the tool as well as the view. It is by far the most frequent
action here and must never require a mode — which is the second thing the source positions are for.

The remaining alternative, a **source/preview split**, is rejected on width: it doubles what the
feature needs, in an application whose entire premise is that the terminal keeps its own.

So the renderer must produce a per-block source range.

**Decided: take a parser that already carries positions** — `mdast-util-from-markdown` with
`micromark-extension-gfm` / `mdast-util-gfm` — and keep rendering through **our own components**. Full
markdown was the requirement, tables and all, and a hand-written parser that has to reach GFM
completeness is a much worse bargain than the dependency.

Measured before choosing (`rule:dependencies`, `rule:no-guessing`): `mdast-util-from-markdown@2.0.3`,
`micromark-extension-gfm@3.0.0`, `mdast-util-gfm@3.1.0` — **55 transitive packages, 4.4 MB, every one
MIT**, all actively maintained. The package count is high for this project's usual standard and is
stated rather than glossed over: it is the micromark ecosystem's shape, dozens of single-purpose
modules by one author, not a large surface hiding in a small name.

Three consequences that are decisions, not details:

- **Never through HTML.** GFM permits raw HTML, so the tree will contain `html` nodes. They render as
  **literal text**, never as markup. That is what keeps the property the current renderer documents —
  no HTML output means no sanitiser to get wrong — and a note is now content that arrives by paste
  from anywhere, so the guarantee matters more here than it did for two files in the binary.
- **Links go through the backend, as they already must.** An `<a href>` inside a Tauri window
  *navigates the window*: the interface is replaced by a web page with no way back, and the terminals
  behind it are gone. `Markdown.tsx` already routes every link to the user's browser through the
  backend, and notes reuse that, without exception.
- **Images live in the repository, are copied in, and are read through a command — never a widened
  capability.** Three separate questions, and the third has a fact that settles it: this app has **no
  `assetProtocol` capability**, so the webview cannot load `file://` at all. Everything on disk reaches
  it through a Rust command confined by `files::verify` (canonicalise, then must be under a root), and
  images take that same route: bytes back, shown as a data URL. Nothing about the sandbox is loosened
  to display a screenshot.
  - **Getting in:** paste from the clipboard and drag onto the view. Both **copy the file into the
    notes repository** at `<project>/assets/<stamp>-<name>`, never reference where it came from. A note
    pointing at `~/Desktop/shot.png` is broken on the second machine and again the day the desktop is
    tidied — which defeats the entire reason the notes are in a synced repository.
  - **In the markdown:** a path relative to the note (`![](assets/2026-08-02-frame.png)`), so it
    survives the clone landing anywhere and still renders in any other markdown tool.
  - **A size cap, stated rather than discovered:** a data URL is held in memory by the webview, so
    above the cap the image is not inlined but shown as a placeholder that opens it with the platform
    viewer (`open_path`, which already exists). Large binaries in a git repository are the other half
    of that cost, and this is a notes repo, not an asset store.

- **A repository image is simply shown. There is nothing to press.** `![](assets/frame.png)` renders
  inline in LESEN, in the note, at once — that is the normal case and the whole point of pasting a
  screenshot into a note. The tool column still shows none of it (it is a list), and the writing state
  shows the markdown, because that is what writing markdown is.

- **Only a REMOTE image waits, and only because it is egress.** A `![](https://…)` in a pasted note
  would make the app call out to a stranger's server the instant the note is rendered — a tracking
  pixel would work exactly as designed, and *reading a note* is not consent to that. So a remote image
  renders as a placeholder with its URL and one *load* control, per image. `rule:privacy` allows no
  other default, and this belongs in ADR-PROJ-004 beside the sync: it is the second way this feature
  reaches the network and by far the easier one to overlook.

### Getting rid of things — images, notes, whole projects

A store that only accepts is a store that rots. This is the same failure the attention signal was
rebuilt around (`rule:attention-signals`: *current, informative, self-clearing*) and the reason done
items fold rather than pile up — one level further down, where it is easier to forget because nothing
on screen ever says the repository is filling with rubbish.

**One property makes all of this safe, and it is worth naming because it is a real dividend of the
repository decision: nothing here is ever truly gone.** Every deletion is a commit. "I deleted the
wrong note" is `git checkout`, not a support case — which is what allows deletion to be a plain
action instead of a ceremony.

**An image is removed from the note that shows it.** Its context menu deletes the reference *and* the
file, in one step, because a menu that removes only the reference is how the repository silently fills.

**Orphans are found, listed, and never collected automatically.** Editing raw markdown will strip a
reference without going through that menu, so images end up with nothing pointing at them. The
tempting fix — sweep unreferenced files after every save — **would lose data**: a note written on
another machine and not yet pulled still references the image, and this machine cannot see that note.
So: a cleanup that **runs only after a successful pull**, shows exactly what it would delete with the
total size, and deletes nothing until pressed. Visible, deliberate, and never a surprise.

**A note and a whole project are deleted the same way**, from their row's menu in the tool, behind a
confirmation that says what is inside — the count of notes and images, the way the tmux tool names a
session's command and windows rather than asking "are you sure?" about a name.

**And the project list must not be reachable only through a tab.** Notes follow the front tab, which
means a project whose checkout was moved, renamed or thrown away would have notes nobody can reach —
including to delete them. The tool therefore carries an **all projects** entry beside the current one.
That is not a convenience: it is the only way to reach the notes of a repository that no longer exists
on this machine.

## The last decisions, taken rather than left open

The maintainer's instruction is that this gets implemented autonomously, so nothing may be left for
the implementer to invent (`rule:no-guessing` forbids inventing facts; `rule:clarify-and-plan` forbids
inventing decisions — an unanswered question here becomes exactly that). Four were open; going through
them turned up five more that would have been decided silently at the keyboard.

1. **Remote images are not fetched, and there is no setting that changes it.** Each one renders as a
   placeholder with its URL and a *load* control; pressing it fetches **once**, for that image. No
   global "always load": a second egress switch that nobody finds is a worse default than one click on
   the rare note that has one.
   **And the BACKEND fetches it, never the webview** — HTTPS only, with a timeout (`rule:security`).
   The webview then never opens a connection at all, which keeps the CSP posture intact and stops the
   request carrying a referrer or a user agent anywhere.
2. **The `http(s)` whitelist stays.** A `mailto:` or a scheme we do not know renders as text with a
   copy control. Widening a security boundary for convenience is what ADR-CORE-039 calls lowering the real
   posture to raise the nominal one.
   **But a link INTO the notes resolves and navigates** — `[see](tmux.md)`, `[see](../althing/inbox.md)`
   opens that note in the view. That is not a widening: nothing leaves the app, and it is what makes a
   set of notes a set rather than a pile.
3. **The inline cap is 4 MB per image.** A full-screen Retina PNG is 1–3 MB, so ordinary screenshots
   inline and a 4 MB+ file is a photograph or a capture that deserves a real viewer anyway. Above it: a
   placeholder that opens the file with `open_path`. Base64 inflates by a third, so 4 MB of file is
   ~5.3 MB of string, held only while that one note is open — the ceiling is a note, not a project.
   No total-per-note cap in v1; the cleanup screen shows the repository's size, so growth is visible
   rather than theoretical.
4. **The app always writes into a `notes/` subdirectory of the repository**, whether it is empty or
   not. That is what makes "what if the repository already has something in it" stop being a question:
   there is no adopt-or-refuse branch, nothing of the user's is ever mixed with ours, and pointing this
   at a repository they already use simply works. One directory of nesting buys the deletion of an
   entire failure class.
5. **The remote URL is shape-checked and passed after `--`.** `git remote add origin --upload-pack=…`
   is not a URL, it is a command; the settings field would otherwise be an execution hole. Accepted:
   `https://`, `ssh://`, and `user@host:path`. Refused: anything starting with `-`, anything with a
   newline. This is in the threat model, not left to whoever writes the module.
6. **A project's folder mirrors its remote path**, nested: `notes/github.com/kaoszwerg/yggshell/`. No
   remote falls back to `notes/local/<folder-name>/`. Nested rather than flattened with separators
   because the result is readable in any file browser and cannot collide, and the *displayed* key stays
   the short `kaoszwerg/yggshell`.
7. **No git on the machine is a state, not a crash.** The settings panel says so and the notes stay
   local-only — every feature except sync keeps working. A tool that dies because an optional
   dependency is missing is the silent-failure this project keeps refusing (`rule:crash-handling`).
8. **Push is debounced 5 s after the last edit, and forced when the view is left.** The debounce keeps
   a paragraph from becoming forty commits; leaving the view is the moment the user believes they are
   done, and it is the cheapest place to make "I closed the laptop" safe.
9. **Search is case-insensitive plain text over the markdown, in Rust**, across every project. Not
   regex: a search box that can throw a syntax error at somebody looking for `(` is a worse tool than
   one that finds `(`.

10. **The notes repository is PRIVATE, and the app never creates one.** Notes are the maintainer's own
    working material — half-formed prompts, what is still to be discussed, screenshots of an unreleased
    build. Pushed to a public repository that is a disclosure, and it is the kind that is discovered
    long after it matters.

    The app cannot *verify* visibility: that needs an API call with credentials it deliberately does
    not hold (`rule:security` — no token, ever). Claiming to check would be worse than not checking, so
    instead:

    - **The app never creates a repository — it expects one that already exists.** Connecting means
      naming a remote it can reach; if it cannot, that is reported where the URL was typed, with git's
      own message. A creation flow would have to pick a visibility, and picking wrong is silent and
      permanent.
    - **Settings › Notes states it where the URL is typed**, plainly: everything in the notes is pushed
      verbatim, and this repository should be private. Said at the moment of the decision, not in a
      document nobody opens.
    - **The repository is created once, by the agent, with the `gh` CLI, as `private`** — explicitly
      authorised on 2026-08-02 as part of the implementation task. It is a one-off setup act performed
      by a person with credentials, and deliberately not a capability the product grows: the app holds
      no token and could not do this if it wanted to (`rule:security`).

**What ADR-PROJ-004 still has to WRITE** — these are work, not open questions:

- the egress statement in the form `rule:privacy` demands: exactly what leaves (note text, image bytes,
  file names, commit metadata), to exactly where (the remote the user named, nothing else), when, and
  what never leaves under any setting (no telemetry, no crash data, nothing to anyone but that remote);
- the threat model (`rule:security`): `![](../../../etc/passwd)` against `files::verify`, a hostile
  remote, a note pasted from a web page, and the argument-injection surface in item 5.

## Shape of the first version

Only what serves the hand-over:

1. **A file per project**, **full GFM markdown** — headings, lists, tables, task items, fenced code,
   links, images, quotes, footnotes — rendered, and edited a block at a time.
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

New: one Rust module (read, write, list, search), one DTO, one view, one tool, the capture entries in
three existing menus, a `notes.open` shortcut action, and i18n for all of it.

Plus the markdown work, which the check above turned from an unknown into a known cost: the existing
renderer has no task items, no fenced code blocks and no source positions, so the mdast/micromark
parser comes in behind our own components (55 packages, 4.4 MB, all MIT — measured, decided above).

**The renderer is a HUD primitive, not a fork.** `src/components/ui/Markdown.tsx` already exists and is
what the About and licence screens use; notes get the *same* component reading a richer tree, never a
second markdown renderer beside it (`rule:reusability` — a near-duplicate is still a duplicate, and two
renderers would drift into two different-looking markdowns in one application). Its existing parser
stays for nothing: `lib/markdown.ts` is replaced by the tree, not kept in parallel.

The riskiest part is not the code. It is that a staging area which is *slightly* more effort than
retyping gets abandoned in a week — which is why capture and hand-over are numbered 5 and 6 above
rather than left for later.
