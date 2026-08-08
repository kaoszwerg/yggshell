---
id: rule:work-legibility
title: Every piece of work says what it is
tldr: "Name work so it reads from outside: a declared entrypoint per level, a branch per package, a task list per sitting. Four axes — act/refinement@target#area."
scope: workflow
load: core
triggers:
  [
    work,
    level,
    stage,
    phase,
    package,
    plan,
    task,
    entrypoint,
    script,
    target,
    test,
    unit,
    integration,
    e2e,
    audit,
    smoke,
    verify,
    gate,
    lint,
    deploy,
    release,
    ship,
    staging,
    production,
    live,
    environment,
    branch,
    naming,
    convention,
    declare,
    manifest,
  ]
applies-to: ["work-levels.json", "scripts/**", "**/{Makefile,justfile,package.json,*.mk}"]
---

# Every piece of work says what it is

An agent works for hours and leaves a stream of commands. From outside — a colleague, a dashboard,
the same agent after a compact, you tomorrow — that stream is unreadable: the same test command can
run against a container on this machine or against the system real people use, and **nothing in it
says which** (measured: the target came from a constant imported by the test config, not from the
command line).

This rule makes work legible from outside. Not by asking anyone to narrate what they are doing —
narration is dropped by the third hour — but by requiring that the **artefacts** of the work carry
their own meaning. Each is set once and stays true for as long as the work lasts.

## The one thing this refuses

**A level of work that exists only as an argument, an environment variable, or a habit.**

If the difference between "tests my machine" and "tests the live system" is a variable somebody
exports before running the same command, that difference is invisible, unverifiable, and one typo
away from a disaster. **A level of work must have a name of its own.**

## The five carriers

| What                                    | Carrier                                   | Lives for | Written                  |
| --------------------------------------- | ----------------------------------------- | --------- | ------------------------ |
| **The undertaking** — the goal          | a plan document in the repository         | weeks     | once                     |
| **The package** — one shippable piece   | the branch name                           | days      | once                     |
| **The level** — one kind of run         | a **declared entrypoint** (script/target) | permanent | once, when it is created |
| **The sitting** — today's ordered steps | the harness's own task list               | hours     | **per step**             |
| **The course** — what actually happened | nothing. It is observable.                | live      | never                    |

Four of the five are written once and stay true without anyone returning to them. Deliberate:
anything that must be repeated will be dropped, and a convention dropped half the time is worse than
none — it makes the surviving half look complete.

## The vocabulary

```
act/refinement@target#area        verify/e2e@dev#core
act@target                        ship/deploy@prod
act                               build
```

Order is fixed, everything after `act` is optional, separators never change: `/` refines, `@`
locates, `#` scopes.

**Act — what is being done.** Seven, exhaustive by construction: every command either decides, changes
the source, produces an artefact, checks, hands work on, delivers, or looks.

| Act      | Means                                                            |
| -------- | ---------------------------------------------------------------- |
| `plan`   | deciding what to do: designing, specifying, recording a decision |
| `edit`   | changing the source: code, config, content, a migration           |
| `build`  | producing an artefact from it: a compile, a bundle, generated code |
| `verify` | finding out whether it is right: tests, gates, linters, audits   |
| `subagent`| handing work to a subagent, whose own steps live elsewhere   |
| `ship`   | putting it where it counts: commit, push, review, deploy, release |
| `probe`  | finding out how things stand: reading, measuring, diagnosing     |

**`probe` is the default** — anything undeclared is a probe, the honest answer for a search or a
status check.

**Refinement — what kind, within the act.** Two acts take one; the others do not.

- **`verify`** takes a *depth*, and the ordering is the point — each is slower, more realistic and
  less isolated than the one above:

  | Depth         | Reaches                                                       | Broken means            |
  | ------------- | ------------------------------------------------------------- | ----------------------- |
  | `unit`        | one module, no external process                                | the code is wrong       |
  | `integration` | several parts together, against real services                  | the seams are wrong     |
  | `e2e`         | the whole system through its own surface                       | the product is wrong    |
  | `audit`       | a running installation: security, load, compatibility, drift   | the deployment is wrong |

  `smoke` is not a depth — it is a **short** run at one of these. Say `e2e` and keep it short.

- **`ship`** takes a *step*: `commit`, `push`, `review`, `merge`, `deploy`, `release`. These are not depths and
  carry no ordering.

