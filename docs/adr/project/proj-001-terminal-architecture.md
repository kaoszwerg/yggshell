---
id: ADR-PROJ-001
title: Terminal architecture — emulator, PTY, transport and the session model
status: accepted
tldr: "xterm.js in the webview, portable-pty in Rust behind one module, a coalescing Tauri Channel between them; the backend chooses the shell, never the frontend."
scope: fullstack
load: conditional
triggers:
  [
    terminal,
    pty,
    tty,
    shell,
    tab,
    tabs,
    xterm,
    emulator,
    conpty,
    session,
    channel,
    coalescing,
    backpressure,
    scrollback,
    vt,
    ansi,
    escape-sequence,
    killpg,
    process-group,
    sigwinch,
    spawn,
    iterm2,
    theme,
    tmux,
    multiplexer,
    attach,
    detach,
    reattach,
    restore,
    restored,
    survive,
  ]
applies-to:
  [
    "src-tauri/src/terminal/**",
    "src-tauri/src/commands/terminal.rs",
    "src/components/ui/Terminal*",
    "src/components/ui/Tabs*",
    "src/components/ui/ContextMenu*",
    "src/views/TerminalView.tsx",
    "src/api/terminal.ts",
    "ui-boundary.json",
    "crash-boundaries.json",
  ]
supersedes: []
superseded-by: null
---

## Context

YggShell is a developer terminal whose purpose is to enrich AI development harnesses with tools in the
sidebar (`mem:project-scope`). **The terminal is the substrate; the sidebar is the product.** That
ordering decides this ADR more than any technical detail: every hour spent hand-building terminal
plumbing is an hour not spent on the thing that makes the application worth using.

The maintainer's requirement is explicit — the terminal must have *the full feature set of a real
terminal, not a reduced emulation*. Milestone 1 is the terminal component with multiple independent
tabs. Splits and session persistence are deliberately **not** in it.

Everything below was verified before it was decided ([ADR-CORE-004](../core-004-verify-first-no-guessing.md));
the measurements are quoted in *Alternatives* and *Consequences* rather than asserted.

## Decision

### 1. The emulator is `@xterm/xterm`, encapsulated in the primitive layer

`@xterm/xterm` 6.0.0 (MIT), with these addons and no others:

| Addon | Why it is here |
| --- | --- |
| `addon-fit` 0.11.0 | Cell-accurate sizing on resize — the input to `terminal_resize`. |
| `addon-webgl` 0.19.0 | The renderer that keeps a flood of output at frame rate. |
| ~~`addon-canvas`~~ | **Not taken.** 0.7.0 declares peer `@xterm/xterm@^5` and has no xterm-6 release, so npm refuses it. It was never the safety net anyway: the fallback where WebGL is unavailable — Linux/WebKitGTK is our weakest target ([rule:cross-platform](../../../.claude/rules/cross-platform.md)) — is xterm's **built-in DOM renderer**, which needs no addon. `addon-canvas` is a third rendering option, not the guarantee. |
| `addon-unicode11` 0.9.0 | Correct East-Asian and emoji cell widths. Without it "full feature set" is untrue. |
| `addon-web-links` 0.12.0 | URL detection; opening goes through the existing `open_external` command, never the webview. |

`addon-search` 0.16.0 is part of milestone 1 but is **installed with its UI, not before it**: the addon
finds and highlights, the search bar is ours to build, and a dependency with no caller fails the
unused-dependency check. `addon-serialize` is not taken at all — nothing here needs to snapshot a
buffer, and an unused dependency is still a dependency
([ADR-CORE-009](../core-009-dependency-policy.md)).

**Under [ADR-APP-026](../app-026-no-native-ui-primitives.md) the emulator is a *mechanism*, not a
control.** It draws a character grid whose entire appearance — palette, font, cursor shape, selection
colour — comes from our theme; that is the feature, not a compromise. What must never escape it is
chrome: the tab bar, the context menu, the scrollbar, the search UI. Therefore:

- every `@xterm/*` package is classified `primitiveOnly` in `ui-boundary.json`, so ESLint refuses an
  import from anywhere but `src/components/ui/**` — the gate, not a review habit;
- the wrapper `src/components/ui/TerminalSurface.tsx` is the **only** file that names xterm;
- xterm's own scrollbar is suppressed and replaced; selection and cursor colours come from
  `PALETTE` ([rule:theming](../../../.claude/rules/theming.md)).

### 2. The PTY is `portable-pty`, behind exactly one module

