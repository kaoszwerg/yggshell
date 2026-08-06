# Plan — the Chain tool

**Status: BUILT.** Reader, declaration, gate, primitive, tool and nudge all shipped in v0.52.0 with
`check:all` green. This document is kept as the record of what was measured and why each decision
went the way it did — the implementation order at the end is done, and the open decisions that
remain are named as such.

**Proven end to end against two real sessions**, which is what a unit fixture cannot do:

| Session | Tool calls | Links | Plan steps | Recognised |
| ------- | ---------- | ----- | ---------- | ---------- |
| `lysisai-dsp`, 6:54 h, no task list | 446 | **39** | 0 | 200 |
| the session that built this, with one | 392 | **31** | **19** | 275 |

Both fallback stages work on real data, and the plan layer reconstructs from the transcript exactly
as C2 argued it must — those 19 steps came out of the transcript, not out of the store.

The UI direction was confirmed by the maintainer on the mockup ("genau das was ich will") before any
code existed.

**Read this first:** almost everything below was *measured* on this machine against live agent
sessions, not reasoned about. Where a number appears, a command produced it. That matters, because
the review overturned two conclusions that had looked obviously right — including one of my own that
the whole architecture rested on. Both corrections are kept visible below rather than quietly edited
away.

## What was asked for

A dashboard showing what an agent is working on: the tasks and phases still ahead, the causal chain
of individual steps, what is running right now, loops and iterations made visible, blockers, elapsed
time — split by project, in the sidebar, beside the terminal the agent runs in. The maintainer's
target is the full picture (plan + trace); everything below it is degradation, not a design choice.

## The surface (mem:surfaces)

A **tool**, always for the active tab, never for several at once. A **view** stays possible later; nothing
here depends on it.

---

## Corrections the panel forced

Kept as their own section because a plan that silently absorbs its own errors teaches the next agent
nothing (ADR-CORE-004).

### C1 — The task store does NOT delete a completed task

**What I claimed:** creating a task, resolving it, and finding the file gone proved that *"a completed
task is removed from disk immediately"* — so the denominator for a completion ratio disappears.

**What is actually true**, re-measured in this very session:

```
2.json completed   3.json completed   4.json completed   5.json completed
6.json in_progress 7.json pending
```

Four completed tasks are on disk right now. My probe task vanished because it was the **only** task:
when the last open task closes, the list is empty and gets cleared. Independently reproduced by a
second reviewer (session `3a1a9f11`: two tasks, one completed → both stay; both completed → both
stay).

**The exact mechanism, measured to the end of this session:** the moment the last open task was
resolved, every file disappeared and `.highwatermark` jumped from `1` to `10` — the highest id ever
issued. So the store is cleared **when nothing is open**, and the high-water mark is written at that
moment. It is a resume point for id numbering, not a count of tasks (which is why the earlier
"roughly 134 tasks ever created" arithmetic was unfounded: it read a mark left by an earlier clearing).

**Two consequences, and the second is a requirement:**

- The store is complete *during* the work — exactly when the dashboard is being looked at. **The
  completion ratio is computable.** Stage 1 is reachable far more often than the original plan
  assumed.
- **"Plan finished" and "no plan" are different states that look identical in the store**, because a
  finished plan leaves nothing behind. A tool reading only the store would show a full plan, then
  fall to stage 2 the instant the agent succeeds — reporting an absence at the moment of completion.
  This is the second argument for C2: the transcript still holds every `TaskCreate`/`TaskUpdate`, so
  a cleared store with task history behind it is rendered as **done**, not as absent.

### C2 — The plan needs no second reader

`TaskCreate` / `TaskUpdate` appear in the **transcript**, with their `toolUseResult` carrying
`statusChange`, `taskId`, `updatedFields`. Measured in session `9d397169`, whose task directory is
empty: 8 `TaskCreate` and 15 `TaskUpdate` fully recoverable from the transcript alone.

