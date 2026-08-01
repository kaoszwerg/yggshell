---
id: mem:open-work-backlog
title: Open follow-up work on YggShell
tldr: "Traps this repo already paid for — hud-panel beats `absolute`, flat config REPLACES rule options — plus the live backlog and its measurements."
scope: project
load: conditional
triggers:
  [
    backlog,
    open,
    performance,
    slow,
    sluggish,
    latency,
    cpu,
    gpu,
    profiling,
    benchmark,
    footprint,
    repaint,
    render,
    rendering,
    xterm,
    coalescer,
    throughput,
    follow-up,
    todo,
    gap,
    defect,
    bug,
    handover,
    resume,
    signing,
    notarisation,
    release,
    scope,
    next,
    tmux,
    osc7,
    history,
    screenshot,
    upstream,
    css,
    layer,
    tailwind,
    position,
    absolute,
    overlay,
    panel,
    tooltip,
    popover,
    clip,
    clip-path,
    chamfer,
    nowrap,
    wrap,
    truncate,
    ellipsis,
    eslint,
    lint,
    gate,
    flat-config,
    no-restricted-syntax,
    diff,
    xterm,
    theme,
    itermcolors,
    profile,
    path,
    which,
    claude,
    zshrc,
    zprofile,
    login-shell,
    interactive,
    environment,
    not-found,
  ]
applies-to:
  [
    ".github/workflows/**",
    "app.identity.json",
    ".claude/memory/**",
    "governance/**",
    "src-tauri/src/terminal/**",
    "src/**",
    "eslint.config.project.mjs",
    "scripts/project/**",
    "PLAN.md",
  ]
type: project
---

# Open work

**Read this before re-diagnosing anything.** Every entry below was measured, not guessed; repeating
the measurement costs an hour that has already been spent. `PLAN.md` holds the feature roadmap — this
holds defects, their evidence, and the traps around them.

## Closed — but read the measurement before you touch it again

Both of these were re-diagnosed once already because the note here said something the measurement
later contradicted. The measurements are kept so the next agent does not pay for them twice.

- **OSC 7 inside tmux — closed, and the approach that shipped is not the one written down here
  before.** The DCS-passthrough hook was measured and it does not work: an end-to-end probe counted
  **0** OSC 7 sequences and **0** passthrough DCS reaching the outer terminal, with and without
  `-e ZDOTDIR=…` on `new-session` (tmux panes inherit the *server's* environment, and `ZDOTDIR` is
  not in `update-environment`). What works is asking tmux — `display-message -p '#{pane_current_path}'`
  — which the same probe showed answering correctly. So inside tmux the frontend polls `terminal_cwd`
  every 2 s and **no shell integration is installed at all**. Do not re-attempt the passthrough.
- **The `%` at the top of a fresh terminal — closed.** It was ours, and it was a race, not the shell
  integration: it appeared with and without the hook. zsh's mark is `%` + (`COLUMNS`-1) spaces + CR +
  `ESC[K`, which erases itself when the shell and the emulator agree on the width. A measurement that
  landed while `terminal_open` was still in flight used to be **dropped** (`if (opening.current)
  return`), so the shell drew for a stale, wider window, the spaces wrapped, and the erase cleared the
  second line. `TerminalView` now parks that geometry and applies it when the session id arrives, and
  has tests. Measurements behind it, so nobody repeats them: `$COLUMNS`/`stty size` match the spawn
  size exactly (the column-mismatch-at-spawn theory in this file was wrong); xterm.js fed zsh's exact
  bytes leaves `%` at 80 real vs. 100 believed columns and nothing at 100 vs. 100.
## Round 6 — DELIVERED to the upstream (2026-08-01). Ball is in their court.

**The maintainer sent the report.** Nothing is owed from here; do not re-run the harness unless the
upstream asks for something specific. What went out, in one line each — the numbers are below in full:

