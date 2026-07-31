# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (ADR-CORE-024).

## [Unreleased]

### Added

- **Maximum defensible security posture on this stack** (ADR-APP-033, implementing core ADR-CORE-039 pulled
  from `althing` v0.9.0; briefings `core-010-…` / `app-106-maximum-defensible-posture.md`). The gate ran a
  solid floor (cargo-audit, cargo-deny, secretlint, eslint-plugin-security, clippy `-D warnings`, tsc
  `--strict`), but nothing turned the toolchain up to its ceiling or recorded what was left off. Now
  `security-posture.json` (project-owned) is the SSOT of the posture — every defensible safety `enabled`
  (wired into `check:all`) or `deferred` with a reason — and `scripts/lib/security-posture-gate.mjs`, loaded
  from `eslint.config.mjs`, holds it: a scanner unplugged from `check:all`, a deferral with no reason, a
  weakened `--max-warnings 0`/`-D warnings`, or a vanished category all fail `npm run lint`. Turned on in
  this change (each verified green): JS dependency advisory scan (`npm audit --omit=dev --audit-level=high`
  as `security:audit-js`), `clippy::undocumented_unsafe_blocks = "deny"` (+ the one missing `// SAFETY`
  comment on `ShellExecuteW`), `[profile.release] overflow-checks = true`, and `noUncheckedIndexedAccess`.
  Deferred **on the record** with rationale: cargo-vet, semgrep, CodeQL, gitleaks/history, SBOM, cargo-fuzz.
- **Exact Cargo pins + linker hardening enabled** (ADR-APP-033). Two safeties previously deferred are now
  on: every direct dependency in `src-tauri/Cargo.toml` carries an exact `=` requirement matching the
  committed `Cargo.lock` — which also corrected a latent manifest/lock drift **upward** (`tauri` said
  `2.11.2` while the lock had tested `2.11.5`; the pins snap to the tested version, never a downgrade), so a
  `cargo update` can no longer move a direct dep silently. And `.cargo/config.toml` adds Windows Control
  Flow Guard + Linux full RELRO/BIND_NOW (macOS at toolchain default). The posture gate now verifies both
  directly. Verified: a `--locked` build leaves `Cargo.lock` unchanged and links green on Windows.

### Fixed

- **Memory triggers are read for the first time** (pulled from `althing` v0.8.1; briefing
  `docs/migrations/core-009-memory-is-resolvable.md`). The core's gate has always demanded `triggers` or
  `applies-to` on a `load: conditional` memory entry — but `scripts/context-for.mjs` reported ADRs and rules
  only and loaded memory solely to resolve supersessions, and `MEMORY.md` printed title + tldr. This layer's
  one conditional entry, `mem:open-work-backlog`, therefore carried fourteen triggers that **nothing in the
  system read**. It now resolves like any other document:

  ```
  $ node scripts/context-for.mjs "backlog"
    .claude/memory/open-work-backlog.md  (trigger:backlog)  — Backlog: no macOS signing secrets …
  $ node scripts/context-for.mjs "logging"
    (open-work-backlog.md correctly absent)
  ```

  `MEMORY.md` additionally prints `· triggers: … · applies-to: …` on that entry, so the boot indexes alone
  show what pulls it in. Core memory entries are unchanged — they are loaded unconditionally.

  **For a fork:** if you keep conditional memory, verify each entry actually surfaces with the keywords a
  future agent would type. Until now nobody could find out whether those triggers were any good.

### Changed

- **Migration briefings carry their layer in the filename** (`ADR-CORE-038`, pulled from `althing`; briefing
  `docs/migrations/core-008-layered-briefing-names.md`). A briefing has no front-matter and no id, so its
  **filename is its identifier** — and it is the one thing two layers can collide on. The old defence was a
  number range (core `001–099`, app `100–199`) written in prose in a README that no gate ever read, and that
  an agent in the app layer would never see: it opens `docs/migrations/`, finds the core's briefings ending
  at `007-…`, and takes `008-…` as the next free number. The collision then surfaces in a **consumer's**
  repo, where it aborts `governance:update` entirely.

  This layer's five briefings were renamed, **numbers kept 1:1** so every old reference still decodes:
  `100-…` → `app-100-…` through `104-…` → `app-104-…`. Every link to them was updated (`ADR-APP-032`, the
  unreleased entries below). A fork's next `governance:update` applies the rename automatically; what it
  must fix itself are its **own** links, and any project briefing of its own now needs a `proj-` prefix.
  Briefing for forks: `docs/migrations/app-105-briefing-names.md`.

  **Numbering is per-prefix from now on:** this layer's next briefing is `app-106`, whatever the core is up
  to. Never take the next number off the `docs/migrations/` listing — it holds every layer's files.

