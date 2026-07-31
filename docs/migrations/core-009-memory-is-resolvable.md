# core-009 — Memory triggers finally have a reader (`context-for.mjs` reports memory)

Audience: the agent working in any repo that consumes this core, and especially one that keeps
`load: conditional` memory — those entries were carrying triggers that nothing read.
Layer: **core** (delivered by `governance:update`).

## What changed

The gate has always demanded `triggers` or `applies-to` on a `conditional` memory entry — the same
reachability contract it applies to rules and ADRs (`scripts/lib/governance.mjs` → `validateCommon`, called
from `scripts/lint-memory.mjs`). Its error message says the entry would otherwise be *"unreachable — no
agent ever loads it"*.

For memory that was not true of the tool: `scripts/context-for.mjs` loaded memory **only** to resolve
supersessions and reported ADRs and rules alone. `MEMORY.md` printed title + tldr and nothing else. So a
memory trigger was a required field with **no consumer anywhere in the system** — the gate asked for it,
and then no code and no index ever looked at it.

Three things now close that:

1. **`context-for.mjs` reports memory.** A third section, `Memory to load`, resolved exactly like the other
   two — `core` always, `conditional` on a trigger keyword or an `applies-to` glob, `archival` never, and a
   superseded entry named rather than listed (ADR-CORE-035).
2. **`MEMORY.md` carries the matching fields.** A conditional entry's line now ends with
   `· triggers: a, b · applies-to: src/**`, so the boot indexes alone tell an agent what would pull it in.
   Core entries are unchanged — they are always loaded, so they have nothing to match on.
3. **`.claude/memory/README.md` documents the two fields** and says they are mandatory for
   `load: conditional`. It previously listed the schema without them, which walked every agent that
   followed it straight into the gate.

## What you must do

**1. Re-run the indexes.** Every `conditional` memory line in your `MEMORY.md` changes; the staleness gate
fails until it is regenerated. `governance:update` already does this for you — this is only for a repo that
pulled the files another way:

```bash
npm run governance:sync && npm run check:all
```

**2. Read your conditional memory's triggers as if they now mattered — because they do.** Until now they
were never matched against anything, so nobody found out whether they were any good. Check each entry with
the lookup a future agent would actually run, and confirm it appears:

```bash
node scripts/context-for.mjs "<the words that agent would type>" <the files they would touch>
```

An entry that does not show up is not loaded, and the fix is the triggers, not the prose
(rule:knowledge-handover §3).

**3. If your layer publishes memory, this applies to it too.** Its triggers reach every consumer
downstream, so a bad keyword there is a bad keyword everywhere.

## What is now forbidden

- **Treating memory as a lesser kind of governance document.** It resolves like an ADR and a rule, it is
  gated like one, and it is now reported like one. A `conditional` entry without triggers still fails the
  gate — that demand is no longer hollow.
- **Re-deriving the load decision by hand from `MEMORY.md`.** If you are unsure what to read, run
  `context-for.mjs`; it lists all three kinds, and it is the tool the verification obligation names.

## Why

The gate and its resolver disagreed, and the resolver is the one an agent actually obeys. A required field
that nothing reads does not merely fail to help: it teaches the next agent that this governance asks for
paperwork, which is precisely how a gate stops being trusted (rule:knowledge-handover §1 — *if it can be
checked, check it*, and the check has to be worth something).

Fixing the resolver rather than dropping the demand also follows the rule the situation was a test of: a
finding is not made to disappear by disarming the check that produced it (rule:code-quality, ADR-CORE-002
§9 *fix, don't remove*). The demand was right; the tool was incomplete.

Found by a downstream project, which is where it had to be found: every memory entry in the core itself is
`load: core`, so the branch in question never executes here.
