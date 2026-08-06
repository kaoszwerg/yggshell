---
id: ADR-PROJ-005
title: Reading the agent's transcript — what may be derived, and what may never be written
status: accepted
tldr: "The chain reads the whole transcript: counters may be logged, content never. Nothing leaves the device; the declaration may escalate, never reassure."
scope: fullstack
load: conditional
triggers:
  [
    chain,
    transcript,
    jsonl,
    task,
    tasks,
    taskcreate,
    taskupdate,
    subagent,
    subagents,
    plan,
    trace,
    step,
    block,
    classify,
    classification,
    work-levels,
    entrypoint,
    declaration,
    offset,
    incremental,
    cache,
    idempotent,
    privacy,
    egress,
    logging,
    redaction,
    secret,
    credential,
    threat,
    injection,
    path,
    traversal,
    canonicalise,
    session-id,
    home,
    account,
  ]
applies-to:
  [
    "src-tauri/src/agent/**",
    "src/components/tools/ChainTool*",
    "src/hooks/useChain*",
    "work-levels.json",
  ]
---

# Reading the agent's transcript — what may be derived, and what may never be written

## Context

The Chain tool (`docs/plans/chain-tool.md`) answers "what is the agent doing, and how is it going"
by reading the transcript Claude Code writes for every session. That file is not a log of the app's
own activity. It is, measured on this machine, the most sensitive artefact the application has ever
opened:

- every prompt the user typed and every word the model answered,
- every shell command with its arguments (`input.Bash.command`),
- the **content** of every file written or edited (`input.Write.content`, `input.Edit.new_string`),
- every tool result, including command output,
- the model's own reasoning blocks.

Across both Claude homes on the development machine, **16 of 13 780 transcripts contain
secret-shaped strings** — `ghp_`, `sk-ant-`, `AKIA…`, `Bearer …`, `PGPASSWORD`, private key headers.
That is not an accident of one user's habits: a transcript records the commands a person runs, and
people run commands with credentials in them.

This is precisely the data class ADR-PROJ-001 §6 already legislated for, in the other direction:

> Every session logs its **lifecycle** … It logs **no byte of terminal content, in any direction**:
> that is user content and routinely contains credentials.

The terminal's own bytes are never logged. It would be incoherent to read the same class of content
out of a file instead and treat it casually. `rule:security` requires a threat model for any feature
that adds an input, a capability, or stored information. This one adds all three.

**Two further trust boundaries arrive with it.** The tool reads `work-levels.json` from the working
directory — a file that arrives by `git clone` and changes by pull request, i.e. from another
party's hands. And the plan proposed hooks that would *decide* inside the user's own agent session;
that part was measured, found ineffective, and dropped (`chain-tool.md` C5), which leaves only a
passive one.

## Decision

### 1. Nothing derived from a transcript is ever logged

**Loggable:** counts, classifications, durations, byte offsets, line numbers, the transcript's own
`version` field, whether a parse succeeded. **Never loggable, at any level:** a command text, a file
path read out of the transcript, a tool result, a task subject or description, a prompt, a model
message.

This is not a style preference — three persistence paths are already built and would capture it
automatically:

| Path | Where it ends up |
| ---- | ---------------- |
| `error.rs:38-46` — `Serialize for AppError` logs **every** IPC error message | log file **and** the Logs view |
| `crash.rs:313` — the panic payload is written to `<app-data>/crashes/` | the file a user sends when asking for help |
| `logging.rs:147` — `rolling::daily`, no pruning, own crate at `debug` by default | on disk, indefinitely |

So an `AppError::Other(format!("unparseable step: {line}"))` — the most natural phrasing — writes a
transcript line into two places at once. **Error values carry an offset or a line number, never
content.**

**The parser cannot panic.** Same discipline as `agent::parse_tail`: every extraction is an
`Option`, an unknown shape yields less rather than an error, and no `expect`/`unwrap` touches a
transcript-derived value. A panic would route the content into the crash report and defeat the rule
above.

### 2. Nothing leaves the device

The app has no HTTP client (ADR-PROJ-004) and the chain adds none. Explicitly, because these are the
routes somebody would later find reasonable:

- **Chain data never reaches the notes repository.** Notes have opt-in egress to a remote the user
  named; a "copy the chain into a note" convenience would ride through a consent that was given for
  something else.
- **Chain data is written to no file at all** — not to `<app-data>`, not to a cache, not to a temp
  file. See §3.
- **Transcript-derived text is rendered as plain text, never through `Markdown`.** `Markdown.tsx:449`
  turns a URL into a button calling `open_external`; step labels are model-written and a hostile repo
  can influence them.

### 3. The derived state lives in memory only

The incremental reader keeps `(dev, ino, len_at_last_read, offset, folded blocks)` per session. The
folded blocks **are** transcript content: command signatures, file names, targets.

**It is held in `AppState` and nowhere else** — never serialised, never written to disk, discarded
when the app exits. The precedent is the log ring buffer (`logging.rs:17`). A disk cache would create
a second copy of the user's session content outside Claude's own home, without retention, without a
delete path, and unknown to the user: deleting `~/.claude/projects` would then no longer delete.

If a disk cache is ever needed, it requires a supersession of this ADR, a size bound, a visible
delete action, and it is named in the UI for what it is.

### 4. `work-levels.json` may name, never reassure