**Target — what it runs against.** The axis that cannot be guessed and the one that hurts when it is
wrong: `local` (this machine only) · `dev` (development environment) · `staging` (deployed
pre-production) · `prod` (what real people use). **Without a declared target, `local`.** Anything
reaching further says so in its own name, never in a variable.

**Area — which part of the product.** Free and project-owned, taken from the list the project
declares — never invented per run.

## What you actually do

### Once per project — declare the entrypoints

`work-levels.json` in the repository root answers *"what can be run here, and what does each thing
mean?"* — a question a project should be able to answer anyway. **It is project-owned: never pinned,
never delivered by an update, yours to write.**

```json
{
  "version": 1,
  "areas": ["core", "billing"],
  "entrypoints": [
    { "run": "<command as a person types it>", "is": "verify/unit@local" },
    { "run": "<audit runner>", "is": "verify/audit@staging", "reaches": "testing.example.com" }
  ]
}
```

**Where the three pieces go, and who owns each:**

| Piece | Where | Whose |
| ----- | ----- | ----- |
| `work-levels.json` | the repository root — or a package's own directory in a monorepo; a reader walks **up** from the working directory, so the nearest one wins | the project's |
| this rule | wherever **this project's** agents read their rules — its `CLAUDE.md`, its `AGENTS.md`, its own rules directory. It joins the project's governance and is subject to it | the project's |
| the grammar gate | delivered and replaced **in place**, so its path is not the project's to choose: `scripts/check-work-levels.mjs` normally, `scripts/project/check-work-levels.mjs` where `scripts/` is pinned by a governance manifest. Local adaptation is a wrapper beside it that imports from it, never an edit inside it | optional |

**The name `work-levels.json` is the one fixed thing** — a tool looking for it has nothing else to go
on. Everything else about the placement is the adopting project's decision, and deliberately so: a
convention that demanded a directory layout would be refused by every repository that already has
one.

**`run` is the identifying portion — as long as it needs to be, flags included.** Write the shortest
thing that tells this level apart from every other, and no shorter: where two levels differ only in
an argument, that argument belongs in `run`. Eight deployments distinguished solely by
`-f environment=<name>` are eight entrypoints with eight `reaches`, and writing them as one prefix
would be exactly what this convention refuses. A reader takes the **longest** matching declaration,
so a general entry and a specific one can both be listed and the specific one wins.

*(This sentence used to say "the identifying prefix, not the full line with its flags", four
paragraphs after the adopter notes said the opposite. The first project to adopt the rule followed
the notes, correctly, and had to work out which of the two to believe — a document that contradicts
itself makes every reader decide privately.)*

### How `run` is matched, stated exactly — because guessing at it costs a deploy

A reader compares **words, not strings**, and this is the whole contract:

1. Split on whitespace.
2. **A flag is dropped, and so is its detached value.** `--ref next` contributes nothing. A word
   carrying its own `key=value` is **kept**: `-f environment=lysis-portal-prod` contributes
   `environment=lysis-portal-prod`, which is usually the entire difference between two levels.
3. The wrappers nobody means are dropped: `npx`, `bunx`, `bash`, `sh`, `env`, and a leading `./`.
   A leading `VAR=value` assignment is not part of the command either (above).
4. **Every remaining word of `run` must appear in the observed command, in order.** Anything extra in
   the real command — more flags, in any position — is ignored.
5. When several entries match, the one matching **the most** declared words wins.

**What that means for writing the file, and it is the opposite of what it looks like:**

- **Put in `run` only what identifies the level.** `-f environment=lysis-portal-prod` — yes. A
  mandatory flag that is the same for every level, or whose value moves (`--ref next`,
  `-f image_tag=next`), is **ignored by the matcher anyway**, and writing it in costs you the entry
  the day that value changes. There is no way to declare a variable value, and none is needed.
- **A flag being *mandatory to type* is not a reason to declare it.** Those are different questions:
  one is about running the thing safely, the other about telling two levels apart.
- **Declare the specific and the general together if you like.** The specific one wins on word count.