`mem:surfaces` is explicit: *"one reader with two renderings, **never two readers**"* (ADR-CORE-005).
A separate store reader would be the second — and the lossy one.

**Consequence:** the plan layer is reconstructed from the transcript, same file, same pass. The store
is read only for the *current* state, if at all. One reader, two renderings.

### C3 — Delegated work is invisible, and this repo delegates by rule

Measured in this session:

```
projects/…/3b409634-…/subagents/      12 entries, 1.17 MB
projects/…/3b409634-…/tool-results/   a second directory
main transcript:                       5 Agent calls
```

`agent::transcripts_by_age` (`src-tauri/src/agent/mod.rs:235-252`) reads the directory **flat** and
filters `*.jsonl` — it never enters either subdirectory. And `rule:agent-delegation` §0 makes
read-only fan-out the **default**. In precisely the sessions that follow this repo's own governance,
the chain would have shown a straight line of `Task` nodes and no TEST/FIX/GATE block at all.

**Consequence:** `subagents/agent-*.jsonl` is read and rendered as an indented sub-chain under its
`Task` node — the structure the UI already uses for "the running plan step carries its own trace".
Until that is built, a `Task` node must **say** it hides work. A hole that looks like a gap in the
record is worse than a marked hole.

### C4 — 96.8 % classification was a property of one project

The counter-measurement, in **this** repository — the only one that has a `work-levels.json`:

```
427 Bash calls, first token:
 106 grep    91 npx    44 sed    25 npm    22 git    20 ls    20 cargo    9 python3
```

- **18 of 427 calls (4.2 %) start with `npm run`** — the only form the declaration can resolve.
- `npx` (91) and `cargo` (20) appear in **no** line of the declaration.
- **200 of 427 (47 %) contain `&&`, `|` or `;`.** "Classify the program, not the text" does not say
  *which* of five programs is the program.
- 6 calls start with a variable assignment, 3 with a function definition, 9 with `cd`, 33 are
  multi-line.

**Consequence:** the classifier splits a command at `&&` / `;` / `|`, skips leading assignments and
`cd`, and tests **every** segment — a block is produced as soon as any segment matches. And
`work-levels.json` here has to list the forms actually typed (`npx tauri`, `cargo test`), or the
proving ground measures itself at 4.2 %.

### C5 — Enforcement stage 2 fails on measurement

Removed from this plan on the maintainer's decision, after it was **built and run** by a reviewer:

| Run | Turns | Cost | Denials | Result |
| --- | ----- | ---- | ------- | ------ |
| baseline, no hook | 2 | $0.093 | 0 | file written |
| gate, same task | 7 | $0.203 | 1 | file written, 1 forced task |
| **gate, 4-step task** | 2 | $0.105 | **0** | 3 files written, **0 tasks** |

The last row is decisive: the agent used **`Bash`** rather than `Edit`/`Write`, so a `PreToolUse`
matcher on `Edit|Write` never fired. The session this tool is built for runs **265 Bash against 9
Write** — the gate would engage in roughly 3 % of cases, punishing the exception while the norm walks
past. Widening the matcher to `Bash` is worse: the hook would have to guess whether an arbitrary
shell line writes, and the first refusal would hit `ls`.

And what the gate produced when it *did* fire:

```json
{ "id": "1", "subject": "create: hello.txt mit dem Wort hello anlegen", "status": "completed" }
```

A task restating the tool call it was blocking, under an invented act (`create:`) that is not one of
the five. On the dashboard: "Goal — create hello.txt. 1/1." **Worse than empty**: empty is honest,
this is plan-shaped decoration that reads as information.

**Consequence:** no `PreToolUse` deny, no `Stop` exit 2. What remains is §Enforcement below.

---

## What was measured, and what each measurement decided

### 1. The harness keeps a structured plan

`<claude-home>/tasks/<session-id>/<id>.json`, the session id being the one the hook payload carries
and `agent::parse_tail` already reads:

