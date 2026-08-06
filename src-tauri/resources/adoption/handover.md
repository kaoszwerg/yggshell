This comes from YggShell's Chain tool. It shows a person watching this terminal what you are doing —
the chain of work behind you, what is running now, where you are going round in circles, and what is
still on your list. It reads all of it out of your own transcript: nothing is reported, nothing
phones anywhere, and you are never asked to narrate. What follows is how to be legible to it, and
none of it is work you would not otherwise do.

**Three things make you legible. Two are free; the third is a file.**

1. **Keep your task list, and keep it current.** `TaskCreate` before the work, `TaskUpdate` to
   `in_progress` when you start it, `completed` when it is done. That list _is_ the plan half of the
   panel — without it a person watching sees a trace with no destination, and there is no other
   source it could come from. Start each subject with what the work is, in the vocabulary of the
   rule below: `verify/e2e@dev: role coverage across all four roles`.
2. **Run the entrypoints the project declares**, rather than an ad-hoc equivalent of one. Typing the
   underlying runner where a declared script exists is not wrong, it is merely unreadable: the panel
   falls back to a guess and marks it as one.
3. **Declare those entrypoints** — the file described below. Written once, and the reason the panel
   can tell a test on this machine from one that reaches production.

**Two files, and they are not treated the same.**

1. **The check** — `scripts/check-work-levels.mjs`, if you accepted the offer to place it; the panel
   reports the exact path, and it is yours to move. It takes the repository root as its first
   argument (`node scripts/check-work-levels.mjs .`) and exits non-zero on a declaration that does
   not parse, uses an act or target outside the vocabulary, leaves a non-`local` target without
   `reaches`, or omits a runnable level that `package.json` declares. Wire it into whatever this
   project already runs as its gate. It is optional — the rule is worth keeping without it.
2. **The rule below** — install it into this repository's own project-level governance, wherever the
   agents working here read their rules (`CLAUDE.md`, `AGENTS.md`, a rules directory). It is
   self-supporting: it names no stack, needs no tooling and cites nothing outside itself. If your
   governance expects front-matter, add whatever fields it wants.

**Then write `work-levels.json`.** In the repository root — or in a package's own directory in a
monorepo, since a reader walks up from the working directory. Take the commands from where they are
already written down: a `package.json`, a `Makefile`, a `scripts/` directory, the README. Do not
rename anything; a project declares what it has. The one field to get right is `reaches` — anything
whose target is not `local` says where it actually goes, and that is the only part of the file that
can hurt somebody when it is wrong.

---