> **Measured, and it is why this section exists.** `lysisai-dsp` declared
> `gh workflow run deploy-hetzner.yml -f environment=lysis-portal-demo` and typed
> `gh workflow run deploy-hetzner.yml --ref next -f environment=… -f image_tag=next …` — because
> without `--ref` the workflow pulls plugin bundles from the wrong branch, which put two environments
> into maintenance mode. Six production deploys, all declared, all green in the checker, and **not
> one of them appeared in the chain**. The reader dropped `--ref` and kept `next`, so a flag's value
> stood where the declaration expected the environment; matching was positional, so everything behind
> it compared against the wrong word. Both are fixed, and the contract above is now written down
> rather than inferred from the code.

### A level that reaches something must never be silent

The same report exposed a second and worse fault, and the lesson generalises beyond this rule: **the
tool decided a command was uninteresting before it consulted the declaration.** A workflow dispatch
was not a shape its heuristic knew, so it was filed as *looking around* — and a look-around is folded
into whatever ran before it. The deployments did not merely lose their label; they left no trace.

So: a declaration is authoritative for **which act** a command is, ahead of any built-in guess. It may
widen a reach and never narrow one — a declaration claiming `@local` where the reader recognised
production is shown as a contradiction, not believed. And **a manually dispatched delivery workflow is
a `ship`, declared or not**: it reaches a registry, a cloud or the public, and a reader that has to be
told that is a reader that will be wrong about the next project too.

`is` is the vocabulary above.
**`reaches` is required whenever the target is not `local`** — the host, cluster or account actually
touched. It is what makes *"am I about to hit production?"* answerable without reading three files.

**A leading environment assignment is not part of the command.** `COVERAGE=on scripts/run-tests.sh
core` is the same level as `scripts/run-tests.sh core`: the variable shifts neither depth, target nor
area. A reader strips them before matching, so do not declare the combinations — there is no end to
them. Same for the wrappers a shell needs and nobody means: `bash`, `sh`, `env`, `npx`.

**A code host is `@prod`.** Pushing, opening a review, merging, or triggering a workflow reaches
something that is not this machine, and pushed history is public and permanent — there is no undoing
it quietly. `prod` reads oddly for a repository the first time, which is why this sentence exists:
the alternative was every project deciding privately, and then two declarations meaning different
things by the same word. `git commit` stays `@local`; a commit reaches nothing until it is pushed.

**One optional field for the rule itself:**

```json
"rule": ".claude/rules/project/work-legibility.md"
```

Where this rule's own copy lives in your repository. Naming it lets a checker tell you when yours is
behind the one it ships beside — **opt-in, because the rule invites you to extend or supersede it and
a check that failed on an edited copy would punish exactly that.** Leave it out and nothing is
checked; the promise is yours to make.

**Two optional fields, for the shapes a checker cannot guess:**

```json
"scriptSources": ["core/frontend/package.json", "plugins/package.json"],
"requiredRunners": ["scripts/run-tests.sh", "./heimdal"]
```

`scriptSources` says which `package.json` files hold this project's scripts — a monorepo often has
none at the root, and a completeness check reading only the root one reports nothing at all there.
`requiredRunners` names entrypoints that must be declared whatever they are called: a heuristic
looking for `test`/`lint`/`deploy` prefixes can never ask for `scripts/run-tests.sh`, and that is
exactly the command an outside reader most needs named. Both come from the first project to adopt
this rule, which had to write its own wrapper for want of them.

**Declaring is not renaming.** An existing project fills this in without moving a single script, which
is why adoption costs an afternoon rather than a quarter.

### Once per entrypoint — a new level gets its own name

A level is never a flag on an existing entrypoint and never an environment variable the caller must
remember. If a run can reach two different targets, that is **two entrypoints with two names**, and
both are declared.

### Once per package — name the branch

```
<act>/<area>-<short-subject>
```

A branch name is **not** a vocabulary expression: git refs tolerate `@` and `#` poorly, so the area is
appended with `/` here and the rest is prose. Prose is what makes a branch findable a month later.

### Per sitting — the task list, and this is the one that gets forgotten

**Most work has no plan document and should not have one.** An afternoon of measuring, fixing and
checking is a real plan with a real order — too small to deserve a file. That plan lives in the
agent's head, which means it dies with the context and is invisible while it runs.

The harness's own task list is the place for it. Two things make it usable rather than decorative:

- **A task subject starts with its act**, so the sitting speaks the same language as everything else:
  `verify/e2e@dev: role coverage across all four roles`.