- `ring-clip` is a **regression** (27.2 % vs 9.9 % for `current`), measured. Drop it as a candidate.
- `transform-spin` costs **nothing measurable**, including the memory they worried about — GPU 44 MB
  and WebContent 40 MB, byte-identical to the control. Their one documented objection does not
  materialise on WebKit/macOS. WebKitGTK stays untested.
- **No cadence band reads as stutter**, and the `steps(n)` travel arithmetic measures the wrong
  quantity: five stops across 360° means one 6° step is 6.7 % of a colour transition.

**What we are waiting for:** their decision on `transform-spin`, and — per their §7 — a
`docs/migrations/app-NNN-….md` briefing, because `src/**` is outside the published layer and the fix
will NOT arrive via `governance:update`. It has to be ported by hand here. We ship `steps(60)` until
then, which measured at +0.1 points over control and which the maintainer confirms looks normal.

### Round 6 — the measurement, for reference

**The template is waiting on us.** `kaoszwerg/saga-rust-template@a9cb0f5` confirmed the *mechanism*
(164.7 repaint triggers/s, one per frame) but could not measure the *cost*: five attempts on
Blink/Windows produced a noise floor larger than the effect — the control variant, animation off, sat
at **58 % GPU**. So it shipped an A/B harness instead of a guess and asks the reporter (us) for the
figures from WebKit/macOS, where it reproduces. `src/styles/globals.css` upstream is unchanged: **no
fix ships there until our numbers are in.**

