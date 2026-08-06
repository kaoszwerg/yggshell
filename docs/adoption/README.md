# Adopting `work-legibility` in another repository

Everything needed to introduce the convention somewhere else, in one directory. It assumes nothing
about the other project: no governance framework, no index generator, no Node beyond running one
script if you want the gate.

**Adoption is an afternoon, and it never renames anything.** A project declares what it already has;
scripts, targets and branches stay exactly where they are.

## What is in here

| File | What to do with it |
| ---- | ------------------ |
| `work-legibility.md` | The rule. Copy it wherever that project keeps its agent-facing rules. |
| `work-levels.example.json` | A filled-in example to start from. |
| `../../scripts/project/check-work-levels.mjs` | The gate. Optional, and it takes the repository root as its first argument, so it runs from anywhere. |

## The three steps

**1. Put the rule where that project's agents actually read it.** Its own `CLAUDE.md`, its rules
directory, its `AGENTS.md` — wherever an agent looks at the start of a task. The rule is written to
be self-supporting: it names no stack, needs no tooling, and cites nothing outside itself.

If that project has a governance system with front-matter, add whatever fields it expects. The copy
here has none, on purpose — front-matter belongs to the system that reads it.

**2. Write its `work-levels.json`.** Answer, for that project: what can be run here, and what does
each thing mean? Start from the example, and take the commands from wherever they are already
written down — a `package.json`, a `Makefile`, a `scripts/` directory, the README.

The one field to get right is **`reaches`**. Anything whose target is not `local` says where it
actually goes. That is what makes *"am I about to hit production?"* answerable without reading three
files, and it is the only part of the file that can hurt somebody when it is wrong.

**3. Optionally, wire the gate.** `node check-work-levels.mjs <repo-root>` exits non-zero on a
declaration that does not parse, uses an act or target that is not in the vocabulary, or leaves a
non-local target without `reaches`. Put it wherever that project runs its checks.

It is genuinely optional: the rule is worth having without it. But the first version of this
repository's own declaration used two expressions the rule did not allow, and nobody noticed until a
reviewer read both documents side by side — which is what a gate is for.

## What it will not do

**It cannot tell you whether a label is true.** A run declared `unit` that quietly reaches a database
is a lie no parser can see; only the person writing the line can, at the moment they write it. That
is why the rule is addressed to them and why every entry is written once, when the thing is created,
rather than maintained.

**It is not a reporting obligation.** Nothing here asks an agent to narrate what it is doing, keep a
status file current, or install anything. Four of the five carriers are written once and stay true on
their own; the fifth is the task list the harness already offers.

## Where this came from

`docs/plans/chain-tool.md` in this repository, and everything in it was measured rather than
reasoned about. The convention exists because a test command was found whose target came from a
constant imported by its config — so the same command line ran against a container or against a
public host, and nothing in it said which.