`portable-pty` 0.9.0 (MIT). `src-tauri/src/terminal/pty.rs` is the **only** file in the repository
permitted to name `portable_pty`. Everything above it speaks our own types (`SessionId`, `PtySize`,
`SessionExit`). This is not decoration — it is what makes the choice reversible: if the crate has to
go, it costs one file (~150 lines of `rustix` on Unix), not a rewrite
([ADR-CORE-005](../core-005-reusability-policy.md)).

**Three named tripwires** force a re-evaluation. They exist so "we'll revisit it" is a commitment and
not a feeling:

1. we need a capability the crate does not expose;
2. a fix we need sits in wezterm's git for more than ~6 months without a crates.io release;
3. RUSTSEC publishes an advisory for the crate.

Tripwire 2 has **already fired once**: `pty: windows: fix kill()` (wezterm, 2026-06-07) is in git and
not in 0.9.0. It concerns Windows, so it does not bite us today — but the latency is demonstrated, not
hypothetical, and that is why the tripwire is written down.

### 3. The transport is a Tauri Channel, and the backend **must** coalesce

One `Channel<TerminalChunk>` per session, in the direction PTY → webview. It stays inside the existing
IPC model: no local port, no CSP exception, no new capability
([ADR-CORE-011](../core-011-security-by-design.md)).

**Coalescing is binding, not an optimisation.** The measurement: 66.7 MB of PTY output arrived in
**68 267 reads, averaging 1023 bytes each** — the reader gets roughly one kilobyte at a time. Forwarded
naively that is 68 000 IPC messages for a single `cat`. The reader thread therefore accumulates and
emits one message per **~8 ms or 64 KiB, whichever comes first** (8 ms ≈ half a 60 Hz frame). Those two
numbers are starting values and are to be re-tuned against a measurement during implementation; the
*requirement* to coalesce is not negotiable.

Input (keystrokes, paste) travels the opposite way as an ordinary typed command — small, sporadic, no
batching.

### 4. The backend owns sessions; the frontend owns only the view

- Rust holds a registry of live sessions keyed by a monotonic `SessionId` (a `u64` — no UUID
  dependency for something that never leaves the process).
- The command surface, thin as always ([rule:rust-conventions](../../../.claude/rules/rust-conventions.md)):
  `terminal_open` → `SessionId`, `terminal_write`, `terminal_resize`, `terminal_close`. All DTOs derive
  `ts-rs::TS`; the frontend imports the generated types and never re-declares them.
- Tab order, the active tab and per-tab UI state live in Zustand; the running session does not
  ([rule:frontend-architecture](../../../.claude/rules/frontend-architecture.md)). Server state is never
  duplicated into the store.
- **Closing a tab kills the process group, not just the shell.** `portable_pty` exposes the foreground
  process group leader (`tcgetpgrp`, `unix.rs:374`) and the child PID (`Child::process_id`), so on
  `cfg(unix)` a close sends `SIGHUP`/`SIGKILL` to the group. This is what makes Ctrl-C and "close tab"
  end the whole tool tree under an AI harness instead of orphaning it. On Windows the crate's `kill()`
  is used as-is.
- The reader thread is a background task and therefore an entry point: it gets an entry in
  `crash-boundaries.json` stating **how it dies** ([ADR-APP-032](../app-032-crash-handling-mechanism.md)).
  It ends on EOF from the PTY, logs the session's exit status, and closes the Channel. It never ends
  quietly.

### 5. Threat model — the frontend must not be able to choose what runs

A terminal executes arbitrary code as the user; that is its purpose and not a vulnerability. The trust
boundary is a different one: **the webview must not be able to make the backend spawn something the user
did not ask for.**

- `terminal_open` takes a **configuration reference**, never an arbitrary command line. The program is
  resolved in the backend from configuration (`$SHELL`, or the platform default), not from a string the
  frontend supplies.
- A supplied working directory is canonicalised and must be an existing directory; anything else is
  rejected at the boundary ([rule:security](../../../.claude/rules/security.md)).
