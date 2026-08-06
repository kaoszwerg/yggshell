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

1. **The check** — `scripts/check-work-levels.mjs`, and **leave it there**. It is not yours to edit
   or to move: it is delivered, and the app replaces it in place when a newer one ships, which is
   how a fix reaches a repository that adopted months ago. Moving it means never being told that
   your copy is behind. Local adaptation goes in a **wrapper beside it** — import
   `parseExpression`, `checkDeclaration`, `undeclaredScripts(declaration, scripts)` and
   `undeclaredExamples` from it; importing the module does not run it, and those four names are
   stable. Wrap, do not patch: an edit inside the delivered file is lost without trace on the next
   update.

   It takes the repository root as its first argument (`node scripts/check-work-levels.mjs .`, and
   with no argument it walks up from where you are) and exits non-zero on a declaration that does
   not parse, uses an act or target outside the vocabulary, leaves a non-`local` target without
   `reaches`, or omits a runnable level that `package.json` declares. Wire it — or your wrapper —
   into whatever this project already runs as its gate. It is optional; the rule is worth keeping
   without it.
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

Five things the first project to adopt this got wrong or had to ask, in the order they cost time:

1. **Your everyday git and `gh` commands are not `local`.** `git push`, `gh pr create`, `gh pr
   merge`, `gh run view`, `gh workflow run` all reach a service that is not this machine, and pushed
   history is public and permanent. Declare them with a target and a `reaches` — the first adopter
   declared eight deployments at `@prod` perfectly and left every one of these at the default, which
   is the same mistake one floor down. Only what genuinely never leaves the machine is `@local`.
2. **`run` is the identifying portion — as long as it needs to be, flags included.** Where two levels
   of work differ only in an argument, that argument belongs in `run`:
   `gh workflow run deploy.yml -f environment=prod` and `… environment=staging` are two entrypoints
   with two `reaches`, and writing them as one would be the thing this convention exists to refuse.
   A reader takes the **longest** matching declaration, so a general entry and a specific one can
   both be listed.
3. **Declare what you actually type, not only the tidy alias.** If the project has
   `npm run test:e2e` but you habitually run `npx playwright test`, declare both — a reader can only
   recognise what is written down.
4. **Static gates are `verify/unit@local`.** Linters, type checks, secret scanners, i18n parity —
   none of them start an external process, and `unit` is the depth for that. It reads oddly the
   first time; every project asks, and answering it differently in each one is what would make the
   vocabulary useless.
5. **Do not declare the harness's own tools.** Editing a file, reading one, searching, keeping your
   task list — those are read directly and named without any help. `work-levels.json` is for
   commands you run in a shell, and only for those.

---
