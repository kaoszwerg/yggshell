---
id: ADR-PROJ-004
title: The notes leave the device, and exactly how
status: accepted
tldr: "Notes sync to a private repo the user names, through their own git; nothing else leaves. A remote image is fetched by the backend on request, never on render."
scope: fullstack
load: conditional
triggers:
  [
    notes,
    note,
    sync,
    egress,
    network,
    remote,
    push,
    pull,
    clone,
    git,
    credentials,
    ssh,
    token,
    privacy,
    telemetry,
    image,
    images,
    tracking,
    pixel,
    link,
    external,
    browser,
    repository,
    private,
    threat,
    injection,
  ]
applies-to:
  - src-tauri/src/notes/**
  - src/components/tools/NotesTool.tsx
  - src/views/NotesView.tsx
  - src/api/notes.ts
---

# The notes leave the device, and exactly how

## Context

`rule:privacy` is unambiguous: this application sends **nothing** off the device — no telemetry, no
analytics, no crash reporting, no update pings — unless a specific feature requires it, and then only
as an explicit, opt-in feature **with its own ADR stating exactly what leaves the device and where
to**. This is that ADR.

The notes tool (`docs/plans/notes-tool.md`) keeps the maintainer's notes in a git repository so that
every machine running YggShell has them. That is network egress by construction. It is also the first
code in this application that **writes** to a repository at all: everything git-related so far — status,
diff, log, the auto-fetch of ADR-PROJ-002 — reads.

Two further paths reach the network and are easy to miss, so they are decided here rather than left to
the implementation:

- **A remote image in a note.** Markdown renders `![](https://…)`, and rendering it is a request to a
  stranger's server. A tracking pixel pasted into a note would work exactly as designed.
- **A link in a note.** Already constrained: `open_external` refuses anything that is not `http(s)` and
  hands it to the user's browser, because an `<a href>` inside a Tauri window *navigates the window* —
  the interface would be replaced by a web page with no way back, and the terminals behind it gone.

## Decision

### What leaves the device

**Only to the one remote the user names, and only what is in the notes repository:** note text, the
images they pasted, file and directory names (which encode project identity — a git remote path such as
`github.com/kaoszwerg/yggshell`), and the commit metadata git itself writes (author, time, message).

**When:** pull on start and on window focus; commit and push debounced 5 s after the last edit, and
forced when the notes view is left; a manual push on request.

**What never leaves, under any setting:** no telemetry, no analytics, no usage counts, no crash
reports, no terminal output, no file from any other repository, and nothing at all to Anthropic, to the
authors of this project, or to any host but the one in the setting.

**With no remote configured, nothing leaves.** That is not a nicety — it is what makes the feature
satisfy `rule:privacy` at all: egress is opt-in, and naming a remote *is* the opt-in.

### The repository is private, exists already, and holds no credentials of ours

- **The app never creates a repository.** It connects to one that exists. A creation flow would have to
  choose a visibility, and choosing wrong is silent and permanent.
- **The app cannot verify that the repository is private** — that needs an API call with a token it
  deliberately never holds — so it does not claim to. Settings states it where the URL is typed:
  everything is pushed verbatim, this repository should be private. A check we could not perform
  honestly would be worse than none (ADR-CORE-004).
- **Credentials are the user's git's business.** The app shells out to their `git`, which finds them in
  the SSH agent, the platform credential helper, `~/.gitconfig`, `~/.ssh/config`. Nothing is copied,
  stored, or transmitted. `rule:security` allows a client to learn *that* a credential exists and never
  its value; here it learns neither.

### Remote images are fetched by the backend, on request, never on render

A repository image renders inline immediately — that is the normal case and the point of pasting a
screenshot into a note. A **remote** image renders as a placeholder with its URL and one *load*
control, per image. There is no setting that changes the default: a second egress switch nobody finds
is a worse default than one press on the rare note that has one.

**The backend performs the fetch, HTTPS only, with a timeout.** The webview therefore never opens a
connection of its own, which keeps the CSP posture intact and stops the request carrying a referrer or
a user agent to anyone.

### Links keep the `http(s)` whitelist

Unchanged from `open_external`. A `mailto:` or an unknown scheme renders as text with a copy control.
Widening a security boundary for convenience is what ADR-CORE-039 calls lowering the real posture to raise
the nominal one.

**A link into the notes resolves internally** — a relative link to another note file opens it in the
view. That is not a widening: nothing leaves the application.

## Threat model

The trust boundary is **the note content**, which arrives by paste from anywhere, and **the remote
URL**, which the user types.

| Abuse case | Defence |
| --- | --- |
| `![](../../../etc/passwd)` — reading outside the notes | Every image path is canonicalised and must resolve under the notes root (`files::verify`), before anything opens it. |
| A tracking pixel in a pasted note | Remote images are never fetched on render; the backend fetches, only on an explicit press, per image. |
| `[click](javascript:…)` or a `file:` link | `open_external` refuses anything that is not `http(s)`, at the IPC boundary. |
| Raw HTML in markdown (`<script>`, `<img onerror>`) | The renderer produces components, never HTML. `html` nodes render as **literal text**. There is no sanitiser to get wrong because there is no markup path. |
| **Argument injection through the remote URL** — `--upload-pack=…` is a command, not a URL | The URL is shape-checked (`https://`, `ssh://`, `user@host:path` only; nothing starting with `-`, no newline) **and** passed after `--`. |
| A hostile remote serving a huge or malicious pack | git's own limits apply; the sync runs with a deadline and its failure is reported, never retried in a loop. |
| A credential prompt with no terminal attached | Every prompt is disabled (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=`, `SSH_ASKPASS=`, `ssh -o BatchMode=yes`), so git fails fast instead of hanging invisibly. |
| **The sync writing to the wrong repository** | See below — this is the one that would be catastrophic. |

### The write boundary, which is a gate rather than a discipline

YggShell runs `git` inside **every project the user has a tab in**. All of it is read-only. The notes
sync is the first code here that commits and pushes, and a write path pointed at the wrong directory
would commit and push the maintainer's own work, from a background timer, unasked.

- `src-tauri/src/git/` stays read-only and never grows a write path; `src-tauri/src/notes/` owns the
  only `commit`/`push`/`add`/`rm` in the codebase.
- **The notes root is never supplied by the frontend.** It is derived in Rust from the app data
  directory. The webview may ask for "sync now"; it may not say *which directory* — the same principle
  as ADR-PROJ-001 §5, that the frontend must not be able to choose what runs.
- Every write re-checks that its target canonicalises under the notes root, even though the path is
  internal. That is the check which survives a refactor moving code between modules.
- **`check:all` fails the build** if a writing git subcommand appears outside `src-tauri/src/notes/`
  (`scripts/project/check-git-writes.mjs`). The precedent is `check-no-process-kill.mjs`: an ordinary
  command that is correct almost everywhere and catastrophic in one place. A future agent adding "just
  a quick `git add`" to the Git tool meets a red build with the reason, not a review that may not
  happen.

## Consequences

- **A passphrased key that is not in the agent means sync never succeeds.** `BatchMode` fails instead
  of asking, which is right for a background task — and is why the status line carries git's own error
  verbatim. "Permission denied (publickey)" is actionable; "sync failed" is not.
- **Offline is the normal case, not the error case.** Notes are written locally and always readable;
  sync is best-effort and says when it last succeeded. A note is never lost because a push failed.
- **Conflicts keep both versions, visibly**, rather than resolving silently. The file is briefly ugly
  and nothing is ever lost.
- **The privacy posture is unchanged for everyone who does not configure a remote**, which is the
  default state after an update: the feature is local-only until somebody types a URL.
