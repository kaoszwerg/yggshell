# Start a new project from saga-rust-template

`saga-rust-template` is a reusable, governed Tauri 2 + React desktop shell. A new project starts as a
copy of it, is renamed once, and then stays in sync with the template's **portable governance core**.

## 1. Create the repo

- **GitHub template** (recommended): on the template repo choose **"Use this template" → new private
  repo**. Better than a fork — independent history, no upstream-PR coupling.
- **Or degit** (no history): `npx degit kaoszwerg/saga-rust-template my-app`.

Then `cd` into it and run `npm install`.

## 2. Bootstrap it

Run the agent prompt **`/bootstrap`** in Claude Code (or follow `.claude/commands/bootstrap.md` by
hand). It gathers the new name / identifier / tagline, renames the app identity across the checklist,
resets the version + CHANGELOG, marks the repo as a fork of the template, generates new icons, and
verifies with `check:all`. Review the `git diff` and commit.

The mechanical resets alone are `node scripts/bootstrap.mjs --upstream <owner/repo>`; the rename and
icon generation are the agent's job (they need judgement).

## 3. Keep governance in sync

The portable core (rules, ADRs, scripts, config, CI) is pinned in `governance/manifest.json` with a
content hash per file; `governance:check` fails if a core file drifts (ADR-CORE-030). Pull the template's
improvements with:

```
npm run governance:update -- --to v1.2.3   # a tag or branch; default: main
```

It overwrites **only** the core paths, re-runs `governance:sync` + `governance:check`, and stops for
you to review the `git diff`. It never touches your project layer (app name, domain code, domain
ADRs/rules, settings).

Never edit a core file in place in a project — the drift-gate will flag it. Either upstream the change
to the template, or opt the path out of your `governance/manifest.json`.

## 4. Extend the template (maintainers)

Work on `saga-rust-template` directly. Add or change a rule / ADR (see `rule:rule-maintenance`), run
`npm run governance:sync` (which re-pins the core manifest), keep `check:all` green, commit, and tag a
new `vX.Y.Z`. Every project then pulls it with `governance:update --to vX.Y.Z`.
