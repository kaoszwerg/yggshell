# 107 — a crash report could erase the one before it (ADR-APP-032)

Audience: the agent working in a project **forked from this Tauri shell**.
Layer: **app** — but `src-tauri/src/crash.rs` is **your** file, so `governance:update` does **not** fix
this for you. Port it by hand.

## The defect

`write_report_in` named every report from a millisecond timestamp alone and wrote it with
`std::fs::write`:

```rust
let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S%.3f");
let path = dir.join(format!("crash-{stamp}-{kind}.log"));
std::fs::write(&path, compose(kind, details))?;   // truncates whatever is already there
```

Two reports written inside the same millisecond therefore resolve to the **same path**, and the second
one silently truncates the first. The record the user is asked to send you — the one thing
`rule:crash-handling` §3 requires a dying process to leave behind — is the thing that gets lost.

This is not hypothetical in a shell that has **two** report writers:

- `crash::fatal` (panic / startup failure), which ends the process, and
- the `report_crash` command (a fatal error in the **webview**), which writes a report and **returns** —
  so a single process can write several reports in a session, milliseconds apart.

On top of that, two instances of the app share one crash directory, and `create_new` is the only claim
that holds across processes.

## The test that was covering it did not

`two_crashes_never_overwrite_each_other` timed two real writes against the wall clock and passed
whenever the filesystem happened to be slow enough. It passes 60/60 on Windows and was observed failing
on macOS:

```
assertion `left != right` failed: each crash keeps its own report
  left:  ".../crash-20260731-070125.028-panic.log"
  right: ".../crash-20260731-070125.028-panic.log"
```

A test whose outcome depends on how fast the disk is does not pin the behaviour — it reports the weather.

## What you must do

Port these three things from the template's `src-tauri/src/crash.rs`:

1. **`MAX_NAME_ATTEMPTS`** (64) — the bound on the collision search.
2. **`write_report_stamped(dir, stamp, kind, details)`** — the writer, with the timestamp handed in.
   It claims the name with `OpenOptions::new().write(true).create_new(true)`, walks to
   `crash-<stamp>-<kind>-1.log`, `-2.log`, … on `ErrorKind::AlreadyExists`, and returns `Err` once the
   bound is reached. `write_report_in` keeps its signature and supplies `Utc::now()`.
3. **Both new tests** — `a_second_crash_in_the_same_millisecond_does_not_erase_the_first` and
   `the_collision_search_is_bounded`. They use a fixed stamp, so they are deterministic on every
   machine; keep the original wall-clock test as well, it now covers the real `write_report_in` path.

Nothing else changes: `write_report` already turns an `Err` into a logged `None`, so an exhausted search
is a logged non-event, never a second crash.

Then: `npm run check:all`.

## What is now forbidden

- **`std::fs::write` on a report path.** A report is *claimed*, never overwritten. `create_new` is the
  atomic part — it also holds against another process, which an in-process counter would not.
- **An unbounded search for a free name.** This code runs on an already-fatal path. A process that hangs
  while crashing tells the user even less than one that dies; the bound is the point, not a detail.
- **A collision test that races the clock.** Hand the stamp in. "It passed on my machine" is exactly what
  this defect did for as long as it existed.
- **Widening the stamp instead** (microseconds, nanoseconds). It shortens the window; it does not close
  it, and it does nothing at all about two processes.