### Added

- **`ADR-APP-032` — no entry point of this shell dies silently** (executes `ADR-CORE-037`, pulled from
  `althing` v0.7.0). The core states the obligation — *a crash is permitted, a silent crash is not* — and
  states that it **cannot** enforce it: it does not know what an entry point is on this stack. This layer
  does, so the mechanism **and the gate** land here.

  The shell was a textbook case. `main.rs` builds with `windows_subsystem = "windows"` (no console in a
  release build), `lib.rs` ended the Tauri builder with `.expect(..)`, and the webview — a **second
  runtime**, invisible to any Rust panic hook — had no error boundary, no `window.onerror` and no way to
  write to the log at all. A failure to resolve the app data dir therefore produced **no window, no log
  line and no file**: the user's entire bug report was "it did not start".

  Now: the panic hook is installed **before** the Tauri builder (a panic during setup happens before
  logging exists); the crash report is written **synchronously** to `<app-data>/crashes/` — never through
  `tracing_appender`'s non-blocking writer, whose buffer dies with a `process::exit` that runs no
  destructors — and `logging::flush()` drops the guard so the log file gets its last records too; the user
  is told via a native message box that needs **no Tauri event loop** (`MessageBoxW` / `osascript` /
  `zenity`, no new dependency); the process exits with a defined code (`EXIT_PANIC` / `EXIT_STARTUP` /
  `EXIT_UI_CRASH`); and a `pending` marker makes the next launch show a `CrashNotice` — the backstop for a
  crash that happened before there was a window to report into.

  In the UI: `CrashBoundary` catches a render throw, reports it over IPC and **stops** (no `reset()`, no
  "try again" — resuming a tree nobody can vouch for is the swallowed error ADR-CORE-037 forbids), while
  `installGlobalCrashHandlers` covers what a boundary structurally cannot see (event handlers, timers,
  unhandled rejections). `FatalScreen` names the report's path, because a user who can find the file is a
  user who can send it.

  **Gated, not merely written down:** `scripts/lib/crash-gate.mjs` runs from `eslint.config.mjs` (like the
  UI boundary — `package.json` is project-owned and a consumer could drop a step from `check:all`, while
  `npm run lint` always runs) and fails the build when the panic hook is missing or installed too late,
  when the builder result is `.expect()`ed, when the UI root lacks its handlers or boundary, or when a
  background task is not declared in `crash-boundaries.json` with an answer to *how does this task die?*
  Briefing for forks: `docs/migrations/app-104-crash-handling-mechanism.md`.

### Fixed

- **The log bridge died silently when the UI fell behind.** `lib.rs` bridged `tracing` records to the log
  view with `while let Ok(rec) = rx.recv().await`. A `broadcast` receiver returns `Err(Lagged)` when the
  consumer cannot keep up — which **ended the loop**, killed the bridge and froze the log view for the rest
  of the session, with nothing anywhere saying so. It now warns and keeps bridging on `Lagged`, and ends
  only on `Closed` (`rule:code-quality`, fix on sight).

### Added

- **`rule:challenge-premises` + `ADR-CORE-036` — the agent checks the premise, not only the task**
  (from `althing` v0.6.0). The governance already forbade the agent inventing *facts* (`rule:no-guessing`)
  and inventing *decisions* (`rule:clarify-and-plan`); nothing guarded against it being **agreeable**. A
  wrong premise, executed perfectly, passes every gate in `check:all` and is still the most expensive
  output this governance can produce.

  The rule is `load: core` — deliberately, because the failure mode emits no vocabulary: an agent about to
  agree never searches for a rule about agreeing, so a `conditional` rule here would be one that never
  loads. Core principle #12 and the `CLAUDE.md` index gained their line accordingly.

  An objection is a **finding**, held to ADR-CORE-004 like any other claim (a source, a reproduction, a
  `file:line`); **"no substantive objection" is a complete answer** and is never swapped for a manufactured
  one; and it is raised **once**, before implementing — then the maintainer decides and the decision is
  carried out. Not gate-enforceable, and the ADR says so openly rather than leaving a future agent to
  "fix" the gap with a mandatory counter-argument slot, which would only manufacture the dissent it forbids.

  **Nothing for a consumer to act on** — it arrives with `governance:update` and applies from the next
  boot; hence no migration briefing (ADR-CORE-036 §Consequences).

