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
| the grammar gate | wherever this project runs its checks; it takes the repository root as its first argument, so the path is free. `scripts/check-work-levels.mjs` if there is no obvious home | optional |

**The name `work-levels.json` is the one fixed thing** — a tool looking for it has nothing else to go
on. Everything else about the placement is the adopting project's decision, and deliberately so: a
convention that demanded a directory layout would be refused by every repository that already has
one.

`run` is the identifying prefix, not the full line with its flags. `is` is the vocabulary above.
**`reaches` is required whenever the target is not `local`** — the host, cluster or account actually
touched. It is what makes *"am I about to hit production?"* answerable without reading three files.

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