- **A supplied tmux session name is bounded by `tmux::may_name`.** Two ways to qualify, and nothing
  else: the name belongs to the tab's own series (`base`, `base-2`, …), or the tmux server actually has
  it. Anything else is refused and the tab is numbered instead — a stale name is never a reason to fail
  to open a terminal.

  This does not widen *what runs*: attaching joins a session the user already started, and creating one
  runs the configured shell either way. It is nonetheless **wider than the first version of this rule**,
  which allowed the series alone, and the reason is worth stating rather than leaving as a diff.

  The series alone was right while the only legitimate caller was a *restored tab* handing back a name
  this backend had minted for it. Attaching to an arbitrary session was then, correctly, something no
  frontend needed to be able to ask for. That changed when attaching became a **feature**: a new tab is
  now given a session nobody is using, so reaching one that outlived its tab has to be something the
  user can ask for — the picker in the title bar, filled by `tmux_sessions`, which is this same backend
  producing the list. The frontend still cannot invent a target: an invalid name is refused before the
  existence question is even asked, so it can never address a window or pane inside something else.

  The tighter design — the backend minting an opaque handle per listed session and accepting only
  handles — was considered and not built. It would defend against a webview naming a session the user
  never saw; that webview can already type into every session the app has open (`terminal_write`), so
  the machinery would raise the nominal floor and not the real one (ADR-CORE-039 on defensible, not
  maximal-literal).

  **Why any of this exists.** tmux's survival was true but unreachable. Its sessions live through a
  crash on their own; a tab that returned merely *numbered* — the backend counted the tabs already open
  — landed wherever its position put it. Close one tab before the crash and the numbering has shifted:
  the tab opens somebody else's session while the one holding the build runs on with nothing in the
  interface pointing at it.

  Pinned by `a_name_is_allowed_when_it_is_ours_or_when_it_really_exists` and
  `a_name_that_addresses_something_else_is_refused_even_if_tmux_answers_for_it`.

- **Opening a tab and attaching to a session are separate acts, and the interface says so.** They used
  to be one: `new-session -A` attaches when the name exists, and the numbering consulted only this
  app's open tabs — so a name free here could be occupied in tmux, and pressing `+` after closing
  yesterday's tabs dropped the user straight back into yesterday's session. Nobody decided that; it fell
  out of positional naming. `first_free` now skips what the tmux server holds as well, so a new terminal
  is new, and the picker is where you go when you want the other thing.

  The cost is explicit: the first tab no longer lands in a session the user already has. That was
  deliberate behaviour and it is now the picker's job.

- **A profile may override the tmux mode** (`TerminalProfile::tmux`). A global setting cannot express a
  workspace where some tabs use tmux and some do not — something has to choose per tab, and the profile
  is where every other per-tab override already lives. `None` means "use the Settings default", so a
  profile stored before this field existed behaves exactly as it did. It is still a *reference* the
  backend resolves; the webview names a profile, never a mode. A detach (`plain`) outranks it, because
  a profile that could undo a detach would mean the tab silently rejoined the session the user just
  left.
- The child inherits a curated environment. No secret is ever placed in it.
- Both PTY file descriptors are `CLOEXEC` (the crate does this — `unix.rs:64-65`), so nothing leaks into
  the child.

### 6. PTY content is never logged

Every session logs its **lifecycle** — opened (with the resolved program), resized, exited (with the
status), bytes transferred — and every error with context. It logs **no byte of terminal content, in any
direction**: that is user content and routinely contains credentials
([rule:logging](../../../.claude/rules/logging.md), [ADR-CORE-011](../core-011-security-by-design.md)).
A debug flag that would dump PTY traffic is not to be added.

### 7. Milestone 1 — and what is explicitly outside it

**In:** multiple independent tabs; full VT/ANSI handling, Unicode widths, mouse reporting, bracketed
paste, scrollback, search, copy/paste, resize with reflow, link detection; a HUD context menu; the
process-group kill above.

**Out, by decision and not by omission:** split panes; session persistence across restarts; iTerm2
theme import; the theme editor; granular per-terminal configuration. Each is its own milestone with its
own ADR if it needs one. One finished thing beats three half ones
([ADR-CORE-002](../core-002-best-solution-principle.md)).

**New HUD primitives this milestone must build**, with tests, because `src/components/ui/` has only
`Button`, `HudPanel`, `IconButton`, `TextField` and `Tooltip` today: `Tabs`, `ContextMenu`,
`TerminalSurface`. This is real work and it is named here so it is not discovered as a surprise.

## Alternatives

**Write the emulator ourselves.** Rejected. VT sequences, Unicode widths, bracketed paste, mouse
reporting, IME, reflow-on-resize are years of detail work, and they are the part that does **not**
differentiate this product. It also directly contradicts the requirement that the terminal not be
reduced.

**Emulate in Rust with `alacritty_terminal` 0.26.0 (Apache-2.0) and render the grid ourselves.** Full
control of the presentation and no UI dependency — but it buys a hand-written renderer including font
metrics, selection and IME, which is a large new surface of our own bugs in exchange for removing
someone else's tested one.

**`pty-process` 0.5.3 instead of `portable-pty`.** Attractive on paper: a fresher release (2025-07-12)
and **2 new crates instead of 9** (`rustix` is already in the tree), both measured by adding each crate
to `Cargo.lock` in turn. Rejected on a hard fact: it is **Unix-only**. `src/sys.rs` uses
`std::os::fd` and `rustix::pty::openpt/grantpt` with no `cfg(windows)` branch anywhere, the source
contains no Windows path at all, and docs.rs builds it only for darwin and linux. Windows parity is
required ([rule:cross-platform](../../../.claude/rules/cross-platform.md)), so this is disqualifying
rather than a trade-off.

