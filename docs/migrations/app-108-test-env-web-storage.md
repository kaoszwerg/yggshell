# 108 — your frontend suite is red on Node 26 (Web Storage)

Audience: the agent working in a project **forked from this Tauri shell**.
Layer: **app** — but `src/test/setup.ts` is **your** file, so `governance:update` does **not** fix this
for you. Port it by hand.

## The symptom you will actually meet

On Node ≥ 26 (`engines` allows `node >= 20.19`, so this is any developer on a current runtime), tests
that touch persisted state fail like this:

```
TypeError: Cannot read properties of undefined (reading 'setItem')
 ❯ Object.setItem node_modules/zustand/esm/middleware.mjs:300:42
```

Nothing in that message names Node, jsdom or Vitest. It reads as *"the template's test suite is
broken"* — which is the situation in which an agent starts weakening the gate. It is none of those
things; read the cause before you touch anything.

## The cause, verified

- **Node ships its own `localStorage` / `sessionStorage` globals.** Enabled by default in 25.0, reverted
  in 25.2.1, landed for good in 26.0. Without `--localstorage-file` they are unusable: reading throws
  (≤ 25) or yields `undefined` (≥ 26, `nodejs/node@fa70327`).
- **Vitest's jsdom environment does not overwrite them.** `getWindowKeys` copies window properties onto
  `globalThis`, but skips every key that **already exists there** unless it is in its own fixed copy
  list — and `localStorage` is not in that list
  (`node_modules/vitest/dist/chunks/*.js`, `getWindowKeys`). Node's global therefore survives and
  shadows jsdom's working Storage. `window === globalThis` under Vitest, so `window.localStorage` is the
  broken one too.
- **There is no fixed Vitest release to upgrade to** (checked against `vitest@4.1.10`, the current
  latest; upstream issue `vitest-dev/vitest#8757` is closed pointing at the workaround below).

You can reproduce it on **any** Node version, which is also how you verify your fix:

```bash
NODE_OPTIONS="--experimental-webstorage" npm test    # red before the fix, green after
```

## What you must do

Port from the template's `src/test/setup.ts`: the `createMemoryStorage()` helper and the
`if (typeof document !== "undefined")` block that installs it over `localStorage` and `sessionStorage`.
Port `src/test/environment.test.ts` with it — that is what makes a future regression fail as *itself*
("the test environment has no working localStorage") instead of as a stack trace inside somebody's
dependency.

Two details in that code are load-bearing, so do not tidy them away:

- **The install is unconditional.** Whether the runner's storage works depends on the Node version, and
  that version-dependence *is* the defect. Probing the existing value first is not an option either —
  the probe is what throws.
- **The DOM guard.** Script tests opt into the `node` environment per file
  (`// @vitest-environment node`); a browser global has no business existing there.
- **`key(index)` walks the map instead of indexing an array.** A computed array index is an
  object-injection sink that `eslint-plugin-security` reports, and the gate runs at `--max-warnings 0`.

Then: `npm run check:all`.

## What is now forbidden

- **`NODE_OPTIONS=--no-webstorage` as the repo-wide fix.** It fixes the cause on a machine that has it,
  and kills every worker on Node < 25 — which `engines` still allows. Use it to diagnose, never to ship.
- **Suppressing the lint finding** (`eslint-disable security/detect-object-injection`) to keep a
  one-liner. Fix the code; silencing a scanner to reach green is the regression `rule:security` exists
  to prevent.
- **Deleting or skipping the failing storage tests.** They are the ones that caught this.
- **Assuming this is only about `zustand/persist`.** Anything that reaches for Web Storage — a query
  cache, a feature flag, a saved layout — hits the same shadowed global.