```json
{ "id": "1", "subject": "…", "description": "…", "activeForm": "…",
  "status": "pending", "blocks": [], "blockedBy": [], "metadata": {} }
```

**But the fields that would carry a causal graph are empty in every live file.** Measured across both
Claude homes, all six task files that exist: `metadata` 0/6, `owner` 0/6, non-empty
`blocks`/`blockedBy` 0/6. The harness writes none of them; only the model can, and it does not.

*Decides:* the plan layer is an **ordered list**, not a graph. No edge type may be drawn for which no
data exists. `rule:work-legibility`'s `metadata.plan` mechanism is unproven and must be verified
before that rule goes upstream.

### 2. The store carries no timestamps

No `createdAt`, `completedAt`, `updatedAt`. The file's `mtime` says "last touched", nothing more.

*Decides:* every duration comes from the transcript, where each line has a `timestamp`.

### 3. A store can be empty exactly when it matters

`lysisai-dsp`, pid 42369, 4:05 h into a test/fix/gate/PR chain:

```
ls: .claude/tasks/a478f359-…: No such file or directory
265 Bash / 66 Edit / 13 Read / 9 Write / 3 WebFetch / 2 TaskStop / 2 AskUserQuestion
```

Not one task. Meanwhile **this** session kept six, correctly worded, with no hook at all — because
the work was substantial enough to be worth a list, and the harness itself advises against one
otherwise (*"you should not use this tool if there is only one trivial task to do"*).

*Decides:* the trace is the foundation and the plan is enrichment — but the enrichment appears on its
own for work large enough to matter. That is the whole argument against forcing it (C5).

### 4. The transcript carries the course of the work, for free

381 tool calls, each with the agent's own description. Read verbatim, it tells the story:

```
Core-Suite gezielt fahren → Ergebnis Core-Suite → Aktueller Fehlergrund
→ Timeout-Konfiguration finden → IoT mit eigenem Zeitlimit → IoT-Lauf Status
```

*Decides:* **the trace is the foundation.** No hook in the agent's critical path, no token in its
context, no behaviour change.

### 5. Half the trace is noise and must fold into its block

Classified by program, ~50 % is `probe`-shaped: reading, searching, status checks. Reading a log file
after a test run belongs *inside* the test block. With noise folded and cycles collapsed:

```
381 steps → 117 blocks → 18 chain links
```

*Decides:* two levels of granularity are mandatory. Without the fold: 196 boxes, unreadable.

### 6. Iteration is directly visible

```
20×  E2E → FIX      17×  FIX → E2E      12×  E2E → E2E
19×  FIX → FIX       6×  FIX → TEST      6×  TEST → FIX
```

*Decides:* a cycle is one collapsed link carrying its iteration count — **but only when subtype and
target stay the same** (see §Cycle folding). `TEST(core) ⇄ FIX(a.rs)` and `TEST(ui) ⇄ FIX(b.tsx)` are
two chains, not one node reading `2×`.

### 7. Red or green is NOT readable from the exit code

Only **6 of 381** steps carry `is_error: true` — the agent pipes through `| tail -60`. Independently
confirmed in a second project: 6 of 876 tool results in `9d397169`.

*Decides:* the result is read from the **following edge**. A test followed by a fix was red; a test
followed by a commit was green. Tool- and language-independent.

**Known gap:** a run the user interrupted (`interrupted` in `toolUseResult`) is neither red nor
green, and the following edge would read it as red. Measured 0× so far — unmeasured, not disproven.

### 8. The test target is not in the command line

```
core/frontend/playwright.config.js:34   baseURL: BASE_URL
core/frontend/playwright.config.js:9    import { BASE_URL } from './e2e/constants.js'
```

`--project=admin` is a **role**, not an environment. The same command runs against a container or a
public host.

*Decides:* no command heuristic can tell "internal" from "live". That is what `rule:work-legibility`
and `work-levels.json` exist for.

### 9. Command signatures reduce — if the program is classified