### Removed

- **`.github/workflows/ci.yml` — the push-/PR-triggered `check:all` workflow is gone** (ADR-CORE-008,
  `rule:automation`, from `althing` v0.5.1; briefing `docs/migrations/app-103-no-push-ci.md`). Verification
  runs **entirely locally** before a push (pre-commit + pre-push), and that is the whole gate. The remote's
  only job is `release.yml`: `v*` tag / manual dispatch, full platform matrix, signing when configured —
  **unchanged**.

  A consumer's next `governance:update` deletes its `ci.yml` too. A project that opted the path out owns
  the file and must delete it itself.

  **The cost, stated:** a break that only appears on Linux or macOS is not caught until release time. That
  is accepted, and a future agent must not "fix" it by re-adding a pipeline — if the local gate misses
  something, strengthen the local gate. **A platform-specific dependency belongs to the layer that has the
  platform:** the audio backend that surfaced this (a Linux-only `libasound2-dev` for one consumer's audio
  crate) is **not** a Tauri requirement and does **not** go into this template's release workflow, where it
  would be installed for every consumer that has no audio.

### Changed

- `ADR-APP-023` no longer claims the quality gate "runs separately in `ci.yml`" — there is no `ci.yml`.
  `release.yml` is now the only workflow, and the accepted cost (a cross-platform break surfaces there, at
  release time) is recorded in it.

### Fixed