- **A task is opened before its work and closed after it** — never written up at the end. A plan
  reconstructed afterwards is a report, and reports are for people who were not there.

This is the only part done repeatedly, and therefore the only part that gets skipped. **It is
deliberately not enforced.** Forcing it was built and measured: the gate missed the ordinary route
entirely, and where it did fire it produced a task restating the tool call it had just blocked. A
plan-shaped artefact that reads as information and is none is worse than an honest gap. What works is
this rule being in context and the work being large enough that a list pays for itself — which is a
judgement the agent usually gets right.

### A plan document is intent, never state

A directory of twenty plans says nothing about which one is being worked on. A `Status:` field does
not fix that — it is the same maintenance failure in the place least likely to be opened, and a plan
still reading `in progress` two months after it shipped is a lie the repository preserves. So the
direction of reference is fixed, and it is the opposite of the obvious one:

> **The sitting points at the plan. The plan never points at the sitting.**

A task carries the document it serves; it is being written anyway and is discarded when done. Whether
something is *active* is answered where activity is: the task list and the branch.

## What this does not ask for

No narration per command, no status file to keep current, no tool. Everything above is a name, a
file, or a branch — a project adopting this needs nothing installed, and benefits even if nobody ever
reads it mechanically.

## Where a declaration enumerates, the gate re-derives

**Anything the project discovers at runtime and the declaration lists by hand is stale on the next
commit.** A test runner that takes a plugin name, a build that takes a package, a deploy that takes
an environment: each of those instances needs its own entry, because each carries its own `#area`
and its own `reaches` — and that is exactly what guarantees the file falls behind. The next plugin
has no line, no area, and renders as a bare `verify/integration@local`, which reads as a fact.

So the gate does not trust the file for these. It **re-derives the list from the same source the
project itself uses** — the plugin directory, the workspace list, the environments file — and
requires an entry per instance. Measured by the first project to do it: nine genuine gaps in a
declaration one hour old, seven of them builds nobody had thought of.

The same shape, twice more:

- **A manually-triggerable delivery workflow is an unnamed level.** A `workflow_dispatch` job called
  `deploy`, `release`, `publish` or `mirror` is a command a person types and it reaches a registry, a
  cloud or the public. Require those. **Not** the ones that only run on push — demanding an entry for
  every CI gate is the noise that gets a checker switched off within a week (ADR-CORE-039).
- **The reverse direction:** an entry naming a script that no longer exists. A declaration outliving
  reality is the same defect from the other end, and it found a dispatchable deploy here whose
  environments had been gone for months.

This is the `reaches` principle applied to the file itself: **what rots is what nobody re-reads.**

## Why this is a rule and not (only) a lint

The checkable parts should be checked: that `work-levels.json` parses, that every entry uses a valid
act/refinement/target, that a non-`local` target carries `reaches`, and — this is the one that keeps
the file from rotting — that a **runnable level declared nowhere** is named. A declaration's real
failure mode is not being wrong, it is being from March; everything else here checks what is
written, that one checks what is missing.

**And it reaches only as far as the project is declarative.** The check reads `package.json`
scripts, because they are machine-readable and cost no guessing; a project whose runs live in a
`Makefile`, a `justfile` or a `scripts/` directory is **not covered**, and the rule says so rather
than implying a completeness it does not have. It is also deliberately narrow about what counts —
`dev`, `start` and `prepare` are not levels of work, and a check that flagged them would be
suppressed inside a week, which lowers the real posture while raising the nominal one
(ADR-CORE-039).

What no checker can do is decide whether `verify/integration@dev` is the **truthful** label. A run
named `unit` that quietly reaches a database is a lie the file cannot detect — only the person writing
it can, at the moment they write it. That is why the rule is addressed to them, and why it is
`load: core`: **the failure emits no vocabulary.** Somebody naming a script is not thinking about a
naming convention and will never search for one.

**How to apply:** creating a script, a target, a branch or a plan — name it from the vocabulary and,
for anything runnable, add its line to `work-levels.json`. Meeting a project without that file, write
it from what is already there.

**Lifecycle note (this repository only):** the maintainer intends to adopt this rule upstream. When it
arrives from there, this project-line copy is **deleted, not superseded** — same rule, same id; two
files claiming one id is drift (rule:rule-maintenance).