291 Bash calls → 217 noise → **28 signatures** in `lysisai-dsp`. In this repo, 4.2 % coverage (C4).

*Decides:* the heuristic is a fallback behind the declaration, never in front, and it says when it is
guessing.

### 10. The enforcement mechanisms exist — and one of them fails open

From the binary: `permissionDecision` `"allow"|"deny"|"ask"` (PreToolUse only), `additionalContext`
for `SessionStart|UserPromptSubmit`, `stop_hook_active` plus `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`.

Measured: a missing hook script and a script exiting `1` both let the write through — **fail-open**,
the right direction. It also means a broken gate is indistinguishable from an agent that did not
plan.

---

## The design

### Two layers, one reader

- **The plan** — reconstructed from `TaskCreate`/`TaskUpdate` in the transcript (C2); the store is
  consulted only for current state.
- **The trace** — the tool stream from the same file, same pass.

The running plan step carries its own trace indented beneath it.

### The fallback chain

| Stage | Condition | Shows |
| ----- | --------- | ----- |
| **1 — target** | tasks present | goal, ordered plan, running step with its trace, what is ahead, blockers |
| **2** | no plan, enough history | trace + expectation from edge frequency |
| **3** | no plan, young session | raw trace, no expectation |
| **4** | no transcript for this tab | "no agent in this tab" |
| **5** | transcript present, reader no longer understands it | says so — see §Format drift |

**A halt overlays every stage**, from `hooks::waiting_now` / `has_moved_on`, which already separates
`permission_prompt` (gold, blocked on you) from `idle_prompt` (green, finished) and self-clears.

### Block detection

Classify the **program**, never the command text. Split at `&&` / `;` / `|`; skip leading assignments
and `cd`; test every segment (C4).

Priority, and it must never invert:

1. **`work-levels.json` of the project** — for **naming** only (see §Trust below).
2. **A signature the user has assigned** in YggShell's settings.
3. **The built-in heuristic** — marked as a guess in the UI.

### Cycle folding

Fold `A ⇄ B` into one link **only while subtype and target are unchanged**. The counter is shown
beside the number of **distinct** subtypes, because the two readings are opposite:

```
TEST ⇄ FIX  16×  (16 files)   → working through a list of failures
TEST ⇄ FIX  16×  (1 file)     → stuck
```

### Reading it incrementally — and idempotently

The transcript reaches 26 MB. A full read per poll is the "feature that gets slower the more useful
it is" that `agent::read_tail` was written to avoid.

**The invariant, and the original plan got it wrong.** A command returning a *delta* is destructive on
call, and four independent things in this frontend would eat one: `React.StrictMode`
(`src/main.tsx:49`) doubles mounts, `retry: 3` is the QueryClient default, `ToolPanel.tsx:109-115`
unmounts on every tool switch, and two tabs on one repo get two query keys against one file
(`useAgentSession.ts:25`) — the same "a directory is not a tab" defect `hooks.rs:192-200` already
paid for once.

> **The reader is idempotent.** It holds a cache, not a consumption counter:
> `(dev, ino, len_at_last_read, offset, folded blocks)`. Per poll: same `ino` **and** `len ≥ offset`
> ⇒ continue incrementally; otherwise **discard everything and re-read**. The IPC command **always
> returns the whole chain**; the offset is a backend optimisation and is invisible at the boundary.

Rotation, `/clear` (new session id ⇒ new file), restart, a possible `/rewind`, StrictMode, retry and
remount then collapse into one harmless case.

Measured, so the cases are not guesses: compact **appends** — `d56b6f22` (26 MB) and `60a1f183`
(24 MB) each carry 3 `isCompactSummary` lines at a constant `sessionId`. Turn order is chronological
(0 inversions across `assistant` lines).

### It reads only while somebody is looking