- **The devDependency bypass in the UI boundary is closed** (ADR-APP-026; briefing
  `docs/migrations/app-102-devdependency-bypass-closed.md`). The boundary gate classified `dependencies`, so
  a UI kit installed as a **devDependency** was invisible to the completeness check, never landed in
  `primitiveOnly`, got no `no-restricted-imports` pattern — and a view could import it with `check:all`
  green. The bundler resolves out of `node_modules` regardless of which manifest section a package sits
  in. Briefing 101 forbade this, but in prose — which is the half that rots, and is the exact failure the
  boundary commit was written to end.

  `import-x/no-extraneous-dependencies` (`devDependencies: false` on `src/**`) now rejects both a
  devDependency and an undeclared, transitively-present package in production code. Together with the
  classification, the loop closes by construction: **every package a view can reach is a `dependencies`
  entry, and every `dependencies` entry must be classified.** Tests stay exempt — a test is not shipped
  UI.

  The comment on `dependenciesOf()` asserted the false premise out loud ("the only ones a view could
  import at all"). That was not cosmetics: it is *why* the hole survived. Corrected, and the gate's new
  path is now covered by tests that lint against the real config.

### Changed

- **BREAKING — ADR ids carry their layer** (ADR-CORE-034, from `althing` v0.2.0; briefing
  `docs/migrations/core-004-layered-adr-ids.md`). This repo's seven app-layer ADRs were renamed:
  `ADR-001` → `ADR-APP-001`, and likewise `ADR-APP-020/021/023/025/026/031`; filenames follow
  (`app-026-….md`). The core's ADRs arrived already renamed as `ADR-CORE-*`.

  **The numbers are unchanged** — only prefixed — so every `ADR-026` in the git history stays decodable.
  A citation now says on its face which layer it reaches into, and `governance:check` verifies that an
  ADR's id agrees with the layer that actually owns the file. Number blocks could never do that, and were
  already violated: this repo's app ADRs sat at 001/020/021/023/025/026/031, all inside the core's block.

### Added

- **The library half of ADR-APP-026 is gated now, not just written down** (`ui-boundary.json`,
  `scripts/lib/ui-boundary.mjs`, `eslint.config.mjs`; briefing
  `docs/migrations/app-101-ui-boundary-gate.md`). The rule said a view may never import a component straight
  out of a library — but only the *native* half was ever enforced, so
  `import { Button } from "some-kit"` in the middle of a view passed `check:all` green. A rule the gate
  does not refuse is a comment (rule:knowledge-handover §1), and the half that was only prose is the half
  that would have rotted.

  Every **runtime dependency is now classified** in a project-owned `ui-boundary.json` — `viewSafe`
  (renders nothing the user touches) or `primitiveOnly` (renders UI, importable only from
  `src/components/ui/**`) — and an **unclassified dependency fails the lint run**. That completeness
  check is the design: a denylist of "the UI libraries we install" would fire only if whoever added the
  library also remembered to list it — the same person, in the same commit, who was about to do the wrong
  thing. Now `npm install`-ing a kit stops the build until someone decides what it is, and the decision is
  enforced by `no-restricted-imports`.

  It is enforced **inside the pinned lint config**, not as a new `check:all` step, because `package.json`
  is project-owned and a consumer could simply leave the step out. What the gate cannot do — decide
  *whether* a package renders UI — is stated in the ADR rather than papered over.

### Fixed

- **The UI rule banned component libraries. It never should have** (ADR-APP-026, rule:ui-design,
  rule:stack-tauri; briefing `docs/migrations/app-100-ui-defaults-not-libraries.md`). The rule is about
  *defaults*, not *dependencies*: nothing the user touches may look or behave like a stock element, and
  every control a **view** renders is a HUD primitive from `src/components/ui/` — **whatever it is built
  on**. The primitive layer may sit on a native element *or* on a headless library (behaviour, a11y
  wiring, focus, positioning); what may never escape it is that thing's own appearance. A component
  imported straight from a library into a view is exactly as wrong as a native `<button>` — both are a
  surface nobody aligned to the HUD. A styled/prebuilt kit remains the wrong tool (you fight its skin
  instead of drawing the HUD), but it is a judgement, not a ban.

  The lint gate never banned libraries — only the prose did — so no build behaviour changes. The
  matching over-reach in the portable core (principle 10, which had no business ruling on a project's
  dependencies at all) was fixed in `althing` v0.1.1.

### Changed

- **The governance core moved out into `althing`; this repo now owns the *app* layer** (ADR-CORE-033,
  briefing `docs/migrations/core-003-governance-layers.md`). Governance is no longer two layers but N ordered
  ones (`core` → `app` → `project`). `althing` publishes the stack-agnostic core; this repo **consumes**
  it (read-only here) and **publishes** the Tauri 2 + Rust + React desktop shell — its ADRs (001, 020,
  021, 023, 025, 026, 031), its rules (`rust-conventions`, `theming`, `ui-design`,
  `frontend-architecture`, `cross-platform`, and the new `stack-tauri` / `stack-release`), its lint gates
  and its CI — onward to its own forks. `ivaldi` keeps `saga-rust-template` as its upstream and **must
  never** be repointed at `althing`: it would lose the entire app layer.

  The split was not cosmetic. Pinned "portable core" files were prescribing HUD primitives, `tracing`
  sinks and `Serialize for AppError`; of the fourteen steps in `check:all`, only two were free of a
  stack. `CLAUDE.md` is now agnostic — the stack's quick facts and essential commands live in
  `.claude/rules/stack-tauri.md` (`load: core`, so an agent still meets them at boot).

### Added

- **Layer attribution, derived rather than annotated.** A file's layer follows from the upstream
  manifest, so no path had to move — every consumer's project-owned `package.json` still points at
  `scripts/…` exactly as before. `governance/config.json` declares what this repo owns and publishes;
  a repo without one (a leaf like `ivaldi`) is described correctly by the legacy fallback and needs no
  change at all.
- **Two new gates in `governance:check`.** *Acyclicity*: a lower layer may not cite a higher one —
  checked for markdown links **and** bare `ADR-NNN` / `rule:<slug>` citations, so a core rule can never
  hand a dangling reference to a project that adopts the core alone. *Collision*: two layers may never
  ship the same id.
- **`governance-update.mjs --adopt`** — the one-time step when a repo first takes an upstream. It copies
  and re-attributes every governed file to its owning layer and **never deletes**. Without it, the first
  ordinary update would have deleted this repo's entire app layer, since every app file is by definition
  absent from `althing`'s manifest.

### Fixed

- **The `layers` header grew on every sync and mis-sourced the repo's own layer** (found on the first
  real cascade run, in the `ivaldi` fork). `buildLayers` rebuilt the list from the previous manifest and
  then appended the own layer again, so a leaf ended up with nine entries for two layers, and the own
  layer's `source: null` ("mine") was rewritten to the upstream's slug. Because the acyclicity gate ranks
  layers by their position in that array, the ranks inverted and it began rejecting a project ADR for
  citing the core — the exact opposite of the rule it enforces. Fixed in `althing`; the gate now dedupes
  the ranks itself rather than trusting the array.