**Harness:** `docs/perf/window-frame/index.html` in that repo — one self-contained file, no build.
Open it in **Safari** (or the app's own WebView, which is the most faithful). Variants: `current`,
`steps-60`, `steps-180`, `ring-clip`, `transform-spin`, `off`. Buttons: *Measure all variants*, then
*Solo 20 s* **per variant** reading CPU **and memory** from Activity Monitor, then *Copy report block*.
`?autorun` drives the sweep from a headless browser. The window must stay foregrounded and visible —
an occluded window stops getting animation frames.

**Three upstream findings that correct our own report — do not repeat the mistakes:**

1. **Our suggestion 2 was wrong.** `mask`/`clip-path` on `.window-frame` applies to the element *and
   its descendants*, and that element is the container the whole app renders inside — it would have
   erased the UI, not the covered gradient. That is why the harness puts the gradient on a dedicated
   `.glow` element instead.
2. **A ring clip does not lower the trigger rate** (still 165/s) and may be a regression: our own
   `sample` pointed at clip decomposition, and a 16-point even-odd ring is more of that, not less.
3. **No `steps(n)` is visually free.** A colour-stop boundary travels ~56–150 px per step at
   `steps(60)` on 1920×1080, ~19–50 px at `steps(180)`. **We shipped `steps(60)`** — worth checking at
   the window size actually used before defending it.

**Observation the upstream does not have, and it pushes back on their `steps(n)` objection.** They
withdrew `steps(60)` and `steps(180)` as "not visually free", computing that a colour-stop boundary
travels ~56 px at an edge midpoint and >150 px near a corner per step on 1920×1080. Recomputed for this
app's actual default window (1280×832): ~44 px and ~127 px — smaller, still not nothing.

**But the maintainer, running the shipped `steps(60)` build, reports the frame looks completely normal —
no stutter, no visible jump.** The arithmetic measures how far a point of equal colour travels; it does
not measure how *visible* that is. This gradient has **five stops across 360°, i.e. 90° apart**, so one
6° step is **6.7 % of the transition between two adjacent colours** — a colour delta far below what the
eye resolves on a 1.5 px line. The travel figure and the perceptibility are different quantities, and
the objection conflates them. Report this back with the numbers; do not simply concede `steps(n)`.

**Our own measurement, for the report:** 27.7 % → 3.0 % in the WebKit GPU process, same instance, CSS
swapped by hot-reload, idle release build. That is the number the upstream does not have.

**Blocked on a quiet machine, and this is not a formality** — it is the exact reason the upstream's
attempt failed. Before measuring, require: Docker test runs finished, RustDesk closed, **no agent
session running in the measured window**, and `load average` below ~1.5 with WindowServer in single
digits. Recorded at the time of writing: load 5.73, VM 144 %, WindowServer 18.5 % — unusable.

## Performance rounds — measured, and where they stopped (2026-08-01)

**The rounds at a glance** — one line each, details below and in Round 6 above:

| # | What | State |
| --- | --- | --- |
| 1 | Frame paint, polling inventory, blocking-path check | **done**, shipped 0.34.x/0.35.0 |
| 2 | Widget switching | **closed** — a sync Tauri command blocked the main thread; 1562 ms → 27 ms, gated |
| 3 | Terminal rendering | **closed** — idle is 7.8 %; under load the cost is xterm's parser, and the coalescer is not at fault |
| 4 | Measurement-led deep analysis | absorbed into 2, 3 and 5 — nothing left standing on its own |
| 5 | Targeted code audit | **done**, one finding (`launch::Pending`) |
| 6 | The measurement the template was waiting on | **delivered** — awaiting their decision + a migration briefing |

Rounds 3, 4 and 6 all need the same thing — a calm system. Round 6 is the one somebody else is waiting
on, so it goes first when the machine is quiet.

**A resumable state, not a wish list.** Read the numbers before re-measuring anything; each cost
real time. Round 1 landed in 0.34–0.35 and is closed. Rounds 2–4 are open, in priority order agreed
with the maintainer.

**The one methodological trap, and it invalidated a measurement here:** *"idle"* must mean idle. A
baseline taken while a Claude session ran in one of the tabs read **30.5 %** (Rust 5.7 / GPU 13.1 /
WebContent 11.8) — that is a terminal with a running animation, not an idle app, and it answers none
of the questions below. A clean baseline needs a window with **no agent session running in any tab**.

### Round 1 — closed, shipped in 0.34.x/0.35.0

| Finding | Measurement |
| --- | --- |
| `.window-frame` painted the whole window at 60 fps | 27.7 % → **3.0 %** GPU (same instance, CSS hot-swapped) |
| Events file read whole every 3 s, grows forever | O(usage) → constant (tail read) |
| Transcript search bounded by file COUNT | lost against slash-command transcripts → byte budget |
| `docker stats` polling | ~2 s per call → only while the tool is on screen |
| Rust async paths | **0** async commands doing blocking work — the "we built it blocking" premise was wrong |
| Polling inventory | `tmux display-message` 8.9 ms ×2 per 2 s (~0.9 %); `git_snapshot` ~25 ms per 4 s (~0.6 %) |

### Round 2 — CLOSED (2026-08-01). Cause found, fixed, gated.

**The Agent tool's 1.5 s was a missing `async` keyword.** `agent_usage` shells out to
`claude -p /usage`, measured at 1443–1629 ms — and **Tauri runs a synchronous command on the main
thread**. Only `async fn` reaches the async runtime. So the call held the thread that also serves
window events and IPC, and the panel could not paint even though React had finished in ~1 ms.

**Measured, same build, same keystrokes:**

| | click → visible |
| --- | --- |
| before | 1562 / 1591 ms |
| after `async` + `spawn_blocking` | **27 ms** |

Six commands were converted: `agent_usage`, `container_stats` (~2 s, `docker stats`), `git_fetch`
(network-bound), `install_direnv` (a package manager — minutes), `environment_status` and
`set_project_environment` (both spawn `direnv`).

**And it cannot happen again:** `scripts/project/check-blocking-commands.mjs` runs in `check:all` and
fails the build when a `#[tauri::command]` that starts a child process is not `async`. It resolves
spawners at **function** granularity — two earlier versions matched modules and were unusable, flagging
`terminal_resize` and `pending_crash` for calls they do not make. A gate that is wrong half the time
gets switched off (ADR-CORE-039), so the precision is the feature. Ten short commands are allowed by
name, each with the measurement that justifies it.

**Superseded — the measurement that led here:**

**Click-to-visible**, driven by keyboard shortcuts through a dev instance, two passes, `<Profiler>` plus
two nested `requestAnimationFrame`:

| tool | React | click → visible (mount) |
| --- | --- | --- |
| files | 2–4 ms | 27 ms |
| activity | 0–1 ms | 30–62 ms |
| docker | 0–1 ms | 29 ms |
| git | 5 ms | **470 ms** |
| **agent** | 0–1 ms | **1562 / 1591 ms** |

**The Agent tool takes over a second and a half to show anything**, reproducibly. React renders in about
one millisecond, so the time is spent *after* React and *before* the frame — i.e. waiting on the
backend, not on the component tree. Prime suspects, in order: `agent_usage` shells out to the `claude`
CLI, `agent_session` reads a transcript tail, `agent_attention` reads the events file; the Git tool's
470 ms lines up with `git_snapshot` spawning `git`. **Not yet confirmed which** — measure per query
before changing anything.

**The fix direction that is now ruled out:** keeping tools mounted. React was never the cost, so it
would buy nothing and would undo the maintainer's decision that the Docker monitor polls only while
visible. What would help is the ordinary one: render the panel's shell immediately and let each query
fill in as it lands, rather than holding the first paint until the slowest call returns.

**Superseded — the earlier partial finding:**

**Measured with React's `<Profiler>` around `ToolPanel`, dev build, real clicks through all five
tools:**

| tool | React render |
| --- | --- |
| git | 0–2 ms |
| files | 2 ms |
| docker | 0–3 ms |
| agent | 0–1 ms |
| activity | 0 ms |

**0–3 ms, in the DEV build**, which is markedly slower than release. Rebuilding the component tree is
therefore **not** what makes a tool switch feel slow. This kills the obvious fix before anyone builds
it: keeping tools mounted (as `TerminalView.tsx:501` does for panes) would cost effort, would undo the
maintainer's decision that the Docker monitor polls only while visible, and would buy **nothing**.

**Two candidates remain, neither measured:**

1. **Waiting for data.** Proven for one: opening Docker starts `container_stats`, which takes ~2 s —
   the list is instant from cache, the bars arrive two seconds later. Files and Git unmeasured.
2. **Layout, paint and compositing after React.** The profiler stops when React is done; nothing is on
   screen yet. The HUD uses `clip-path` and glow shadows, and the GPU process is already busy with the
   terminal. **This is the next thing to measure** — instrument with two nested
   `requestAnimationFrame` calls inside `onRender` to get click-to-visible rather than click-to-React.

**The measurement trap that ended this round, and it will happen again:** the machine was under load
from Docker tests run by another agent — the VM alone at **188 % CPU**, and **WindowServer at 11.9 %**.
WindowServer is the system compositor every window goes through, so the *whole desktop* was sluggish,
not the app. Any number taken then is unreproducible. **Check `uptime` and the top consumers before
trusting a UI-latency measurement**, and say so in the result.

### Round 2b — original framing, kept for context

**What is established:** every tool is unmounted and rebuilt on switch — `ToolPanel` renders
`activeTool === "git" ? <GitTool/> : null`. The **terminals do it the other way** and are fast:
`TerminalView.tsx:501` keeps inactive panes mounted behind `className={active ? … : "hidden"}`.

**Known with certainty for one tool:** opening Docker starts `container_stats`, which takes ~2 s.
The list is cached and instant; the bars arrive two seconds later.

**Not established:** whether the other tools' cost is React mount or their queries. **Do not guess** —
measure with React's `<Profiler onRender>` around `ToolPanel` (built in, exact, no dependency).

**The constraint any fix must respect:** keeping tools mounted would keep their queries polling, which
would undo the maintainer's explicit decision that the Docker monitor runs only while visible
(rule:attention-signals contrasts the two). Mount-without-polling is possible but has side effects —
decide it with a measurement in hand.

### Round 3 — MEASURED (2026-08-01): the app is quiet, the terminals are not

**The idle baseline that was missing all day**, taken on a dev instance with **no agent session in any
tab**, Docker stopped:

| | idle window | same app, 2 Claude sessions running |
| --- | --- | --- |
| Rust backend | 3.1 % | 6.2 % |
| WebKit.GPU | **2.2 %** | **15.9 %** |
| WebContent | 2.4 % | 13.0 % |
| **total** | **7.8 %** | **35.0 %** |

**YggShell itself costs 7.8 % idle** — and a remote-desktop session (RustDesk, ~38 %) was running
throughout, so part of even that is not ours. The remaining 27 points are terminal rendering under live
output: the GPU process rises by a factor of **seven** the moment terminals emit text. The window frame
is no longer a factor — the harness measured `steps(60)` at +0.1 points over control.

**So the framing changes:** there is no idle-cost problem left to fix. What remains is the cost of
rendering output, which is the app's actual job.

**The `FLUSH_INTERVAL` hypothesis is DEAD — measured, 2026-08-01.** 8 ms vs 16 ms, same dev build, same
`yes` flood, same machine: **66.4 % vs 66.3 %**, with WebContent identical at 44.5 % in both. Idle 10.5 %
vs 10.1 %. There is nothing there.

The reason is in the code: under a flood the **byte threshold** fires, not the timer — `FLUSH_BYTES` is
64 KB and `yes` fills it long before 8 ms elapse. The interval only governs the *quiet* case, where the
cost is zero anyway. **Do not re-open this**; raising the interval buys nothing and costs latency on
short bursts.

**What the load profile actually says** (Prod build, `perf` tmux tab, 15 s each):

| | Rust | GPU | WebContent | total |
| --- | --- | --- | --- | --- |
| idle | 4.8 % | 3.2 % | 3.7 % | 11.7 % |
| moderate (~2k lines/s) | 8.2 % | 13.9 % | 16.4 % | 38.5 % |
| flood (`yes`) | 11.1 % | 8.5 % | **42.0 %** | 61.6 % |

**Under a flood the bottleneck is WebContent — xterm's parser — not the GPU**, which actually *drops*
from 13.9 % to 8.5 % because xterm skips frames when it cannot keep up. So the remaining cost is the
parse of the bytes themselves, which is the app doing its job. There is no cheap win left in this path;
anything further means changing what xterm does with the data, not how it is delivered.

**Superseded — the original hypothesis, kept so nobody re-derives it:** 8 ms is 125 flushes/s; this machine's display runs
at **60 Hz** (measured via the harness: `current` triggers exactly 60.0/s). So the backend hands the
webview roughly **two batches per rendered frame**, each costing an IPC message, an `xterm.write()`, a
parse and a render schedule. Testing it needs terminal load inside an instance the agent can drive —
the dev instance ships `tmux_mode: off`, so there is no send-keys route in. Either switch the dev
settings to tmux and script `tmux send-keys`, or have the maintainer run `seq 1 500000` and
`yes | head -c 20000000` while the agent samples.

### Round 3 (original framing) — terminal rendering

The hot path: PTY → `Coalescer` → Tauri `Channel` → `xterm.write()` → WebGL renderer.

**The hypothesis to test first:** `FLUSH_INTERVAL` is **8 ms** (`terminal/mod.rs:40`), i.e. 125
batches/s against a 60 Hz screen. The code justifies it as *"below what an eye resolves"* — which
answers the wrong question. The question is whether every batch causes work (IPC message, `write()`,
parse, render schedule) that is discarded at every second one. Compare 8 ms vs 16 ms under a defined
load. `FLUSH_BYTES` is 64 KB.

**Also unanswered:** does an *inactive* pane still cost? It stays mounted behind `hidden`, so
`write()` and parsing certainly continue (the scrollback must stay current) — whether xterm also keeps
requesting frames is unknown. And whether WebKit really hardware-accelerates `WebglAddon` or silently
falls back.

**Needs a defined load the maintainer runs** (the agent cannot type into their terminals): idle, then
moderate (`seq 1 500000`), then a flood (`yes | head -c 20000000`), measuring CPU per process.

### Round 5 — DONE (2026-08-01). One finding, and the codebase held up.

**Run before the measuring rounds** because it is load-independent — the maintainer's call, and the
right one. Result, stated without inflation: **the boundary discipline is sound throughout.**

| Axis | Result |
| --- | --- |
| Boundaries | `open_external` http(s) allow-list · `create_claude_home` character allow-list · `theme::slug` is an allow-list, tested against `../../evil` and `/etc/passwd` · `files::verify` canonicalises and checks the root · `is_container_id` hex only |
| Concurrency | **No lock held across expensive work.** `logging::push` sends outside the lock; `TerminalRegistry::status` releases it before spawning tmux — both deliberate, both commented |
| Resources | PTY threads have explicit exits (EOF, `Ended`, `Disconnected`) · log ring buffer bounded · **zero** listeners or timers without teardown in the whole frontend |
| Unbounded growth | One finding, fixed below |

**The finding:** `launch::Pending` was a `Mutex<Vec<String>>` with no ceiling, fed from *outside the
process* — every `ygg <dir>` and every Finder "Open With" appends, and it is only emptied when the
webview mounts and asks. A webview that never starts, or a shell loop calling `ygg`, grew it without
limit for input the app was never going to act on. Now capped at 32, **dropping the oldest** (the
newest request is the one somebody is still waiting for), with a `warn` when it happens.

**What this round did NOT cover, deliberately:** CVEs and dependency health — `security-posture.json`
has 12 active blocking safeties for exactly that (`cargo-audit`, `cargo-deny`, `npm audit`, secret
scanning, `eslint-plugin-security`, `knip`, `clippy -D warnings`, `tsc --strict`, compiler/linker
hardening, exact pins). Auditing what a scanner already gates is wasted attention.

### Round 5 — scope, kept for the next audit

**Why it comes before the measuring rounds**, decided by the maintainer and correct: static reading
needs no quiet machine, and what it finds can invalidate or obviate a measurement. Rounds 2–4 all
need a calm system; this one does not.

**Why the existing gates do not cover it.** `security-posture.json` has 12 active safeties, all
blocking, all pre-push: `cargo-audit`, `cargo-deny`, `npm audit`, secret scanning, `eslint-plugin-security`,
`knip`, `clippy -D warnings`, `tsc --strict`, compiler and linker hardening, exact pins. CVEs and
dependency health are therefore **not** what an audit should look for — that is done.

**The evidence that an audit is still worth it:** five defects landed on 2026-08-01, and *not one*
would have been caught by any of those tools — an animated `conic-gradient` burning 27 % CPU (valid
CSS), `enabled: cwd !== null` (idiomatic TanStack Query), a query living in a component that is not
always mounted (ordinary React), `TAURI_CONFIG` inherited from a dev build (not code at all), and a
fixed candidate count against a growing source (clean, tested Rust). Scanners find known *patterns*;
each of these was correct code resting on a wrong assumption.

**Scope — not "read everything":**

1. **Boundaries** — what arrives from outside (webview, filesystem, another program's working files)
   and how it is validated at the point of entry.
2. **Concurrency** — locks held across expensive calls, channel ordering, races between a poll and the
   thing it polls.
3. **Resource lifecycles** — anything that grows without a bound (the events file was exactly this),
   threads/intervals/listeners without teardown.
4. **Assumptions that only break under load or over time** — fixed limits against unbounded sources,
   caches without eviction, first-run vs. hundredth-run behaviour.

### Round 4 — code-level analysis, measurement-led

Worth doing, but **after** a measurement points at something, and it finds a different class:
algorithmic complexity that only bites under load, memory growth over time (WebContent sat at
219 MB — a snapshot, no trend), unnecessary work for invisible tabs.

**Two suspicions already checked and DISMISSED — do not re-open them:** the status bar's one-second
tick already stops when nothing runs, and the `s.panes` selectors only re-render on a real reference
change.

## Defects with a diagnosis, not yet closed

- **`zsh: locking failed for <appdata>/shell/.zsh_history: no such file or directory`** was seen once
  in a probe. macOS' `/etc/zshrc` sets `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history` and runs *between*
  our generated `.zshenv` and `.zshrc`, which is why the repair line in `.zshrc` exists. Verified
  working once (`HISTFILE=/Users/…/.zsh_history`, 2939 entries) — so this is either a probe artefact
  or a path the repair misses. **Inside tmux the question no longer arises**: no rc file is generated
  there at all any more. It can therefore only affect a plain shell session.

## Traps this session paid for — do not re-learn them

- **An animated custom property inside a `conic-gradient` is a PAINT across the element's whole box,
  every frame, for ever.** `.window-frame` animated `--frame-angle` at `linear` over an element that
  *is the whole window*, to show a 1.5 px border — the rest is covered by `.window-frame-inner` and
  painted anyway. Measured on an idle release build, same instance, CSS swapped by hot-reload:
  **27.7 % of a core in the WebKit GPU process vs 3.0 % with `steps(60)`**, `sample` showing
  `CA::OGL::MetalContext::draw_elements` on top. It presented as *"tab switches feel sluggish"* —
  every interaction was competing with a permanent full-window repaint, and nobody would look for it
  in a stylesheet. **A decorative animation is a per-frame cost times the element's area; a 12 s
  revolution does not need 60 fps.** If you raise the step count, re-measure — the cost is in the
  paint, not in the animation.
- **`.hud-panel` pins `position: relative`, and unlayered CSS beats every `@layer` — including
  Tailwind's utilities.** `className="hud-panel absolute inset-0"` therefore does NOT float: the
  element stays in the flow, `inset-0` does nothing, and an `overflow-auto` child never bounds. Use
  `.hud-popover` (same chamfered border, `position` left to the caller) for anything floating. Gated
  now by `hud/floating-panel-position` (`scripts/project/eslint-hud-position.mjs`).
- **ESLint flat config REPLACES a rule's options, it does not merge them.** Adding an entry to the
  base config's `no-restricted-syntax` from the project overlay silently switched off its bans on
  native `<button>`, `<input>` and the `title` tooltip — config loaded, lint passed, gate gone. If you
  need a check the base config already owns the rule name for, write your own rule in
  `scripts/project/` instead. **Probe a gate you just added with a file that should fail**; that is
  the only reason this was caught.
- **`title` is banned as a JSX ATTRIBUTE, wherever it appears** — including as a prop name on your own
  component. Name such a prop `heading`.
- **imara-diff hands back lines WITH their terminator.** Strip it, or every rendered diff line is
  followed by a blank one.
- **xterm.js `write()` is asynchronous.** A test that writes and immediately reads the buffer reads an
  empty one and passes for the wrong reason. Await the callback.
- **A `hud-clip*` element does not hide an overflow — it AMPUTATES it.** `clip-path` cuts at the
  polygon, with no ellipsis and no scrollbar, so nothing on screen says text is missing. The tooltip
  carried `whitespace-nowrap` next to a `max-w-[240px]` and showed
  `/Users/steve/git-projects/private/yggshe` — a control that lied about its own content. Anything
  clipped **and** width-limited must be allowed to wrap (`wrap-break-word`). A `nowrap` element with
  no width cap (a `Button`) is fine: it grows instead of overflowing. Pinned in `Tooltip.test.tsx`
  (*"fitting its content"*); not lint-gated, because whether an element is width-limited depends on
  its parent and the check would be guesswork.

- **An unexplained light-grey surface, reported 2026-08-01 and not found.** A screenshot showed three
  backgrounds meeting: `#0a0a0f` (the app's deep) and `#1a1a2e` (`bg-elevated`, a panel) — both
  accounted for and one of them fixed (the diff's scroll container now carries the scheme) — plus a
  **light grey block, roughly `#eceef0`, that matches no colour in the palette**. The crop was too
  small to place it and the maintainer was not asked in time.

  **Narrowed since.** The maintainer guessed the tmux status bar; the arithmetic rules that out on
  its own — the lightest colour that bar requests is `colour8`, which is `#6a6a8c` in Yggdrasil and
  `#3c4812` in Alien Blood, nowhere near. But `status-style bg=default` means "the terminal's
  background", so the guess points somewhere useful: a **light scheme drawn where a dark one was
  expected**. Three bundled ones land almost exactly on the observed colour — `fimbulwinter`
  `#f2f5f8`, `ayu-light` `#f8f9fa`, `catppuccin-latte` `#eff1f5`. Look for a surface taking its
  scheme from the wrong tab, or a per-tab theme where the tab is not the one being drawn.

## Things that are true and will bite you

- **A GUI app has almost no `PATH` — and the login shell is only HALF the fix.** This cost three
  separate defects that looked unrelated, on three different days:
  1. the launcher panel read the *process* `PATH` → "not on your PATH" about a directory in constant
     use;
  2. it then read a **login** shell's (`zsh -l`) → the same message, because `~/.local/bin` is added
     in **`.zshrc`**, which only an *interactive* shell reads;
  3. the usage bars stayed empty, because `claude` lives in that same `~/.local/bin` and
     `which("claude")` therefore found nothing.

  **The capture is `-l -i`** (`terminal::environment`). Measured: 110 ms, once, cached, behind the
  timeout that already existed — the old comment's objection ("prompt frameworks, for an answer that
  does not depend on any of it") was simply wrong here, because the answer depends on it entirely.
  Two tests hold it now: one scans this module for the `-i`, the other scans the WHOLE backend for
  `Command::new("name")` with a bare program name, which searches the process `PATH` and finds
  nothing a user installed. Use `environment::which()` or an absolute path; the exception list in
  that test is for OS-shipped tools only and `claude`/`docker`/`direnv`/`tmux` will never join it.
  **Also true, and unchanged:** `launchctl getenv PATH` is empty, and **none of this reproduces in
  `tauri dev`** — there the app inherits the launching terminal's environment, so a defect of this
  class is invisible in development and total in an installed build.

- **Killing the app with a signal loses window geometry.** The window-state plugin only writes on a
  clean `RunEvent::Exit`; `pkill` never triggers it. `tray.rs::save_geometry` covers the × button,
  hide-to-tray and the tray's Quit. If you restart the app with `pkill` while testing, do not read
  anything into geometry not being restored.
- **`void somePromise` is not error handling.** It satisfies the linter and discards the rejection,
  which this app turns into a fatal screen over the whole interface. The rule that would catch it
  (`no-floating-promises`, `ignoreVoid: false`) is type-aware and this project runs no type-aware
  linting — see the note in `eslint.config.project.mjs`. Until that changes it is a review habit.
- **Screenshots are not available to the agent.** `screencapture` fails with *"could not create image
  from rect"* because the terminal running the agent has no macOS **Screen Recording** permission.
  Granting it (System Settings → Privacy & Security → Screen Recording, for the terminal app) is what
  makes visual verification possible; window geometry can already be read via System Events
  (`osascript -e 'tell application "System Events" to tell process "yggshell" to get {position, size}
  of window 1'`).
- **The upstream is private.** `governance:update` clones over HTTPS and fails under any other GitHub
  account; run `gh auth switch --user kaoszwerg` first. The same applies to `git push`, which flips
  back to the other account on its own more than once per session.

## Deferred by the maintainer

- **Windows and Linux behavioural verification.** The ConPTY path compiles and is untested; so is
  WebKitGTK. Three of this session's defects were platform behaviour in a WebView that no test caught.
- **macOS signing / notarisation.** `release.yml` supports it once the `APPLE_*` secrets exist
  (ADR-APP-023); none are set. Builds are ad-hoc signed, so a fresh `.app` needs right-click → Open.

## Not owed upstream any more

All three defects reported in `docs/upstream-report.md` shipped in `saga-rust-template` v0.10.3 and
were pulled in. Do not re-report them.

**Why:** these are known gaps with their evidence attached, not oversights — recording them keeps a
later agent from re-deriving a diagnosis or "fixing" something the maintainer deliberately deferred.

**How to apply:** pick items from here only when the maintainer asks; verify the unverified ones
before building anything on top of them. See [[project-scope]] for what the product is.