**No background polling**, and that is a rule rather than an optimisation. `mem:surfaces`: *"a tool's
job is … read by somebody looking at it, so it must stop when they are not. **The exception is the
signal, not the tool.**"* The halt signal keeps `refetchIntervalInBackground` because it exists to
reach someone looking elsewhere; the chain takes the ordinary `refetchInterval`, which TanStack stops
on unmount and when the window is hidden.

- **No timer in the backend, ever.** Rust reads when asked, and the frontend asks only while the tool
  is on screen.
- **Nothing is lost by not looking.** The offset makes reopening resume where it stopped.
- **But reopening after hours must not stall.** The parse cache lives in the backend as pure
  in-memory state, losslessly rebuildable, written *by a request and never by a clock*. A cold first
  read gets a loading state, not a frozen panel.

### Format drift is reported, not absorbed

`agent/mod.rs:20-24` sets the doctrine: *"not an API … an unknown shape yields **less** information,
never an error … the tool goes quiet."* For a session summary "less" is visible — a missing model
shows as blank. **For a chain it is not**: a shorter chain and a genuinely shorter chain look
identical.

So the reader carries a **coverage figure** ("4 217 lines read, 4 190 understood") and every transcript
line's `"version"` field (measured: `2.1.220` in one session, `2.1.223` in another, constant per
file). On a version it was never verified against, the tool says it is on unproven ground. That is
stage 5 of the fallback chain.

### The UI

`docs/plans/chain-tool-ui.html`, confirmed by the maintainer. Load-bearing details:

- **State has shape, not only colour**: diamond, triangle (was red), circle (cycle), square (halt),
  dashed (expected).
- **Expectation is drawn differently on purpose** — observation, never a plan.
- **The chain scrolls; what is running stays in view.**
- **Content size follows `terminal_font_size`** (rule:content-size).

**Defects the review found in it, to be fixed before implementation** (the design is confirmed, these
are not design changes):

1. **A failed cycle renders identically to a successful one.** `.failed .node` (line 369) and
   `.cycle .node` (line 463) have equal specificity, so the later rule wins — the one statement the
   cycle exists to make is invisible. Shape and state must be separate classes, or separate props.
2. **Drawn at 340 px; `TOOL_WIDTH_DEFAULT` is 280 and the minimum is 180** (`src/store/ui.ts:28-30`).
   At 280 px a filename in a nested cycle has ~22 characters; at 180 px, ~14. Re-draw at both.
3. **The header is content and is hard-coded**: `.now .what` (the block type!), `.goal .text`,
   `.tool-foot` counts and `.clock` sit in fixed `rem` outside `.chain`. At `terminal_font_size: 20`
   the line saying what is running stays at 13 px — the exact inversion `rule:content-size` records
   from the Markdown headings.
4. **Fixed `px` inside the content**: `.node` is `9px`, the rail column `14px`, the cycle border
   `2px`. The state marker must be `em`.
5. **Four text colours below 4.5:1** — `.noise` 2.52:1, `.blocked` 2.58:1, `.section-label` 2.78:1,
   `.ahead` 3.19:1. All are palette colours diluted with alpha; undiluted they pass. The recession is
   carried by shape and position already.
6. **`<details>/<summary>` is stock UI** (ADR-APP-026) and the lint does not catch it — it names only
   `button/input/select/textarea/title`. Needs `src/components/ui/Disclosure.tsx` plus a lint entry
   in `eslint.config.project.mjs`. `AgentTool.tsx:98` has the same defect and gets fixed with it
   (rule:code-quality, fix on sight).
7. **The target is never shown**, although §8 makes it the axis that hurts when wrong and the design
   promised `TEST e2e → lysisai-dev-backend`. `@dev` and `@prod` currently look identical.
8. **Missing states** (rule:ui-design): loading, error, fallback stages 3–5, a finished session
   (green, not just gold), a plan with zero steps. And `0 min` reads as "did not run" — use `< 1 min`.
9. **Two vocabularies.** The UI says `TEST/FIX/GATE/COMMIT/PUSH/PR`; the convention says
   `plan/build/verify/ship/probe`. One mapping, one place, or it is ADR-CORE-005 duplication.