- **`rule:versioning` was `rule-versioning`** — the only rule id in the corpus using a hyphen instead of
  the `rule:` prefix that every citation uses, so no reference to it ever resolved. The new dead-citation
  check is what surfaced it.

### Changed

- **Version bumps follow the work, not the release** (ADR-CORE-024, rule:versioning, mem:version-bump-trigger).
  Every landing change now bumps SemVer by its Conventional-Commit type
  (`npm version <x> --no-git-tag-version`, committed together with the code); the release — dating the
  changelog and cutting the `vX.Y.Z` tag — is a separate event that happens **only** on the maintainer's
  explicit instruction and is never inferred from "make a build". The old rule ("never bump per commit;
  the release event closes the version") left a whole product sitting at its initial version, so the
  number said what was last released rather than what the work was. Reported by the `ivaldi` fork.
  "A released tag is final — reopen the next patch at once" is unchanged. Briefing:
  `docs/migrations/core-002-versioning-per-change.md`.

### Fixed

- `npm version` no longer leaves `src-tauri/Cargo.lock` behind. `scripts/sync-version.mjs` now writes the
  crate's own `[[package]]` entry in the lock as well as `[package] version` in `Cargo.toml`, stages what
  it wrote during npm's `version` lifecycle, and `version:check` (in `check:all`) fails on drift in either
  file. A bumped manifest with a stale lock broke every `--locked` Rust step ("cannot update the lock file
  … because `--locked` was passed") — once per release before, and once per change under the new bump
  policy. Fix lives in the pinned core, so `governance:update` carries it into every fork; the
  project-owned `version` hook in `package.json` needs no cargo call (see the briefing).
- Release workflow: the GitHub release title is derived at CI runtime from the app-identity SSOT
  (`productName` in `tauri.conf.json`, ADR-APP-031) instead of a hardcoded placeholder, so every fork's
  release is titled with its own app name without editing the pinned, template-owned `release.yml`
  (ADR-CORE-030, ADR-APP-023).
- Bootstrap: `/bootstrap` no longer leaves a dead link in the pinned `CLAUDE.md`. The
  "new project from this template" pointer moved from `CLAUDE.md` to `README.md`, so removing the howto
  during bootstrap keeps the `governance:check` dead-link gate green.

- `governance:update` **refuses to run on a dirty working tree** and, when the gate fails after the core
  was written, prints both ways out (finish the fix, or roll back with `git checkout -- . && git clean -fd`).
  The update rewrites files and then verifies — it is not atomic, and a half-updated tree without
  instructions is how a project ends up in an unknown state. Verified against a real fork, where the new
  reachability gate legitimately failed on pre-existing untriggered memories.
- **`scripts/project/` is reserved for a project's own tooling** — excluded from the pinned core, never
  touched by `governance:update`, and a `knip` entry point. Previously a project script under the
  template-owned `scripts/` survived only by luck and would be silently overwritten the day the template
  shipped a script of the same name (ADR-CORE-032).
- `governance:update` now **self-updates**: it refreshes `scripts/` from the template and re-executes
  with the fresh logic before touching anything else. A fork otherwise runs its own, outdated copy of
  the update logic while downloading the new one, so a fix to that logic could never reach the update
  that delivers it (ADR-CORE-030). Projects created before this change must pull `scripts/` by hand once —
  see `docs/migrations/core-001-config-layering.md` §0.
- `governance:update` no longer deletes a core path that the template merely **unpinned**. Leaving the
  manifest is not the same as being deleted: a reclassified path (ADR-CORE-032 did this to `tsconfig*`,
  `vite.config.ts`, `.prettierignore`) is now *released* to the project layer — the fork keeps its own
  file, edits and all, and the update reports it. Previously the first update after the
  reclassification would have destroyed a fork's build and TypeScript config.
- Drift-gate: the fork error message no longer advertises an opt-out that did not exist. It now names
  only real escapes — project overlay, upstream, or `governance/opt-out.json` — and how to restore a
  pinned file (ADR-CORE-032).
- Governance vs. `rule:dependencies` contradiction: a "recorded, time-boxed" advisory exception and a
  new dependency licence both live in the pinned `src-tauri/deny.toml`, which the drift-gate rejected.
  They are now possible via an explicit, printed opt-out (ADR-CORE-032).

### Added

- **Migration briefings (`docs/migrations/`)** — one pinned, portable document per core change a project
  must act on, written for the agent working in a fork (what changed, what to do, what is now
  forbidden). `governance:update` delivers them and prints the ones it changed; `CLAUDE.md` points at
  the folder. First briefing: `001-config-layering.md` (rule:knowledge-handover).
- **Config layering (ADR-CORE-032).** Project-specific tooling config no longer requires editing the pinned
  core: `eslint.config.mjs` merges an optional project-owned `eslint.config.project.mjs`, and the new
  core `knip.config.js` (replacing `knip.json`) merges an optional `knip.project.json`. A fork can set
  its own knip ignores / lint rules with `check:all` staying green, and `governance:update` never
  overwrites them.
- **Shadow guard**: `governance:check` now rejects a config file that would silently override a pinned
  core config (`knip.json`/`knip.ts`/… over `knip.config.js`, `eslint.config.js` over
  `eslint.config.mjs`) — the tool resolves those first, so the core would be bypassed with its hash
  still intact. The error points at the right overlay (ADR-CORE-032).
- **Explicit core opt-out**: `governance/opt-out.json` (`{"paths": [...]}`) takes a core path out of the
  hash pin — validated (core paths only, forks only), skipped by the drift-gate, never overwritten,
  deleted or re-pinned by `governance:update`, and printed on every run so the divergence is visible.
- Tests for the governance core (`scripts/lib/governance-core.test.mjs`): the drift-gate, the opt-out
  and the upstream update now run against a temp repo — the gate that guards every commit was untested.

### Changed

- `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts` and `.prettierignore` are project-owned and
  no longer hash-pinned — they describe the project's own shape, not the template's governance
  (ADR-CORE-032). The pinned core keeps `eslint.config.mjs`, `knip.config.js`, `CLAUDE.md`, the husky hooks,
  commitlint, secretlint, lint-staged, Prettier config, editorconfig, gitattributes and `deny.toml`.
- Governance policy moved into `scripts/lib/governance-core.mjs` (pure, root-parameterised, tested);
  `governance-manifest.mjs` and `governance-update.mjs` are now thin CLIs over it.
- `CLAUDE.md` is now fully portable: it is pinned core and therefore carries only template-wide facts.
  Project state (purpose, what exists, what does not) lives in the project-owned
  `.claude/memory/project-scope.md` (`load: core`, read at boot), so a fork describes itself without
  drifting the pinned governance entry point (ADR-CORE-032).
- Genericised the template placeholder app name in pinned core governance examples
  (`.claude/memory/repo-is-memory-home.md`, ADR-CORE-024, ADR-CORE-030) so forks no longer inherit
  `saga-rust-template` in illustrative text.

## [0.1.0] — 2026-07-11

Initial shell.

### Added

- Tauri 2 desktop shell: frameless transparent HUD window with custom title bar, sidebar navigation
  rail, status bar, About dialog, tray icon with close-to-tray, and persisted window geometry.
- HUD design system (ADR-APP-020): palette, chamfered panels and buttons, Inter / JetBrains Mono /
  Orbitron.
- Typed IPC surface with `ts-rs`-generated TypeScript bindings: `app_version`, `build_info`,
  `get_recent_logs`, `get_settings`, `update_settings`, `open_external`.
- Structured logging (ADR-APP-025): console, rotating JSON file, in-memory ring buffer streamed live into
  the Logs view.
- Settings persisted as an atomically written JSON document under the OS app-data directory; UI scale
  applied to the native WebView zoom.
- Governance: ADRs, rule packs, repo-resident memory, generated and hash-checked indexes.
- Quality pipeline `check:all`: typecheck, ESLint, Prettier, Vitest, knip, secretlint, rustfmt,
  Clippy, Rust tests, cargo-deny, cargo-audit, plus husky pre-commit hooks and Conventional Commits.
