# Upstream report → `kaoszwerg/saga-rust-template` (app layer)

Found while bootstrapping `yggshell` from the template at `336dea6` (main). Three defects, all in files
the template ships to every fork, all fixed **here** and therefore still present **there**. Per
`rule:upstream-changes` §3 this is a proposal to the maintainer, not a commit made in that repo.

Verification for each below is from `yggshell` at the state where `npm run check:all` exits `0`.

---

## 1. A crash report can erase the one before it — `src-tauri/src/crash.rs`

**Severity: highest of the three.** This is a silent loss of the exact artefact
`rule:crash-handling` §3 requires ("leaves a durable record on the device").

`write_report_in` derived the file name from a millisecond timestamp alone:

```rust
let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S%.3f");
let path = dir.join(format!("crash-{stamp}-{kind}.log"));
std::fs::write(&path, compose(kind, details))?;   // overwrites
```

Two panics inside the same millisecond — or two processes crashing at once — produce the **same** path,
and the second write erases the first report. The template's own test
`two_crashes_never_overwrite_each_other` covers exactly this, but asserts it against the wall clock, so
it passes or fails by luck. Observed failing on macOS:

```
thread 'crash::tests::two_crashes_never_overwrite_each_other' panicked at src/crash.rs:297:9:
assertion `left != right` failed: each crash keeps its own report
  left:  ".../crash-20260731-070125.028-panic.log"
  right: ".../crash-20260731-070125.028-panic.log"
```

**Fix applied here.** Split the timestamp out into `write_report_stamped(dir, stamp, kind, details)`, and
claim the name atomically instead of overwriting:

- `OpenOptions::new().write(true).create_new(true)` — atomic against another process, not just another
  thread;
- on `ErrorKind::AlreadyExists`, retry with a `-1`, `-2`, … suffix;
- bounded by `MAX_NAME_ATTEMPTS = 64`, because a crash path must terminate — an unbounded search would
  hang the process at the moment it is already failing. Exhaustion returns `Err`, which the existing
  `write_report` already turns into a logged `None` rather than a second crash.

**Tests added** (both deterministic — the stamp is injected, so no clock race):
`a_second_crash_in_the_same_millisecond_does_not_erase_the_first`, `the_collision_search_is_bounded`.
The template's original test now passes deterministically too; 15 consecutive runs of
`cargo test --locked --lib crash` were green.

---

## 2. The whole frontend suite is red on Node ≥ 26 — `src/test/setup.ts`

`package.json#engines` allows `node >= 20.19`, so this hits any fork on a current Node. 11 of 223 tests
failed on Node 26.4.0 with:

```
TypeError: Cannot read properties of undefined (reading 'setItem')
 ❯ Object.setItem node_modules/zustand/esm/middleware.mjs:300:42
```

**Cause** (measured inside a vitest jsdom test, not inferred):

| | |
|---|---|
| jsdom's own `window.localStorage` | `object` — works, URL `http://localhost:3000/` |
| `window === globalThis` under vitest | `true` |
| `globalThis.localStorage` | Node 26's accessor, **non-enumerable**, `configurable: true` |

Node ≥ 26 ships its own `localStorage`/`sessionStorage` globals, unavailable unless the process was
started with `--localstorage-file`. They are **non-enumerable own properties** of `globalThis`, and
vitest's jsdom environment copies only the *enumerable* window keys — so Node's version survives and
shadows jsdom's working Storage. Every read yields `undefined`, and zustand's `persist` middleware (used
by `src/store/ui.ts`) breaks on it.

**Fix applied here.** In `setup.ts`, re-point both globals at the jsdom window's real Storage objects,
guarded so the node-environment governance-script tests are unaffected:

```ts
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow) {
  restoreStorage("localStorage", globalThis.localStorage, jsdomWindow.localStorage);
  restoreStorage("sessionStorage", globalThis.sessionStorage, jsdomWindow.sessionStorage);
}
```

`restoreStorage` takes the name and both values as parameters rather than indexing `globalThis[key]` —
the dynamic index trips `security/detect-object-injection`, and the template runs
`eslint --max-warnings 0`. Suppressing it was not an option (`rule:security`).

**Test added:** `src/test/environment.test.ts` pins that the environment exposes working
`localStorage`/`sessionStorage`, so a regression surfaces as its own failure instead of as a confusing
error inside a third-party middleware.

---

## 3. `sync-identity.mjs` misses `src-tauri/examples/`

After `npm run identity:sync`, `src-tauri/examples/crash_probe.rs` still called
`saga_rust_template_lib::crash::…`. The script rewrites the crate references in `src-tauri/src/main.rs`
and `src-tauri/tests/contracts.rs`, but not in `examples/`, so **`cargo clippy --all-targets` breaks on
every fork immediately after the rename** — which is the one moment `identity:check` reports
`OK — 8 derived locations match`.

**Fix applied here:** by hand, in the file. **The real fix is in the script**: add `src-tauri/examples/`
to the crate-reference rewrite set (and ideally glob it, so a future example is covered without another
round of this). `scripts/sync-identity.mjs` is pinned to the app layer, so a fork cannot fix it.

---

## Suggested handling

1, 2 and 3 are independent; each is a `fix:` commit of its own. 1 and 2 are also worth a
`docs/migrations/app-NNN-*.md` briefing, since existing forks carry the defect and their agents will not
otherwise learn of it — 2 in particular presents as "the template's own test suite is broken", which is
exactly the situation where an agent starts weakening the gate.