---

## Security — and this feature needs its own ADR

The panel's verdict, and the precedent is inside this repo: the Notes tool got ADR-PROJ-004 for
moving a smaller trust boundary. This one adds an **input** (the full transcript: every prompt, every
command, every file read and written, every tool result), a **stored derivation** (the parse cache),
and reads a file from a **foreign repository**.

**What the ADR must settle:**

- **Nothing derived from a transcript is ever logged.** The leaks are already built:
  `error.rs:38-46` logs every IPC error message; `crash.rs:313` writes the payload into
  `<app-data>/crashes/`; `logging.rs:147` rotates daily with no pruning. A single
  `AppError::Other(format!("unparseable step: {line}"))` puts a transcript line into the log *and*
  the Logs view. The rule, worded like ADR-PROJ-001 §6: **counters, classifications and timestamps
  are logged; never a command text, a path from the transcript, or a tool result — at any level.**
  Error paths carry an offset, never content. A gate in the shape of `check-git-writes.mjs` enforces
  it.
- **The parser cannot panic.** Same discipline as `agent::parse_tail` — every extraction an `Option`,
  no `expect`/`unwrap` on transcript-derived values, or the crash report becomes the leak.
- **Nothing leaves the device**, including into the notes repository, which already has opt-in egress
  and would not ask again.
- **Transcript-derived text is rendered as plain text**, never through `Markdown` — `Markdown.tsx:449`
  turns a URL into a button calling `open_external`, and step labels are model-written.
- **`work-levels.json` may name, never reassure.** The file comes from a cloned repo, and the rule
  defining it admits its truthfulness is uncheckable. So priority 1 applies to *labelling*. For "how
  far does this reach", the declaration may only **escalate**: if the built-in heuristic recognises
  `git push`, `deploy`, `ssh` or a non-local host, the heuristic wins even where the file claims
  `@local`, and the contradiction is **shown as a contradiction**. Its strings are length-capped and
  stripped of control characters, and the app never acts on the file.
- **Every path is validated.** `session_id` comes from a foreign JSON as an unchecked `String`
  (`agent/mod.rs:369-371`) and would be interpolated into a path; the claude home itself comes from a
  `.envrc` **in the cloned repo** (`agent/mod.rs:48-61`). Match `session_id` against
  `^[A-Za-z0-9-]{1,64}$`, canonicalise every composed path and verify it against its root — the
  building block exists (`files/mod.rs:36-57`, precedent in ADR-PROJ-004). `transcript_path` is
  **not** taken from the events file, which any process can append to.
- **Size and type caps on both new inputs.** `work-levels.json` and the task store are unbounded
  today; the transcript reader's budgets (`TAIL_BYTES`, `SEARCH_BUDGET`) are the model to copy.
- **Account contamination.** Without a declared home, `homes_for` picks the newest match — a wrong
  guess here does not show a wrong number, it shows **another account's work in this project's tab**.
  The tool names the home and session it read, and shows nothing when more than one is plausible and
  none is declared.

---

## Enforcement — what remains

Stage 2 (`PreToolUse` deny) and stage 3 (`Stop` exit 2) are **struck** (C5). What is left needs no
threat model of its own:

**A `UserPromptSubmit` hook appends one sentence, and only when this session has no task list.** A
plan exists → the hook is silent, costing nothing. It decides nothing, blocks nothing, and cannot
fail closed.

Two constraints on it, and the first is a real finding:

- **Its text is a constant in the script — no interpolation from repo or transcript data**, pinned by
  a test. `additionalContext` is model-visible; building the sentence from `work-levels.json` would
  let a hostile repo write `"Ignore previous instructions…"` into the agent's context at every
  prompt, through a channel nobody perceives as input.