The file comes from a cloned repository. `rule:work-legibility` admits its truthfulness cannot be
checked — *"a run named `unit` that quietly reaches a database is a lie the file cannot detect"*.

- **Priority 1 applies to labelling only** — which act, which refinement, which area.
- **For reach, the declaration may only escalate.** If the built-in heuristic recognises `git push`,
  a deploy, an `ssh`, or a non-local host, the heuristic wins even where the file claims `@local`,
  and the UI shows the **contradiction as a contradiction** rather than resolving it.
- **Its strings are untrusted display data**: length-capped, control characters stripped, rendered as
  plain text, never markdown, never a link.
- **The app never acts on it** — it does not run, suggest, or authorise anything. ADR-PROJ-001 §5
  holds: the interface does not choose what runs.
- **Bounded before reading**: regular file only, size cap, entry-count cap.

### 5. Every path is validated against a root

Two inputs would otherwise be interpolated into filesystem paths straight from foreign data:

- `session_id` comes from a transcript as an unchecked `String` (`agent/mod.rs:369-371`). It is
  matched against `^[A-Za-z0-9-]{1,64}$` and rejected otherwise.
- The Claude home can come from a `.envrc` **inside the cloned repository** (`agent/mod.rs:48-61`).

Every composed path is canonicalised and verified to sit under its root — the building block exists
(`files/mod.rs:36-57`, `within`), and ADR-PROJ-004 set the precedent for images.

**`transcript_path` is not taken from the events file.** Any process the user runs can append a line
there. The chain resolves its transcript through `agent::project_dir` + `newest_session`, bound to
the tab's `cwd`.

### 6. Ambiguous account attribution shows nothing

Without a declared home, `homes_for` picks whichever has the newest transcript. For a token count a
wrong guess is a wrong number; for the chain it would render **another account's work inside this
project's tab**. The tool names the home and session it read, and shows nothing when several homes
are plausible and none is declared — `agent/mod.rs:12-13`: *"shows it plausibly, which is worse than
showing nothing"*.

### 7. The only hook is passive, and its text is a constant

A `UserPromptSubmit` hook appends one sentence, and only when the session has no task list. It
decides nothing and cannot fail closed.

**Its text is a literal in the script, with no interpolation from repository or transcript data**,
pinned by a test. `additionalContext` is model-visible: a sentence built from `work-levels.json`
would let a hostile repository write *"Ignore previous instructions…"* into the agent's context at
every prompt, through a channel nobody perceives as input.

It is a **second script with its own consent**, and it must not be carried by
`refresh_agent_hooks` (`commands/mod.rs:817-847`), which deliberately adds every event a build needs
at startup — that mechanism exists for a passive reporter and may not silently extend a consent given
for one.

## Consequences

**What this costs.** The tool cannot log what it read, so a misclassification is debugged from a
coverage figure and an offset rather than from the offending line. That is accepted: the alternative
is a log file that is a credential store.

**What it buys.** The most sensitive file the app opens is handled like the terminal bytes next to
it — and the rule is enforceable, not merely written: a gate in the shape of
`scripts/project/check-git-writes.mjs` rejects a `tracing` macro carrying a transcript-derived field
inside the chain module.

**Threat model, stated as a table:**

| Actor | Can do | Defended by |
| ----- | ------ | ----------- |
| A cloned repository | ships a lying or hostile `work-levels.json` | §4 — escalate-only, untrusted strings, no action |
| A cloned repository | points `CLAUDE_CONFIG_DIR` at a directory it supplies | §5 — path validation, §6 — ambiguity shows nothing |
| Any user process | appends a crafted line to the events file | §5 — `transcript_path` is not taken from it |
| A hostile repo via the hook | injects text into the model's context | §7 — constant text, no interpolation |
| The app itself | leaks transcript content into logs or crash reports | §1 — content never logged, parser cannot panic |
| The app itself | accumulates a second copy of session content | §3 — memory only |

**What is deliberately not defended.** A user who can write into their own `~/.claude` can already
run arbitrary code as themselves; nothing here defends against the machine's owner. And a transcript
that is itself hostile — a repo shipping a fake transcript for its own directory — can at worst make
the chain display wrong labels, which §4's contradiction display and §6's attribution rule bound to a
cosmetic effect.

## Alternatives

**Read via hooks instead of the transcript.** A `PostToolUse` hook on every tool would deliver
structured events without opening the transcript at all — and would place a process spawn in the
agent's critical path for all 265 Bash calls of a four-hour session, plus a permanent append-only
file. Measured and rejected in the plan: the transcript costs the agent nothing.

**Store the derived chain on disk to survive restarts.** Rejected under §3. Re-reading a 26 MB
transcript once at startup is a loading state; a second permanent copy of the user's sessions is a
liability that outlives the session.

**Trust `work-levels.json` fully.** Simpler, and it is the file's purpose to be believed. Rejected:
the one question it exists to answer is *"am I about to hit production?"*, and a wrong answer there is
the only failure in this feature that is worse than no feature.

## References

- ADR-PROJ-001 §5, §6 — the frontend never chooses what runs; PTY content is never logged
- ADR-PROJ-004 — the precedent: an ADR when a trust boundary moves, plus `within` for path roots
- ADR-CORE-011, `rule:privacy`, `rule:security`, `rule:logging`
- `docs/plans/chain-tool.md` — the measurements this rests on
- `rule:work-legibility` — the declaration whose trust level §4 sets