**Hand-rolled PTY layer.** The Unix half is genuinely small. The reasons against are that it is not on
the differentiating path, and that the subtle parts — `setsid`, `TIOCSCTTY`, `CLOEXEC`, controlling-
terminal acquisition — fail in ways no test catches and one of those failure modes (a descriptor
inherited by a child) is a security defect by our own rules. `portable-pty` already does all three
correctly (`unix.rs:64,257,271`). Encapsulation (§2) gives us the exit without paying the entry.

**Tauri events instead of a Channel.** Every event crosses the global bus and is JSON-serialised; with
~1 KB arriving per read that is the bottleneck by construction.

**A local WebSocket.** Highest throughput and free backpressure, at the cost of an open local port, its
own authentication model and a CSP exception — a materially larger attack surface for a problem the
Channel solves.

**Drop Windows to simplify.** Considered and rejected. It buys **no** performance: `portable-pty`'s
Windows code is behind `[target."cfg(windows)"]` and is not compiled on macOS or Linux — the 203.7 MB/s
below was measured on the Unix path already. The one genuine gain, POSIX process-group semantics, is
available **with** Windows in the tree via `cfg(unix)` on the raw fd (§4). What remained was 7 fewer
crates in the lock, against declining two pinned app-layer decisions
([ADR-APP-001](../app-001-tauri-rust-react-stack.md), rule:cross-platform) and opting
`.github/workflows/release.yml` out of the pin — which would forfeit every future upstream fix to the
release pipeline ([ADR-CORE-033](../core-033-governance-layers-cascade.md)). The price is permanent; the
gain is not.

## Consequences

**Measured, on macOS, release build, `portable-pty` 0.9.0:**

```
bytes read : 69905070 (66.7 MB)
reads      : 68267 (avg 1023 B/read)
elapsed    : 0.327 s
throughput : 203.7 MB/s
exit       : ExitStatus { code: 0, signal: None }
kill       : ExitStatus { code: 1, signal: Some("Hangup: 1") } after 55.039583ms
```

Resize while the child was running behaved correctly. Throughput is not the constraint; the IPC message
*rate* is, which is why §3 exists.

**Supply chain.** `portable-pty` adds 9 crates (`cfg_aliases`, `downcast-rs`, `filedescriptor`, `nix`,
`portable-pty`, `serial2`, `shared_library`, `shell-words`, `winreg`; +94 lines of lockfile). Verified
against our own gate, not in the abstract: `cargo deny` reports *advisories ok, bans ok, licenses ok,
sources ok*, and `cargo audit` stays at the pre-existing 17 allowed warnings — **no new advisory**. Some
of the Windows-side transitive crates are old (`winapi 0.3`, `lazy_static 1.4`, `shared_library 0.1`);
they are transitive, `deny.toml` enforces `unmaintained` for workspace and direct dependencies only, and
this is recorded here rather than left to be re-discovered.

**Maintenance.** The crate is maintained in the wezterm monorepo — most recent commit touching it
2026-06-07 — and carries no RUSTSEC advisory. The risk is release latency, not abandonment, and the
tripwires in §2 are how that risk is held.

**Cost this milestone takes on:** three new HUD primitives with tests, one new UI dependency family
behind the boundary lint, one background thread per session with its `crash-boundaries.json` entry, and
a new IPC surface pinned by contract tests on both sides
([ADR-CORE-010](../core-010-testing-strategy.md)).

**Windows.** It stays supported and stays in the release matrix. Milestone 1 is behaviour-verified on
macOS and Linux; the Windows build is compile-verified by the release matrix, and its behavioural
verification is owed before anything is called finished on that platform.

## References

- [ADR-APP-001](../app-001-tauri-rust-react-stack.md) — the stack this sits in
- [ADR-APP-020](../app-020-hud-design-system.md), [ADR-APP-026](../app-026-no-native-ui-primitives.md) — the design system and the ban on stock UI
- [ADR-APP-025](../app-025-logging-architecture.md) — where the session logs go
- [ADR-APP-032](../app-032-crash-handling-mechanism.md) — why the reader thread needs a `crash-boundaries.json` entry
- [ADR-CORE-005](../core-005-reusability-policy.md), [ADR-CORE-009](../core-009-dependency-policy.md), [ADR-CORE-010](../core-010-testing-strategy.md), [ADR-CORE-011](../core-011-security-by-design.md)
- `mem:project-scope` — what YggShell is and what is agreed