- **It is a second script, and a separate consent.** `ygg-hook` says, in capitals, *"WRITES AND NEVER
  READS OR DECIDES"*; and `refresh_agent_hooks` (`commands/mod.rs:817-847`) adds every event this
  build needs at startup, deliberately, because *"nobody presses install again"*. That mechanism must
  not carry a second hook into installations that consented to a passive reporter.

Everything else is the rule in context (`rule:work-legibility`, `load: core`) and the tool being
honest when no plan is there.

## What this tool will not claim

- **No remaining time.** Estimating from past durations assumes the remaining work resembles the
  finished work, and it does not. "8 minutes" that takes 40 gets planned against.
- **No percentage without a plan.** With one it now falls out for free (C1).
- **No causal graph** — `blocks`/`blockedBy` are empty in 100 % of live data (§1).
- **No claim about the future from the trace.** Dashed links are frequency, drawn as such.
- **No answer to "is it stuck?" beyond a reported halt.** A 40-minute build and a wedged process look
  identical in a trace. Worth stating, because it is the question somebody opens this at 23:00 for.

## What was built (v0.52.0)

| # | Step | Where it landed |
| - | ---- | --------------- |
| 1 | Threat model, before any code | `docs/adr/project/proj-005-chain-tool-trust.md` |
| 2 | Idempotent reader, classifier, folding, coverage | `src-tauri/src/agent/chain/{mod,classify,fold,cache}.rs` |
| 3 | Plan reconstruction in the same pass (C2) | `chain/mod.rs` — `parse_transcript` |
| 4 | Delegated work counted rather than hidden (C3) | `chain/mod.rs` — `delegated_steps` |
| 5 | Declaration reader, escalate-only | `chain/levels.rs` |
| 6 | DTOs, bindings, `agent_chain`, api wrapper | `chain/model.rs`, `commands/terminal.rs`, `src/api/terminal.ts` |
| 7 | `Disclosure` primitive + lint; `AgentTool` fixed with it | `src/components/ui/Disclosure.tsx`, `eslint.config.project.mjs` |
| 8 | The tool, with the nine UI corrections | `src/components/tools/ChainTool.tsx` |
| 9 | The nudge, its own script and its own consent | `src-tauri/resources/cli/ygg-plan-nudge` |
| + | The grammar gate the panel asked for | `scripts/project/check-work-levels.mjs` (in `check:all`) |
| + | Adoption: the app hands the convention to a foreign repo | `src-tauri/src/adoption.rs`, `resources/adoption/`; manual route in `docs/adoption/` |

**Four decisions taken during implementation** that the plan had left to the keyboard, recorded here
because each changed the design:

- **One vocabulary, and it is the rule's.** The mockup's `TEST`/`FIX`/`GATE` are gone; the interface
  shows `verify e2e`, `build`, `ship commit`. Two names for one thing is ADR-CORE-005 duplication,
  and the declaration could not have produced the mockup's words.
- **Consecutive builds merge across their refinement; verifies do not.** The first run against a real
  session produced **84 links instead of 39**, because every edited file started its own — four lines
  for one act of translating. A build's refinement is a file and there are many; a verify's is a
  suite, and switching it is meaningful.
- **A `Read` counts as understood.** Conflating "is a probe" with "could not be classified" reported
  33 % coverage for a session the reader had read correctly. Only an unrecognised program lowers it.
- **`ship/pr` became `ship/review`.** Platform-neutral, because the rule is meant to travel.

## What the first days of real use changed (v0.52.1)

Every one of these was found by watching the tool report on the session that was building it — the
loop the maintainer asked for in those words, and the only reason they were found at all.

- **The state is reported, never inferred.** `Standing` came from the age of the last transcript
  line, so a long `cargo build` read as *finished*. The gap between two tool calls is routinely
  longer than any usable threshold — an agent thinking writes nothing — so **no threshold exists any
  more**: `UserPromptSubmit` opens a turn, `Stop` closes it, and where neither has been heard the
  answer is `Unknown` and says so (ADR-CORE-004). Demanded verbatim: *"das darf aber keine geratener
  Zustand sein, das muss ein gewollt herbei geführter Status sein"*.
- **A declaration is matched on the command, not on the refinement.** `Levels::apply` compared
  `work-levels.json` against the link's *category* (`unit`), which no entry lists as its `run`. A
  project with a correct declaration therefore still saw nearly every link marked as a guess. `Step`
  now carries the signature the classifier wrote, and the fixtures keep the two deliberately
  different so the old behaviour cannot come back quietly.
- **`compact` is an act.** The one event that changes what an agent knows and leaves no tool call
  behind. It also answers the "chain across a compact" question below by *showing the seam* rather
  than choosing a side.
- **The marks have a legend, on demand, grouped by region.** Six shapes serve two questions — *"how
  did that go?"* about the trace and *"what is still outstanding?"* about the plan — and a flat list
  answered neither. It sits outside the scrolling trace, because a legend that scrolls away is gone
  exactly when the trace is long enough to need one.
- **Which transcript a chain was read from is logged.** A directory holds one file per session and
  the live one is *chosen*, so "am I looking at the wrong session?" is a question that gets asked —
  and it was, about a step nobody recognised. Path and offsets only, never a line out of the file
  (ADR-PROJ-005 §1).
- **The declaration covers the road actually taken.** `cargo test`, `npx vitest run`, `git commit`
  are typed constantly and were declared nowhere, so the panel called them guesses. Honest, and
  needlessly vague — they are the same level of work reached by a shorter road.

## Still open

Named rather than quietly deferred (ADR-CORE-002 — no leftovers, and what is left is on the record):

- **Parallel work.** `owner` and subagents mean two things can run at once; the tool has one "now"
  line, one pulse, one clock. A delegated link says how many steps it is hiding, which closes the
  "looks like nothing happened" hole — it does not yet show the sub-chain under its own node.
- **The chain across a compact.** Three compacts in one measured session. Show everything (work
  nobody remembers) or cut (four hours vanish)? Neither: the compact is drawn **as a step**, so the
  seam is visible and the choice stays with whoever is reading. Whether a long trace should also be
  *foldable* at that seam is still open.
- **`work-levels.json` for `lysisai-dsp`** — drafted and gate-checked here (27 entrypoints), not
  written into that repository while an agent works in it. Its `$verify` markers name the entries I
  could not establish by reading alone.
- **User-assigned signatures** (priority 2 of the classification chain). Only needed for a project
  with no declaration, and the heuristic already says when it is guessing.

## The rule's own lifecycle — it is a guest here

`rule:work-legibility` sits in this project's line because that is the only layer this repository owns
(mem:project-scope: a leaf). It is written to be layer-agnostic and self-supporting so it can be
copied into any repository alone.

**The maintainer intends to adopt it into `althing`.** When it arrives through `governance:update`,
the project-line copy is **deleted, not superseded** — same rule, same id, and `check-index.mjs:36-44`
will report the duplicate id on the next `check:all` (verified: `governance:update` itself stays
silent, because `detectCollisions` returns early for a leaf).

Before it can go upstream, the stack-specific mentions have to go: `playwright`, `npm run …`,
`TaskCreate`/`TaskUpdate`, and `Makefile`/`justfile`/`package.json` in `applies-to`. A core rule may
name no framework (ADR-CORE-033).

Until then this repository is the proving ground, and `work-levels.json` in the root declares its own
levels. A convention its author does not live under is one nobody else will keep.

## References

- `rule:work-legibility` — the naming convention this reads
- `work-levels.json` — this repository's own declaration
- `mem:surfaces` — why this is a tool, why it must not poll in the background
- `rule:attention-signals` — the halt signal, reused rather than reinvented
- `rule:content-size` — why the chain follows the terminal's font size
- ADR-PROJ-001 §5/§6 — the frontend never chooses what runs; PTY content is never logged
- ADR-PROJ-004 — the precedent for an ADR when a trust boundary moves
