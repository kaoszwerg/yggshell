# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (ADR-CORE-024).

## [Unreleased]

### Added

- **The process list draws the tree it always was.** Indentation alone does not say who started whom —
  two rows one step apart could be parent and child or cousins, and the eye cannot tell. Thin rules now
  connect each process to the one that started it. They are computed from the list rather than drawn at
  every level: a line is only carried past a row where that ancestor really does have more children
  below, because one drawn unconditionally would run past the end of a branch and connect processes
  that are unrelated — which is exactly the question the panel exists to answer.

- **The tmux tool ends the detached sessions in one action.** Sessions only ever accumulate — closing a
  tab detaches on purpose — and clearing them one confirm at a time was the whole cost of that
  decision. The action deliberately spares any session open in a tab: that one is attached, and ending
  it would leave a dead shell in a tab nobody touched. One stubborn session no longer abandons the
  rest half-done; the count that refused is reported.

### Fixed

- **No tool panel could scroll.** The tool column's content wrapper was a plain block with
  `overflow-hidden`, so a tool rooted with `flex-1` — which is all of them except Git — had no definite
  height: its root fell back to its content height, grew past the box and was clipped, and the
  `overflow-auto` region inside it never had a height to scroll against. Git was the exception only
  because it roots itself with `h-full`. Fixed once in the container, which is what owes its children a
  height, rather than in six tools.

- **The window frame flickered at a corner after every resize.** The band was painted by a `145vmax`
  square carrying the gradient and spun by a transform — a composited layer growing with the *square*
  of the window, ~5650×5650 device px on a large display. WebKit stops re-rasterising that layer
  correctly once the window is resized, so a corner loses its band; which corner depends on how it was
  dragged. Measured out: `145vmax` never goes stale, and neither shrinking the square to the exact
  diagonal nor dropping `will-change` changed anything — it is the covering layer itself. It does not
  reproduce on Windows, where Blink tiles such layers, which is why it survived upstream and why it
  affects every app on this template on macOS and Linux.

  The frame now paints **only the band**: one conic gradient anchored to the window, sampled by four
  thin strips that between them cover every place a 1.5 px border can appear. Nothing is larger than
  its own strip, so the failure is unreachable; the painted area is ~7 % of the window, so the angle
  animates smoothly again instead of in the 60 steps the first version had to be cut to. The strips
  are derived from the chamfer rather than sized by hand, and a test fails the build if any part of
  the frame is ever sized to cover the window again (ADR-PROJ-003).

- **The terminal's activity line blinked once per loop and came up short at its left end** — worse the
  narrower the terminal. It had been ported to a composited transform on a child six times the strip's
  width, by analogy with the frame; the analogy was never measured on this element, where the repaint
  it avoids is 3 000 pixels a frame against the frame's 2.2 million. Reverted to moving its own
  background, which is what it did before and what was reported stable.

- **A directory is not a tab.** The turn state added a version ago was matched by `cwd` alone, so two
  tabs open on the same repository — one running the agent, one running a build — were
  indistinguishable: the build's tab was told the agent was idle and showed nothing while it worked.
  The hook script now records the harness's own pid (`$PPID`), and a tab claims an event only when
  that process is in **its** process tree. An event with no pid, from an older script, matches no tab,
  so those tabs keep the behaviour they had.

- **The activity line flickered at its right end** — sometimes reaching the edge, sometimes stopping a
  few pixels short. The travelling child was two periods wide and shifted by one, which put its edge
  exactly on the strip's at one phase of every loop; sub-pixel rounding there opened and closed a gap.
  It is three periods wide now and hangs a whole period off each side, so neither edge ever comes near
  the strip's at any phase. Pinned as a relationship between the numbers rather than as the numbers.

### Fixed

- **The activity line now says whether the agent is working, not whether a harness is open.** Reported
  as running with no discernible relation to anything — and it was not inverted, it was measuring the
  wrong thing. An AI harness **is** a command that runs for hours, so both of the terminal's own
  signals answer *yes* for its entire lifetime: inside tmux `#{pane_current_command}` reports it
  (measured: `2.1.220`, constant), and outside tmux OSC 133 emits `C` when it starts and `D` only when
  it exits. Correct, and useless — it says a program is open, not that it is doing something for you.
  It stopped only while a subshell happened to be in front, which is what made it look random.

  A third hook event, `UserPromptSubmit`, marks where a turn begins; `Stop` and `Notification` close
  one. Where an agent has reported from a tab's directory, its turn state replaces the pane's command
  state. Where none has, nothing changes — and `null` is deliberately not the same answer as "an agent
  that is idle", or every plain shell would look permanently quiet and a build running in one would
  show nothing.

  **Existing installations repair themselves.** The hook script has self-healed since 0.39.2; its
  *registration* had not, so a new event would have reached only whoever pressed "install" again for a
  change they were never told about. Both are refreshed at startup now.

### Fixed

- **The window frame stopped animating, and only its bottom-right corner was drawn.** The build shipped
  `animation: … frame-spin` with **no `@keyframes frame-spin` at all**: Lightning CSS eliminates
  keyframes it believes are unused, and it did not match a usage inside `@layer components` against a
  definition at column 0 — which is where the layering of 0.40.1 left it. With no keyframes there is
  no `translate(-50%, -50%)` either, because that lives only in them, so the spun square sat with its
  **corner** at the window's centre instead of centred. Exactly the reported picture.

  Both keyframes blocks are inside the layer now. `activity-sweep` had survived by accident of
  ordering, which is why neither is left outside. A test pins the invariant, negative-controlled.

- **A hovered button drew a black icon on black**, on every tab and every rail entry. The layering of
  0.40.1 lost `.hud-btn:hover::before` — the rule that hides the dark core so the accent fills the
  button — because the selector is grouped across two lines and the block parser doing the move keyed
  on the line carrying the `{`. `:hover` then set the label to `--saga-bg-deep` over a core that was
  still dark. The same truncation hit `input[type="range"]:disabled::-webkit-slider-thumb`.

  Both restored, both pinned. And the check that would have caught them at the time — comparing the
  selector set against the previous stylesheet, which the upstream did and this port did not — has now
  been run: only the three rules changed on purpose differ.

- **"View here" ignored the configured theme and looked unhighlighted.** One cause: the container was
  missing `scheme-surface`, the class that *applies* the nine custom properties `surfaceStyle` sets.
  Syntax colours on the wrong background read as no syntax colours.

### Changed

- **The rail wears its accent at rest, not only when open.** Everything fell back to cyan until it was
  selected, so the distinction that matters — a **view** replaces the page, a **tool** opens beside it
  — was visible only for the entry already chosen. The colours said nothing at the moment you were
  deciding where to go. Tools are purple throughout; views stay cyan and go green where you *are*,
  because green is a state and a permanently green rail would claim "you are here" about five places.

### Fixed

- **Middle-click pastes the clipboard now, not an emulated X11 selection.** Reported: middle-click did
  not paste what had been copied. It was pasting an app-scoped stand-in for the X11 PRIMARY selection
  — and the handler is skipped on Linux, because there the real PRIMARY works and the WebView does it
  properly. So the emulation ran on exactly the two platforms whose users have never had a PRIMARY
  selection: a macOS user middle-clicking means "paste what I copied", which is what iTerm2 does, and
  got their last *selection* instead. The stand-in was redundant here anyway — `copy_on_select`
  already puts a selection in the clipboard for anyone who wants selecting to be copying.

  It reads through the backend, like every other paste since 0.39.6. This was the third call site of
  `navigator.clipboard.readText()` and the one missed then; it would have hung the same way.

### Changed

- **Upstream v0.10.6 pulled, and the `.hud-*` classes moved into `@layer components`** (briefing
  `app-111`) — the finding this fork reported. A caller's utility now wins over a component class,
  which is what accepting a `className` prop promises.

  The migration's real cost is the fork's own audit, and it came out clean: every `className`
  containing a `.hud-*`, `.scheme-*` or `.window-frame` class was checked against the properties that
  class declares, multi-line templates included. **Zero collisions** — the one that existed was
  `.hud-activity`'s `position`, already removed in 0.39.6 when it dropped the activity line out of the
  window's top edge.

  `src/styles/layers.test.ts` is ported with it and is the only thing in the gate that can see this:
  unlayered CSS is valid, lints clean, typechecks clean, and fails only as *nothing happening* when a
  caller passes a utility. Negative-controlled against an unlayered `.hud-panel`.

  **The reduced-motion queries stay unlayered on purpose**, and that is pinned too: an accessibility
  override has to outrank everything, a caller's utility included, and a layered one would not.

### Added

- **Four things you can do with a path in the file browser**, where there were two:
  - **View here** — a text file read in the detail panel with syntax highlighting, read-only. Nothing
    is launched: the file's type decides only which highlighter colours it. The backend refuses a
    directory, refuses anything binary (a NUL in the head, the test `git` uses) and caps what it reads,
    saying so when it truncates.
  - **Open with the default app** — for the PDF, the image, the binary an inline viewer cannot answer.
  - **Open in a new terminal** — the directory itself, or a file's parent, which is what dropping a
    file on a terminal has always meant and what `ygg` and Finder already do.
  - **Type cd into this terminal** — *typed, not run*. The webview does not get to decide that
    something executes (ADR-PROJ-001 §5): the command lands at the prompt and the user presses Enter.
    The path is single-quoted, since it is user data arriving at a shell.

### Changed

- **"Open with the default app" reverses a recorded decision, deliberately.** The file browser was
  limited to reveal-and-copy because handing a path to the platform handler *starts an application
  chosen by the file*. That was raised before building and overruled by the maintainer: YggShell is
  meant to be a complete everyday environment for agentic development, and the narrow stance was
  defensible for a terminal and is not for a development environment. The reasoning is recorded at both
  the command and the platform function rather than deleted — it was overruled, not refuted. What
  stands: the path is verified against the tab's own root, the action is explicit, and it is logged.

- **The About text, the README and the project scope now say what YggShell is.** The README still
  claimed "nothing of the product is built yet" while six sidebar tools were in daily use. All three
  describe the tool and never a person.

### Fixed

- **A diff line that was wider than the panel could only be read with the mouse.** Every line was its
  own `overflow-x-auto` box under `whitespace-pre`: to read one you dragged it sideways, and the line
  above stayed where it was. Lines wrap now, in both the unified and the side-by-side renderer, and in
  the commit view — which draws the same component. `wrap-anywhere` rather than `break-all`, so
  ordinary code still breaks at spaces and only an unbroken path or a minified line is cut mid-token.

  The unified renderer also needed `min-w-0`: a flex child defaults to `min-width: auto`, so without
  it the text sets the row's width and no wrapping ever happens however it is asked for.

- **A new file was shown side by side against nothing.** There is no comparison to make — every line
  is an addition — so the left column was a column of gaps, halving the width available to read the
  file that was actually there. A diff with only one side now renders in one column whatever the split
  setting says, and the number gutter for the side that does not exist is dropped with it. The same
  holds for a deleted file, in the other direction.

### Fixed

- **Three panels sat on screen showing something that was no longer true.** *"Ich will auf einen
  Blick die aktuelle Situation erfassen können, nicht durch Rumklicken."* Activity was read once and
  then only on its refresh button; Files had no interval at all, so a file the shell had just written
  never appeared; and Docker's **container list** was pinned at `staleTime: Infinity`, so a container
  that had just started showed up nowhere. Only Docker's *stats* were live, which made the panel look
  current while its list was not.

  Both halves are now in place, because neither alone is enough:
  - **A command ending re-reads all three**, over OSC 133, which the app already receives and the
    store already carries per pane. That is the exact moment a build, a `git checkout` or a
    `docker compose up` has changed what these panels describe — earlier than any timer could be, and
    free when nothing is happening. It fires on the **edge** out of `running`, in **any** tab, since a
    build finishing over there creates the file you are looking at over here.
  - **Each panel also polls while it is on screen.** A dev server that opens a port ten seconds into a
    run crosses no command boundary, and a watcher writing files crosses none either. Only while
    mounted and only while the window is visible — TanStack stops an interval on both counts, which
    is what makes two process spawns per read affordable. Closed or hidden, they cost nothing.

  This deliberately replaces a documented decision (*"read on demand, never on a timer"*). That
  reasoning was about cost and it was right about cost; it was wrong about the value of a panel you
  have to click to trust — which is right only at the moment you click it, and convincingly wrong
  every moment after.

  `git` and the agent session keep their own polls: they change without a command boundary, so a
  trigger would be a second mechanism rather than a better one. `docker-stats` samples over time and
  costs ~2 s a read; it keeps its own cadence.

### Fixed

- **Paste from the terminal's context menu did nothing, and froze the menu while it did it.** It read
  the clipboard with `navigator.clipboard.readText()`, which is permission-gated in this webview: the
  confirmation it wants was never visible, nothing was pasted, the menu stayed open and rendering
  stalled until the user clicked elsewhere — which is also where the "the animation stutters after
  paste" report came from. The clipboard is now read in the **backend** (`clipboard_text`, official
  Tauri plugin), so nothing asks permission to paste into your own terminal. macOS' ⌘V was never
  affected: WebKit's own paste event carries the text. `Ctrl+Shift+V` was, and takes the same route
  now.

- **Three regressions from yesterday's activity-line rewrite, all reported, all mine.** Converting it
  from `background-position` to a `transform` was right; the port was careless three times over:
  - **It ran backwards.** `background-position: -200%` reads as "move left" and moved *right*: a
    percentage position resolves against `element − image`, the image was twice the element, so the
    bracket is negative and the sign flips. A translate says what it does, which is why porting one
    has to state a direction — and why getting it backwards is silent.
  - **It stopped reaching the edges.** The original's period was **two** window widths, so the strip
    showed half a period: one smooth ramp, never dark at an edge. I halved it, which put the
    gradient's faint ends exactly at both edges.
  - **It left the top edge.** `position: relative` on `.hud-activity` overrode the caller's
    `absolute inset-x-0 top-0` — every `.hud-*` class in this stylesheet sits outside `@layer` and so
    beats every Tailwind utility. The travelling child needs no positioned ancestor at all: it
    overflows in normal flow and `overflow: hidden` clips it.

  Each is pinned by a test now, including the two that are pure geometry and would otherwise only ever
  be caught by eye.

### Fixed

- **Removed a `will-change: transform` that had been in the activity line for a day.** It was
  cargo-cult — an animated `transform` is composited without it, so the hint bought nothing — and it
  is not free. The window frame's spun square exists **once** and may carry the hint; this one exists
  **once per terminal**, so every pane running something would hold a permanently promoted, full-width
  layer for as long as it ran. Over-promotion costs memory and is a documented cause of exactly the
  rendering artefacts it looks like it prevents. Pinned by a test, since the next person will be
  tempted the same way.

### Fixed

- **The activity line travels by `transform` now, not by `background-position`.** Reported as the fast
  border animation stuttering. Animating `background-position` re-rasterises the gradient across the
  element on every frame — the identical defect the window frame was cured of two versions ago, one
  component over, and reached the same way: the property reads as a position and behaves as a repaint.
  A 2 px strip is far cheaper than a whole window, but the cost is paid at 60 fps for as long as
  anything is running, in every terminal that is running something.

  The gradient is now painted once onto a child two periods wide and shifted by exactly one, so the
  loop is seamless and every frame is a compositor operation. The reduced-motion query moved with the
  animation — the same trap the window frame walked into first, where leaving the query behind ignores
  the preference without erroring.

  **Whether this is the cause of the stutter is not established.** It is a real defect either way and
  the fix stands on its own; a link to the window-frame change of 0.39.1 is plausible and unmeasured,
  and is stated as such rather than claimed.

### Changed

- **Upstream v0.10.5 pulled** (briefing `app-110`). Our seam fix is byte-identical to theirs. Their
  test improvement is adopted: the glow's clip is pinned by its **positive** invariant as well, since a
  second contour can reintroduce the seam without using the `evenodd` keyword.

### Fixed

- **The tmux tool listed nothing while six sessions were running.** tmux answered every time — 93
  bytes of it — and the parser dropped every line, because the separator it arrived with was not the
  one that was sent. The format asked for a tab; what came back was `0_1_0_zsh`, with a literal
  underscore where each tab should be, while the binary demonstrably holds a real `0x09` and the
  newlines came through untouched.

  **What performs that substitution was not identified, and this does not claim to have found it.**
  It could not be reproduced from a shell under any combination of `PATH`, `TMPDIR`, locale, `TMUX`,
  a null stdin, a pipe or a missing controlling terminal, and the same build listed its sessions
  correctly from a dev bundle whose only differences are its name and identifier.

  What the evidence *does* establish is the class: a control character was replaced while every
  printable one — including the `#{}` syntax on either side of it — survived. So the fix is to stop
  handing anything a control character to transform. The separator is now `:`, which tmux itself
  forbids in a session name, and the command is parsed as the remainder so a `:` inside it is data
  rather than structure. A test refuses any control character in the format, so the next person who
  wants to line the columns up cannot reintroduce it.

### Fixed

- **`tmux::sessions` was silent about every way it can fail, which is why an empty list could not be
  diagnosed.** The tool reported "no tmux session is running" next to four that were, and nothing in
  the log could say whether tmux was missing, refused, or answered something unparseable — an empty
  list is a legitimate answer *and* the shape of every failure, which is exactly the case rule:logging
  exists for. Every branch now says why it gave up, and the successful one records which binary
  answered and how many bytes it read.

  The cause of the empty list itself is **not yet found**: the same code returns four sessions from a
  dev bundle and from a direct call, and zero from the running production process. The bundles differ
  only in name and identifier — no entitlements, no signing difference — and the tmux socket, server
  and binary are the same one the app successfully attaches terminals to. Marked open rather than
  guessed at; the build carrying this logging is what will say.

### Fixed

- **The window frame had a gap in it, at the top-left chamfer.** The ring the glow is clipped to was
  a single `evenodd` polygon — the outer contour followed by an inset one, in one point list. **A
  single polygon cannot have a hole:** the path traces the outer contour, jumps to the first inner
  point, traces that, and closes back to where it started, and those two connecting segments are real
  edges. They cut across the chamfer, the fill rule cancels itself out there, and the border goes
  dark. Reported from a running build.

  No ring was needed. `.window-frame` has `padding: 1.5px` and the inner shell is opaque and sits
  above the glow, so it already covers everything but the band — which is how the pre-animation
  version worked, and why: padding survives the production CSS minifier, where a mask-composite ring
  did not. The glow now takes the outer chamfer and nothing else, pinned by a test.

- **A restored tab now carries its tmux session's name.** The names reached the backend correctly and
  were shown nowhere: inside tmux the shell's own title (OSC 0/2) is usually swallowed and never
  arrives, so after the session id came out of the label every tab read the same word and nothing said
  which session it held. A tab is now named after its session until a shell names it something better.

### Added

- **A tmux tool, because the fix that made "new" mean new made sessions pile up.** Closing a tab
  *detaches* — deliberately, so a build survives the window looking at it — and since 0.37.0 a new tab
  no longer reuses an old session. Nothing cleared them and nothing even showed them. The tool lists
  every running session with **what it is running** and how many windows it has, because after a crash
  the names are `yggshell`, `yggshell-2`, `yggshell-3` and none of them says which one holds the build.

  Click one to attach — or to jump to the tab already showing it, since two clients on one session are
  one view, not two. Rename one, and **every tab that named it is carried across in the same gesture**:
  a tab left pointing at a dead name would create an empty session under it on the next start while
  the renamed one sat orphaned, which is exactly the defect the restore exists to prevent. End one
  behind a confirmation that says what stops.

  It polls only while it is on screen — the opposite trade from the attention signal, which polls in
  the background precisely because its job is to reach someone looking elsewhere.

- **Closing a tab that holds a tmux session now asks.** Three outcomes, and the dialog has all three:
  close and keep the session (what closing has always meant, and still the focused default), close and
  end it, or — Escape and the backdrop — never mind, leave the tab alone.

  **Quitting the app is untouched and always will be.** It does not close tabs; it detaches every
  client and ends, so ⌘Q with four tabs open is not four questions. Only the three places a *user*
  closes a tab reach the question, and a session that ended on its own never does — asking "end its
  session?" about one that is already gone is nonsense.

- **`ConfirmDialog`**, a HUD primitive, because `window.confirm` is stock chrome and lint-gated out
  (ADR-APP-026). It opens with **cancel** focused: the key most likely to be in flight when a dialog
  appears is the Enter that just triggered the action, and focusing the destructive button would turn
  "are you sure?" into a formality that answers itself.

### Changed

- **The guard against destroying a tmux session was narrowed, not weakened.** A test scans the whole
  backend for `kill-session` and has always failed the build on it — closing a tab, quitting or
  crashing must all leave a session resumable. Ending one the user can see, in front of a
  confirmation, is a different act. Exactly one file may now contain those words, and a second test
  pins that `tmux::kill` is reachable only from the command the user triggers: called from the close
  path, the exit path or a crash handler, the words appear in that file and the first test fails again.

### Fixed

- **An attention mark no longer outlives the thing it reported.** Reported head-on: *"aber es steht
  da und du hast garkeine frage gestellt"*. Self-clearing was built on the next event replacing the
  question — but `Stop` fires only at the **end of a turn**, so a permission prompt answered five
  minutes into a twenty-minute turn stayed on screen for the remaining fifteen. Measured: a
  notification whose transcript had since been written to for **592 seconds**, still shown as current.

  The payload carries no timestamp, so our own hook script now stitches one in, and an event is
  dropped as answered once the agent's **transcript** has been written to past it. The transcript is
  the finer clock: it grows with every tool call and stops growing precisely while the agent is
  blocked.

  The script is a copy in `~/.local/bin`, so an update would never have reached it — the app now
  rewrites it at every start when it differs, the way it already re-registers its Finder service. No
  button to press.

- **"Claude is waiting for your input" is not a question, and no longer looks like one.** Two
  different things arrive as `Notification`: `permission_prompt` blocks on you, `idle_prompt` is a
  timer noticing the prompt has gone quiet. `notification_type` was being dropped, so both reached
  you as one gold mark wearing the harness's own wording. An idle prompt now carries **our** wording
  and a **green** mark; a real request keeps its message and stays **gold**, because that message
  does say something. A bare terminal `\a` stays gold — it carries nothing that could say which, and
  calling it "finished" would be a guess.

- **A tab's number is now the key you press.** The label said `Terminal 5` using the backend's
  *session* id, which counts every session ever opened — so after one tab was closed the fifth tab was
  selected with ⌘4 and nothing said so. The position is now drawn by the tab strip itself, where it
  cannot go stale, and only for the first nine, because only those have a shortcut. A tenth tab
  labelled `10` would be the same lie again.

### Added

- **The shortcut list is gated, not merely maintained.** The Settings list *is* the help — there is no
  second page to go stale — but that only holds if it can name everything. `t(\`keys.action.${id}\`)`
  is a template literal, so a missing message is a runtime hole rather than a type error. A test now
  walks every action and asserts a name in both languages, and asserts the reverse too: a message left
  behind after an action was removed is a row that can never appear, which the next reader takes as
  proof the feature exists.

### Added

- **Attaching to a tmux session is now something you ask for.** Right-click the tab strip: alongside
  "New terminal" and the saved profiles, every session the tmux server is running is offered, and
  picking one opens a tab attached to it. The list is asked for when the menu opens, not left at
  whatever the last render happened to see.

  This is also the way back into tmux after a detach, which had no counterpart at all — and since
  `plain` now survives a restart, a detached tab had no way home.

- **A profile can decide whether its tabs use tmux** (`TerminalProfile::tmux`). A global setting can
  only say "all tabs" or "no tabs"; a mixed workspace needs a per-tab answer, and the profile is where
  every other per-tab override already lives. Left on *Default* it follows the setting, so profiles
  written before this field behave exactly as they did — and no "default profile" is needed, because
  Settings already plays that role (ADR-CORE-005).

### Fixed

- **A new terminal is now genuinely new.** `new-session -A` attaches when the name exists, and the
  numbering only ever consulted *this app's* open tabs — so a name free here could be occupied in tmux.
  Close three tabs today, press ⌘T tomorrow, and the first name in the series was free again while the
  session behind it was still running: you were dropped into yesterday's work without asking. The
  numbering now skips what the tmux server holds as well.

  **The cost, stated plainly:** the first tab no longer lands in a session you already have. That was
  deliberate behaviour, and it is now the picker's job — which is the point, since "open a terminal"
  and "go back to what I was doing" were never the same request.

  A *restored* tab is deliberately exempt from the skip: it must land in its own session precisely
  because that session is still there.

### Changed

- **The boundary check on a session name widened, on the record** (ADR-PROJ-001 §5). `tmux::may_name`
  accepts a name that is in the tab's own series **or** that the server actually has, where the
  previous rule allowed the series alone. The series was sufficient while the only caller was a
  restored tab handing back a name this backend minted; it stops being sufficient once attaching is a
  feature the user asks for. Invalid names are still refused before the existence question is asked, so
  nothing can address a window or pane inside another session. The tighter design — opaque per-session
  handles — was considered and rejected with its reasoning.

### Fixed

- **A tab that was NOT in tmux now comes back that way too.** The other half of the restore above, and
  it was pointing the wrong way: a tab you had deliberately detached out of tmux returned *inside*
  tmux, because `plain` was reset on rehydration on the reasoning that such a tab "is starting over".

  That reasoning was defensible while nothing else about tmux survived a restart. It stopped being
  defensible the moment a tmux tab started returning to its exact session: the two halves then
  disagreed in the same workspace — one tab restored faithfully, the tab beside it silently overruled.
  Which multiplexer a tab is in is part of what the tab *is*, exactly like its directory, profile and
  colour scheme, and all of those already survived.

  `plain` is now persisted and restored; `generation` still is not, and the test says why — it is a
  nonce meaning "give me a new session now", not a fact about the tab. The way back into tmux is
  closing the tab and opening a new one, as it already was: there is no re-attach action.

  Pinned at both levels: the store test asserts a mixed workspace rehydrates with each tab as itself,
  and the view test asserts each of them then asks the backend for the right thing. Both were verified
  by reverting the change and watching them fail.

- **A tab restored after a crash now returns to its own tmux session, by name.** tmux's sessions
  survive the app dying — that part never depended on us — but getting *back* to them did, and the
  wiring was missing. The tab persisted the session it was in, with a comment saying it did so "so a
  restart can return to it", and `terminal_open` had no parameter to carry it. The backend re-derived
  the name by **counting**: tab 1 → `yggshell`, tab 2 → `yggshell-2`, and so on.

  Counting is not identity. Close one tab before the crash and the numbering has shifted — the restored
  tab attaches to a session that belonged to a different tab, while the one holding the build runs on
  with nothing in the interface pointing at it. `terminal_open` now takes the remembered name and uses
  it when it is free.

  **It is a restore, never a choice.** `tmux::in_series` accepts a name only if it belongs to the series
  the *settings* define (`base`, `base-2`, …), so the webview can hand back a name this backend minted
  for it and nothing else — recorded in ADR-PROJ-001 §5, and pinned by a test that walks a list of
  strangers (`someone-else`, `work:1`, `workshop`, `work-2x`) and asserts none of them is attachable.

  Every escape hatch is unchanged and tested as such: tmux off, no tmux on `PATH`, an unusable
  configured name and a detach all still produce a plain shell, whatever a tab remembers. A remembered
  session another tab already shows is not joined twice, and a tab asking for a *new* session (a detach)
  is not handed the old name back.

- **The window frame is now composited instead of repainted, and it is smooth again.** Ours already
  cut the cost — `steps(60)` measured at **+0.1 points** over an animation-off control, down from
  **+4.4 points** at `linear` — but it paid for it with the animation: five full-window repaints per
  second instead of sixty, in exchange for a stepped 200 ms cadence. The upstream's answer (template
  v0.10.4, `de5b97f`, briefing `app-109`) removes the repaint entirely: the conic gradient is
  rasterised **once** onto its own layer and spun by a `transform`, which the compositor does without
  ever touching the paint. Measured at the control floor (**−0.2 points**, i.e. noise) with a smooth
  12 s revolution restored.

  The difference is not the 0.3 points — both are free today. It is that our number was small because
  we repainted *rarely*, and that cost still scales with the window's area; this one does not scale at
  all. It also removes the tuning knob whose comment had to ask the next agent to re-measure.

  The band lives on its own element on purpose: `clip-path` applies to an element **and its
  descendants**, and `.window-frame` is what the entire application renders inside — clipping it to the
  band would erase the app rather than the covered gradient. `src/styles/globals.test.ts` pins that,
  and pins the step the briefing calls out as silently wrong: the reduced-motion query must follow the
  animation to `.window-frame-glow::before`. Left on `.window-frame` nothing errors, no style fails,
  and the frame simply keeps spinning for everyone who asked it not to. Proven by breaking it.

- **Opening the Agent tool took a second and a half, and the cause was a missing `async` keyword.**
  Tauri runs a synchronous command **on the main thread**; only `async fn` reaches the async runtime.
  `agent_usage` shells out to `claude -p /usage` — measured at 1443–1629 ms — so it held the thread
  that also serves window events and IPC for that whole time. The panel could not paint although React
  had finished in about one millisecond, and the symptom looked like a slow UI three layers away from
  its cause. Measured before and after, same build, same keystrokes: **1562 ms → 27 ms**.

  Five more commands had the same defect and are converted too: `container_stats` (~2 s for
  `docker stats`), `git_fetch` (bounded by somebody else's network), `install_direnv` (runs a package
  manager — minutes), `environment_status` and `set_project_environment` (both spawn `direnv`).

  **`check:all` now refuses the mistake**: `check-blocking-commands.mjs` fails the build when a
  `#[tauri::command]` that starts a child process is not `async`. It resolves spawners at function
  granularity — an earlier module-level version flagged commands for calls they never make, and a check
  that is wrong half the time gets switched off (ADR-CORE-039). Short, bounded commands stay
  synchronous by name, each with the measurement that justifies it.

### Added

- **Every sidebar tool now has a keyboard shortcut, not just Git.** `⌘G` existed and the other four did
  not — an inconsistency nobody would guess at, and one that made the tool column reachable by keyboard
  only by accident of which tool you happened to want. Added `⌘E` (Files), `⌘J` (Activity), `⌘D`
  (Docker) and `⌘I` (Agent), each `Ctrl+Shift+…` off macOS, each rebindable in Settings like every other
  binding. Pressing another tool's key while one is open switches straight to it rather than closing
  first — pinned by a test, because two keystrokes per switch would make the shortcuts worse than the
  mouse.

### Fixed

- **The build command only worked on macOS.** Yesterday's identity gate introduced two Unix-only
  dependencies into `app:build`: `env -u TAURI_CONFIG` (no `env` on Windows) and `strings` (not on
  Windows either), plus `hdiutil` ran unconditionally although a DMG is a macOS artefact. A developer
  on Windows or Linux would have hit an error — and whoever worked around it would have built
  *without* the gate, on the platform where nobody would notice it had gone. The variable is now
  stripped in Node (portable), the binary is read and searched directly instead of shelling out to
  `strings`, and the DMG step exits early off macOS. The application code was already correct
  throughout: every platform branch has a macOS, a Windows and a `unix, not(macos)` arm with
  documented degradation.

### Fixed

- **The launch queue could grow without limit.** `launch::Pending` holds directories handed in from
  outside — every `ygg <dir>`, every Finder "Open With" — until the webview mounts and drains them. It
  had no ceiling, so a webview that never starts, or a shell loop calling `ygg`, grew it for input the
  app was never going to act on. Capped at 32, dropping the **oldest** (the newest request is the one
  somebody is still waiting for), with a warning when it happens. Found by a targeted code audit; the
  only finding in it, and the scanners in `check:all` could not have caught it.

### Added

- **The Docker tool now shows what each container is consuming.** CPU and memory as bars, live, while
  the panel is open. Three deliberate limits, decided with the maintainer: **no history** (a series
  would need a buffer surviving tab switches, and "is this one eating the machine right now" is a
  current value); **no disk figures** (`docker system df` is a separate, much slower call and belongs
  on demand rather than in a live view); and **it polls only while the tool is on screen** — which
  `ToolPanel` already guarantees by mounting exactly one tool. The interval is 5 s because the call
  itself takes ~2 s: `docker stats` samples twice to compute a CPU delta, measured at 1.9–2.0 s for
  six containers. Anything faster would mean a `docker` process running more often than not. CPU is
  scaled against one core as docker reports it, so a container on two cores reads 200 % — the bar
  clamps at 100, the number beside it stays exact.

### Fixed

- **The window still jumped on launch: the UI scale is not a React value.** `ui_scale` is the *native*
  WebView zoom (ADR-APP-021), so the frontend can only apply it from an effect — after a frame has
  been laid out and shown at 100 %. Seeding the settings query from cache fixed the DOM half and could
  not touch this one. Rust now sets the zoom in `setup()`, before the webview has painted anything; it
  already had the settings loaded there to decide the tray. The frontend keeps its own `setZoom` for
  changes made in Settings.
- **The tab's dot stayed up after the agent had carried on.** Reported: *"die attention von dsp ist
  weg, aber der gelbe kreis ist noch am tab von dsp"*. The mark is shared with the terminal bell, and
  a bell keeps its mark until the tab is visited — correctly, because a `\a` carries nothing that
  could later say "never mind". An agent's question does: the harness's next event proves it carried
  on. Pointing at a tab where nothing is waiting is exactly the busywork this signal exists to avoid,
  so the agent signal now takes its own mark off again — and only its own, so a real terminal bell is
  never swallowed with it.

### Fixed

- **The interface painted the defaults first and jumped to your settings a moment later.** Settings
  arrive over IPC, so the first frame had none: scale 1.0, font size 13, default theme — then the real
  values, on every single launch. The last known settings are now read synchronously from
  `localStorage` as the query's initial data, so the first frame is already right. `settings.json`
  still wins: the cached copy is marked infinitely old, a real read is issued immediately, and the
  cache decides what is on screen for one frame — never what is true.
- **A release build could silently ship the DEV identity.** `tauri dev --config …` exports its merged
  configuration as `TAURI_CONFIG`, and `tauri build` reads that variable too — so building in the same
  shell you had just tested in compiled the release against the dev config. Nothing looked wrong: the
  bundle's `Info.plist` still said `com.kaoszwerg.yggshell`, the app installed and started. But
  `app_data_dir()` resolves from the compiled-in identifier, so it read and wrote
  `…/com.kaoszwerg.yggshell.dev/` — different settings, themes, logs and agent events, while the real
  ones sat untouched next to it. It cost an install and a round of "why is nothing showing up".
  `app:build` now strips the variable, and `check-release-identity.mjs` refuses any release binary
  carrying the dev identifier — the binary is the only artefact that betrays it.

### Added

- **An agent that wants something now marks its tab.** The hook signal knows which directory raised
  it, which is the whole reason it beats the terminal bell — but it was only ever rendered inside the
  Agent tool, so seeing it required already having that panel open and looking at it. It now rings the
  tab's own mark, at the shell root, so it reaches you while you are working somewhere else. It reuses
  the bell's mark rather than adding a second one: that mark already skips the tab in front, already
  clears on a visit, and is already counted in the status bar.

### Changed

- **The attention list is a state, not a log.** It showed every event ever recorded until somebody
  pressed "clear" — including a `Stop` for every finished turn, which is not a request for anything.
  It now reports only an agent that is actually asking, and only its newest word per directory: when
  you answer, the agent runs on, its next event replaces the question, and the entry disappears by
  itself. Nothing to manage, and nothing stale.

### Fixed

- **The attention signal switched itself off in the situations it exists for.** Three independent
  causes, each enough on its own: it was mounted inside a panel that only rendered when the front tab
  had a recognised session (an unmounted query polls nothing); it was `enabled` only once that tab had
  reported a directory (a question about *other* tabs, gated on this one); and its polling stopped
  whenever the window was hidden, which is exactly when an agent waiting for you matters. The events
  had been piling up in the file correctly the whole time.
- **The Agent tool lost the live session as soon as you worked.** Every slash command mints its own
  transcript — ~5 kB, no turns — and each one is newer than the session actually running. The search
  looked at a fixed six candidates, so a few minutes of work pushed the real session out of view and
  the panel said "no agent has run here". Measured while fixing it: five of the six newest files were
  exactly that. The search is now bounded by how much it reads, not by how many files it opens, so a
  flood of cheap files cannot crowd out the answer.
- **The window frame repainted the entire window sixty times a second, for ever.** The rotating
  chamfer animates a custom property feeding a `conic-gradient` — a paint, not a composite — across an
  element whose box is the whole window, to show a 1.5 px border. Measured on an idle build: 27.7 % of
  a core in the WebKit GPU process, against 3.0 % with the same animation stepped; every tab switch
  and sidebar update was competing with it for frame time. Same motion, a twelfth of the repaints.
- **The events file was read whole on every poll.** It is append-only and nobody prunes it, so the
  cost grew with how much the app had been used — a feature that gets slower the more useful it is.
  Only the tail is read now, at a fixed cost.
- **`agent_attention` logged nothing.** It named neither the file it read nor what it found, so "the
  panel says nothing is waiting" and "the events are in a file over there" were indistinguishable from
  the outside — which is precisely what made this take an afternoon to pin down (rule:logging).

- **The Agent tool noticed a running agent only sometimes.** A project holds one transcript per
  session and plenty contain no turn at all — a one-shot `claude -p`, an abandoned session, a
  `/usage` query. The newest *file* was therefore often not the newest *session*: measured here, a
  5 kB file with zero turns sat on top of the live 25 MB one. It now takes the newest transcript that
  actually has a session in it.
- **Every sidebar tool ignored the text size.** Five of them carried hard-coded pixel sizes while the
  Git detail panel had followed the setting since it was built — same app, two answers. Content now
  follows `terminal_font_size` everywhere, chrome stays fixed, and it is a project rule with a test
  per tool rather than a fix that lasts until the next tool is written.

### Added

- **The agent can now say what it wants, not just that something happened.** A Claude Code hook,
  installable from the Agent tool, reports which directory is waiting and why — a permission, an
  answer, a finished run. The terminal bell stays for everything else: it is the only signal that
  survives tmux, but it can never say more than "somewhere, something". The hook writes to a file, so
  events recorded while the app was closed are simply there when it opens. It takes effect in the
  **next** Claude Code session, which the panel says out loud.

### Fixed

- **`~/.local/bin` was invisible to the app — the root of three separate defects.** The launcher
  panel said "not on your PATH" about a directory in constant use (twice, for two different reasons),
  and the usage bars stayed empty because `claude` lives there and could not be found. The
  environment is now captured from an **interactive** login shell, which is the only kind that reads
  `.zshrc` — measured at 110 ms, once, cached. Two tests hold it: one requires the `-i`, the other
  refuses any backend lookup of a program that does not go through the captured environment.

### Added

- **The terminal bell is no longer thrown away.** A tab that rings while you are somewhere else gets
  a mark, and the status bar can show how many are waiting — the mark says *which*, the counter says
  *whether*, which matters when the strip is scrolled and the tab in question is off screen. The bell
  is the only attention signal that survives tmux (measured: tmux registers and forwards it, while it
  swallows OSC sequences whole). Visiting the tab clears it. Deliberately no system notification: a
  bell is also rung by an ambiguous completion, and a notification that cries wolf gets switched off.

### Fixed

- **Placeholders looked like configured values.** Dimmed and italic now, so an empty field reads as
  empty — otherwise nobody fills in what they believe is already set.

### Added

- **Subscription usage, as bars.** How full the session and weekly limits are, read from Claude Code
  itself (`/usage`) — which answers for **free**: no turn, no API call, measured. The transcript
  cannot answer this at all, because it records tokens and never limits, which is why the context
  count still has no bar and the usage does.

### Fixed

- **The built-in Yggdrasil scheme can now be chosen for diffs and commits too.** It was offered only
  for the terminal, so with the terminal on another scheme there was no way to say "but draw diffs in
  Yggdrasil" — only "follow the terminal". Those are different answers.
- **A diff no longer ends in a second background.** The scroll container kept the panel's own colour,
  so a file shorter than the panel showed the scheme down to its last line and `bg-elevated` below
  it — two backgrounds meeting mid-view.

### Fixed

- **The file browser had no context menu at all.** `Row` does not forward props it has not named, so
  `ContextMenu`'s handler was dropped in silence — the menu existed in the source and could not be
  opened. The same defect shipped once before on the tab strip; the prop is named explicitly now and
  a test holds it.
- **Shift+Enter did nothing.** The sequence was sent, but returning `false` from the key handler
  stops xterm's own handling *before* it calls `preventDefault` — so the browser put a newline into
  the hidden textarea, xterm forwarded that as input, and the newline is what submits. The program
  was getting `ESC CR` **and** a plain newline.
- **"That directory is not on your PATH" — again, and for a different reason.** The `PATH` an app can
  read is a *login* shell's, built by `.zprofile`; `~/.local/bin` is very often set in `.zshrc`, the
  *interactive* configuration. The panel was formally right and practically wrong, because every
  shell you open is interactive. It now asks the shell itself — `command -v ygg` — which is the
  question that was meant all along, and only when the cheap check has already said no.

### Added

- **The agent tool, and the Claude account manager with it.** What the harness in this tab is doing —
  model, branch, turns, context carried, how long ago the last turn was — read from its own
  transcript, plus a status bar element showing the context count. **Which account it is** is shown
  rather than assumed: several Claude homes can be in use on one machine, one per project, and a tool
  that hard-coded `~/.claude` would name the wrong one plausibly. The account for a project can now be
  chosen, created and applied from the app: it writes the `.envrc` direnv reads (backing up and
  preserving anything already there), approves it, and offers to install direnv where it is missing.
  Deliberately **no percentage of the context window**: the transcript records what a turn carried and
  never the size of the window it went into, so a percentage would be a number that looks precise and
  is not.

### Fixed

- **The window can be dragged again.** The tab strip takes the whole title bar by design, which left
  the app mark — about thirty pixels at the far edge — as the only place to grab. The empty part of
  the strip now drags, as it does in every browser, and a reserved area before the window buttons
  always does, however full the strip gets.

- **A Docker tool.** Containers grouped by compose project, with the health verdict verbatim — `Up 3
  hours (healthy)` and `Up 2 minutes (health: starting)` are different situations and a green dot
  loses both — the published ports (only the ones actually reachable from the host, deduplicated
  across IPv4 and IPv6), and the last 200 log lines on demand. Stopped containers are listed too:
  that is the one you are looking for when something that should be answering is not. No Docker, no
  daemon, or no permission all mean an empty list rather than an error. **It reads and does not
  act** — starting or stopping is a command, and whether this app may issue one is a decision for an
  ADR rather than for a widget.

- **An activity tool: what this tab is running, and what it is listening on.** A harness starts a dev
  server, a watcher, a build; it scrolls away or the tab is closed, and nothing said any of it was
  still there — until the next run failed on a port that was already taken, with an error naming
  neither the process nor the tab. The tool shows the process tree with the whole command line
  (`node` alone answers nothing) and the ports, with the address each is bound to, because `*` and
  `127.0.0.1` are the difference between reachable from the network and not. **Inside tmux it shows
  the session**, not the tab: everything a user runs there is a child of the tmux server, so walking
  our own tree would find exactly one thing — the client. Read on demand rather than on a timer, and
  it offers no way to end anything: the terminal is right there.

- **A file browser in the sidebar.** The tree of the active tab's working directory — folders and
  files, expandable, following a `cd` the same way the Git tool does. One directory is read per
  open, never a recursive walk: a tree that fetched everything up front would read `node_modules`
  before drawing a row, and would be stale the moment a file changed. Right-click reveals an item in
  the file manager or copies its path. It does not open, rename, move or delete — a file manager
  sitting next to an agent that edits files is a combination nobody asked for, which is the same
  reason the Git tool is read-only. Dot-entries are hidden until asked for, and the backend refuses
  any path outside the tab's own tree.

### Fixed

- **Colours that could not be read.** Measured rather than judged by eye, with WCAG ratios across all
  fifteen bundled schemes. Yggdrasil's own `brightBlack` scored **1.78:1** — invisible on the
  background, and it is the slot every program uses for comments and the diff uses for line numbers;
  it is now 3.81:1, while white text *on* it stays at 5.18:1, because a prompt fills that slot as a
  surface as often as it writes in it. Dimmed text in the diff and commit views is now mixed towards
  the foreground instead of towards transparency, so a scheme whose quiet colour sits close to its
  background cannot fade it away entirely. And where a scheme's selection would leave its text under
  the readable threshold — Alien Blood's is 3.85:1 — the app now supplies a selection foreground
  rather than recolouring somebody else's palette: every scheme keeps the colours it declares and
  gains only one it never specified.

- **Closing a tab, quitting, or crashing no longer destroys a tmux session.** It was believed that
  letting the terminal go was enough — a client hung up on detaches, and the session keeps running.
  Measured against a real server, it does not: the session was gone from `list-sessions` a moment
  later while every other session survived. The app now detaches explicitly, by terminal device so
  it can never reach into another tab or another terminal, and it does so on all three ways out —
  the tab, `⌘Q`, and the crash handler, which hands the sessions back *before* it writes its report,
  because a report can be written again and an unattached session cannot be resurrected.

- **A diff and a commit are now really drawn in the scheme you chose.** The setting promises "the
  colours a terminal, a diff and a commit are drawn in", and each view kept half of that promise: the
  diff handed the scheme to the syntax highlighter and nothing else, so Alien Blood keywords sat on
  the HUD's background with HUD line numbers and HUD tints — a third theme nobody had picked. The
  commit view had the opposite half: it set the surface colours and then wrote on them in HUD greys,
  which on a light scheme is pale grey on near-white. Both now draw from one set of properties, and
  the washes are mixed against the scheme's own background, so a light scheme gets a light wash
  instead of a hard-coded tint that either vanishes or glares.

### Added

- **Shift+Enter reaches the program as its own key.** The classic terminal encoding has no room for
  a modifier on Enter — both arrive as a bare `CR` — so an AI harness could not offer "submit" and
  "new line" as two different keys. It is now sent as `ESC CR`, which is verbatim the binding Claude
  Code's own `/terminal-setup` installs elsewhere. Every other key, with or without Shift, is left
  exactly as it was: a terminal that rewrites keys is a terminal that takes them away.

### Fixed

- **A tooltip no longer cuts its own text off.** The working directory's showed
  `/Users/steve/git-projects/private/yggshe` — sliced mid-word, with nothing on screen to suggest
  anything was missing. The bubble's chamfer is a `clip-path`, which amputates an overflow rather
  than hiding it, and the bubble refused to wrap. Its content wraps now, and its width is measured
  against the window instead of fixed in a class, so a narrow window shortens the bubble rather than
  the sentence.
- **The status bar now shows a tmux session you started yourself.** It only ever knew about sessions
  the app opened, so somebody who typed `tmux` in the shell saw nothing — the item looked broken when
  it was merely uninformed. The session is found by terminal device: `tmux list-clients` reports the
  tty each client is on, and a client on this tab's tty is by definition this tab's session. Exact
  device match, so one tab's session can never appear on another's.
- **The activity line is one colour instead of four.** It swept green → cyan → purple → gold, which
  is the same set the window frame's own gradient rotates through; two multicoloured animations a few
  pixels apart read as one restless edge rather than as two signals. It is gold now — the only colour
  in the palette not already spoken for, with green meaning *finished* and red *failed* on the same
  line. The movement stays; only the hue stops changing.

### Fixed

- **The status bar could not be edited at all.** Tauri intercepts drag events at the OS level by
  default, so HTML5 drag-and-drop inside the window never fires — the editor was correct and inert.
  The window now declares `dragDropEnabled: false`. This is the class of defect that passes every
  test: jsdom has no such layer, so the suite was green while the app was not.
- **The app crashed when the launch listener was torn down.** The cleanup unregistered through an
  unguarded promise, and Tauri deletes its listener entry on the first call — a second reached
  `listeners[id].handlerId` on `undefined`, which arrived as an `unhandledrejection` and put the whole
  interface behind the fatal screen. It now unregisters at most once, survives an unregister that
  throws, and reports rather than rethrows.
- **The licence notices and the changelog are rendered as the markdown they are.** The credits are
  mostly a table of upstreams and licences; as raw text that was a wall of pipes. Links open in the
  browser through the backend — an `<a href>` in a Tauri window navigates the window itself, which
  would replace the interface with a web page and take the terminals with it.
- **The chosen colour scheme is marked, not merely ringed.** A cyan ring on a wall of cards that are
  themselves dark and cyan-ish is exactly the work the cards were meant to remove; the one in use now
  carries a tick and says so in its accessible name.

### Added

- **Colour schemes are shown as cards, not as a list of names.** "Ayu Mirage" and "Catppuccin Mocha"
  tell you nothing about what they look like; each card is drawn in its own colours, with a
  prompt-shaped line and the six colours a program is most likely to reach for. Selection is a ring
  rather than a fill — a card that adopted the HUD's active colour would stop showing the scheme at
  the moment you chose it.
- **Alien Blood**, the terminal palette of the VS Code theme of the same name (MIT, © 2026 kozcode),
  converted by a new `scripts/project/vscode-to-yggtheme.mjs` — which maps the theme's own
  `terminal.*` colours and leaves anything it does not define to the HUD rather than inventing it.
- **A system-load item for the status bar.** The one-minute load average, coloured by its ratio to
  the core count — 8 is idle on a 16-core machine and desperate on a 4-core one — with all three
  windows in the tooltip. Nothing at all on a platform with no load average, rather than a zero that
  would read as an idle machine.
- **The licence notices and the changelog are now in the app**, under Settings › About. Both are
  embedded in the binary rather than read from a file that could go missing.

### Fixed

- **The bundled schemes shipped without their copyright notices**, which the MIT licences they carry
  require to travel with the copy. `CREDITS.md` stayed in the repository while the schemes went into
  the binary; it is now embedded and displayed.
- **A leftover disk image no longer blocks the next build.** An interrupted `tauri build`, or a DMG
  installed and never ejected, left a volume mounted and every later build failed with nothing but
  `failed to run bundle_dmg.sh`. A pre-build step ejects **only** images from this checkout's build
  output or an anonymous scratch volume — a DMG mounted from anywhere else is left alone.

### Fixed

- **The tab strip no longer cuts a tab in half.** Tabs now shrink before the strip scrolls, down to a
  floor that still shows about seven characters and the × — below that a tab is not a smaller tab, it
  is an unusable one. Past the floor the strip scrolls, and it comes to rest on a tab boundary.
- **There is now a visible way to reach the other tabs**: arrows that appear only when there is
  something in their direction, outside the scrolling element so they cannot scroll away with it.
  A vertical mouse wheel scrolls the strip too — without that, a trackpad could reach the far tabs
  and a mouse could not. The selected tab is scrolled into view whoever selected it, so `⌘3` cannot
  land somewhere invisible.
- **The strip uses the whole title bar.** It was capped at 52% of the viewport, which left half the
  bar empty on a wide window while tabs were being cut off inside it.

### Fixed

- **"That directory is not on your PATH" about a directory that was first in it.** The launcher panel
  read the *process* `PATH`, which on macOS is the minimal one launchd hands a GUI app —
  `~/.local/bin`, Homebrew and everything else a developer has only exist after a login shell has run.
  It now asks the same module the terminal does. A test refuses any other file in the backend reading
  `PATH` from the process, because this class of bug is invisible in `tauri dev` (where the app does
  inherit the shell's environment) and total in an installed build.

### Added

- **Keyboard shortcuts, and every one of them rebindable.** New/close tab, next/previous, jump to a
  tab by number, search, text size, clear the screen, settings, log, Git tool — with the usual
  defaults (`⌘T`, `⌘W`, `⌘1`…, `⌘F`, `⌘+`/`⌘−`, `⌘K`, `⌘,`) on macOS and `Ctrl+Shift` equivalents
  elsewhere. Settings › Keyboard lists them all and records a new key when you press one.
- **A shortcut can never take a key the shell needs.** `Ctrl+C`, `Ctrl+D`, `Ctrl+Z` and everything in
  that range stay with the terminal: a binding without the platform's own modifier is refused by the
  editor *and* refused again when read back from storage, so a hand-edited payload cannot smuggle one
  in. The editor says which modifier to use instead, and refuses a combination another action already
  has rather than silently stealing it.
- **That list is also the help.** It shows what is bound right now rather than a printed set of
  defaults, which would be wrong the moment anything is rebound — plus what the mouse does
  (`⌘`-click for links, middle-click to paste, right-click for the menu), none of which is
  discoverable otherwise.

### Fixed

- **The terminal text sizes were two lists** — one in Settings, one implied by the shortcuts. They are
  one now, so `⌘+` cannot land on a size the settings page has no button for.

### Fixed

- **The Finder entry now appears where it was actually wanted**: right-clicking the empty area of a
  window, meaning "a terminal in the folder I am looking at". It needs `public.directory`, not
  `public.folder` — copied from Apple's own Terminal.app, which is exactly this case. Files are
  deliberately not accepted: a terminal opened "at" a shell script is a guess about what was meant.
- **An update no longer keeps the old Finder registration.** macOS caches document types per bundle
  identifier and replacing the app does not invalidate that cache — measured: after installing a
  build that declared the folder type, `lsregister` still had no claim for it and the menu showed
  nothing. The app now re-registers itself at every launch, so future updates fix themselves.
- **The command-line installer says whether it is already installed**, and where. It looked identical
  either way, so there was nothing to do but press it again — the state is read from the filesystem
  on every visit rather than remembered, because the script can be deleted.

### Added

- **"New YggShell Terminal Here" in Finder's context menu.** The folder association alone was not
  enough — that only reaches the "Open With" submenu. The menu line itself is an `NSServices` entry
  plus a provider registered at runtime, which is the same mechanism iTerm2 uses.

### Fixed

- **"Open With ▸ YggShell" did not appear for folders at all.** The document type was declared as
  `Viewer` with `LSHandlerRank: Alternate` — chosen so the app would offer itself without claiming to
  be the default handler for folders. Well meant, and it cost the feature: it is now `Editor` with no
  rank, matching iTerm2, and Finder still owns folders either way.
- **The About panel spelled the name YGGSHELL and showed no app mark.** It now uses the same
  small-caps treatment as the title bar, from the same helper, with the icon beside it.
- **Quitting the app left nothing in the log.** `save_geometry` only ran on the window's × and the
  tray's Quit, so ⌘Q, "Quit" in the dock and a logout wrote nothing at all — which made "who closed
  it?" a question the log could not answer. The run loop now logs the exit and saves the window
  geometry there too.

### Added

- **`ygg` and `yggshell` open a terminal where you are.** `ygg` uses the current directory, `ygg
  <path>` the one you name, and a file resolves to the directory holding it. Install it from Settings
  › Tools › Command line — nothing is written to your PATH until you press the button, and it says
  where the scripts went and whether that directory is on your PATH.
- **Finder offers YggShell under "Open With" for any folder**, and that needs no installation at all.
  Registered as an *alternate* handler on purpose: the app offers itself, it does not try to take
  folders away from Finder.
- Both routes converge on one validated path. What arrives is a **working directory** — never a
  command line (ADR-PROJ-001 §5): it must exist, a file becomes its parent, and it is canonicalised
  so the tab, the shell and the Git tool agree about where they are.

### Fixed

- **A launch on a cold start no longer lands in the wrong directory.** The path arrives while the
  webview is still loading, so the event reaches nobody; it is now queued in the backend and drained
  by the interface as soon as it is listening. Both halves are needed and both are measured against a
  built bundle — the event alone breaks the cold start, the queue alone breaks the running app.

### Added

- **The interface speaks German as well as English.** English is the default and the source; German
  is chosen in Settings › Appearance › Language, and applies immediately without a restart. Each
  language is listed in itself ("Deutsch", not "German") — somebody who has landed in a language they
  cannot read needs a way out, and a list written in that language is no help.
- **Two gates keep it from decaying.** `de.ts` is typed against `en.ts`, so a message added in
  English and not translated **does not compile**. And a new `i18n/no-untranslated-text` lint rule
  refuses a user-facing string written straight into a component — without it the interface would
  drift back into English one new button at a time, and no type could object, because an English word
  in JSX is a perfectly good string.
- **What a program prints stays untranslated**, deliberately: sample terminal output, compiler
  messages, shell paths. `cargo build` says `error: could not compile` on every machine. Marking it
  `<code>` says so to the reader and to the gate.
- **The settings log line now names the language**, so "the interface is in the wrong language" is a
  question the log answers.

### Changed

- **The last-resort crash screen reads the language without a hook.** It runs when React has already
  failed — possibly inside the very store a hook would subscribe to — so it falls back to English
  rather than adding a second failure to the first.

### Added

- **The status bar is yours to arrange.** The strip along the bottom is now a list you assemble in
  Settings › Appearance › Status bar: version, repository, running command, directory, tmux session,
  plus spacers and separators. Spacers do the aligning rather than fixed left/centre/right regions —
  that is what makes "second from the right" expressible, and what stops every future element from
  needing a decision about which region owns it. Drag to arrange, or use the keyboard throughout
  (`←`/`→` move, `Backspace` removes): HTML5 drag-and-drop has no keyboard equivalent at all, so an
  editor built only on dragging would be unusable without a mouse.
- **The scroll-to-top control is deliberately not in that list.** It comes and goes with what is on
  screen, so as an item it would shove the arrangement sideways on every appearance — and it could be
  removed altogether, leaving no way back to the top of a long view.
- **A gate refusing any committed script that kills processes by name** (`check:no-kill`, in
  `check:all`), with the rule behind it (`rule:live-app`). YggShell is the maintainer's daily terminal
  and often the one an agent session is running inside: a `pkill -f yggshell` in a build script takes
  down their open tabs, their running commands and the session itself, silently.

### Fixed

- **An untouched install drew Powerline prompts as empty boxes.** The font picker's placeholder said
  `MesloLGS NF` while the actual fallback stack started with JetBrains Mono, which has no such glyphs —
  so the settings page promised a font the terminal was not using, and only choosing it explicitly
  fixed it. One constant now backs the placeholder, the stack and the text, and the sample previews
  what the terminal will really render in.
- **Settings pages are broken into named blocks** instead of one long page divided by anonymous
  hairlines. The Terminal tab had grown to seven such blocks; each is now a headed panel (Shell, Font,
  Theme, Selection, tmux, Profiles), and each heading is a landmark a screen reader can jump between.
  The remote-check setting moved to a new **Tools** tab, where it belongs — it is what the Git tool
  does, not terminal behaviour.
- **Reordering the status bar no longer rebuilds the whole list.** Sanitising reissued every key on
  every edit, handing React a list it had never seen: it unmounted and remounted the lot, losing
  keyboard focus in the middle of a move.

### Changed

- **The remote check follows what is displayed, not which widget is open** (ADR-PROJ-002). The status
  bar's repository item shows the same ahead/behind counts, and a count nobody refreshes is not stale
  but *wrong*. Both share one query, so showing the branch in two places still costs one fetch.
- **What a tab is running is per-tab state**, held in the store rather than inside the pane component,
  so the status bar can report the tab in front without the panes agreeing on one activity for the
  whole window.

### Changed

- **The default scheme is called Yggdrasil**, and there is no separate "HUD" entry — they were the
  same colours under two names. It is built in rather than shipped as a `.yggtheme` file: a copy would
  be a second source for the same palette and the two would drift. It can still be *chosen* by name in
  a tab's right-click menu, which is not the same as "follow the settings" — a tab set to Yggdrasil
  stays there whatever the setting later becomes.
- **The app name is drawn in small caps** — `Y` `GG` `S` `HELL`, following the name's own capitals.
  Built by splitting the string rather than with `font-variant-caps`: that property needs the font to
  carry small-cap glyphs or the engine to synthesise them, and the label style uppercases the text
  before it, which would flatten the very casing it reads. Driven by `APP_NAME`, so renaming the app
  in `app.identity.json` needs no change here. The accessible name stays the product's, not four
  fragments of it.
- **An active tool in the rail is purple, not green.** Not a matter of taste: purple is the one accent
  in the palette carrying no other meaning here — green already says "the view you are in", gold is
  the DEV badge and warnings, danger is destructive. A tool is a different *kind* of thing from a
  view: it opens beside what you are doing instead of replacing it, and now it looks it.

### Added

- **The Git tool checks the remote** (ADR-PROJ-002), so `↑2 ↓0` is a fact rather than a memory. Those
  counts come from the local remote-tracking ref, which only moves when something fetches — and
  nothing did. The tool was not showing a *stale* number, it was showing a **wrong** one: not
  "unknown", but "zero behind" while upstream had moved on, with the error growing silently.
  - `git fetch` every five minutes while the tool is open, and on the refresh button that was already
    there. **Switchable** (Settings → Terminal), and a ⚠ appears beside the counts, with the reason,
    whenever the remote could not be reached.
  - **The one outbound connection this app makes**, and the ADR argues for it rather than assuming it:
    the host is one the user configured, nothing of ours is sent, and `git fetch` writes
    remote-tracking refs and objects — it cannot touch the working tree. That last point is exactly why
    `fetch` is allowed and `pull` is not.
  - **Never interactive**: `GIT_TERMINAL_PROMPT=0`, empty askpass, `ssh -o BatchMode=yes`, twenty-second
    deadline. It runs on a timer with no terminal attached, so a credential prompt would hang with
    nothing on screen to explain it.
  - **Through the `git` binary, not a bundled network stack.** The hard part is authentication — an SSH
    agent, a credential helper, a hardware key, an organisation's SSO — and `git` already has all of it
    configured. Reimplementing that would be a lot of code whose best outcome is behaving like the tool
    already installed.
  - **Actions were considered and declined.** `commit`, `push`, `pull`: in a terminal each is one word,
    and a second actor writing to a tree an agent is working in is the combination ADR-PROJ-001 exists
    to prevent.
- **The terminal font is configurable** (Settings → Terminal), through a list you can type into where
  **every row is set in its own font** — choosing a typeface from names printed in a different
  typeface is choosing blind, and the specific question people have here is whether the Powerline
  glyphs are present at all. A live sample below the field answers exactly that.
  - **The list is measured, not enumerated.** A WebView cannot ask for the installed fonts —
    `queryLocalFonts` is Chromium-only and absent from WKWebView — so each candidate is probed by
    rendering it and comparing widths against three fallbacks: identical every time means the browser
    substituted. A curated candidate list turns out to suit this better anyway; every font on the
    machine would bury the handful that can draw a prompt.
  - **A name the list does not show can still be typed.** The list is what could be detected, never a
    gate, and the CSS stack keeps a generic monospace behind whatever is chosen — a font that has since
    been uninstalled costs you the typeface, not a readable terminal.
  - **MesloLGS NF ships with the app** (Apache-2.0, © André Berg; licence and reasoning in
    `src/assets/fonts/`). It is the font powerlevel10k itself recommends, so a Powerline prompt works
    with nothing installed and nothing explained. Only one font is bundled on purpose: four weights are
    ~10 MB, and a second family would double that for a difference in taste rather than capability.
  - Changing it repaints the live terminal and re-measures the grid — a different typeface means
    different cell widths, so the same box holds a different number of columns.
- **An activity line along the top edge of each terminal** — iTerm2's idea, in the window frame's own
  travelling gradient so the two read as one system. At rest a quiet cyan hairline; while a command
  runs, the gradient sweeps; when it ends, green or red for a moment and then back to rest. That last
  part is the one worth having: the exit status of a command you looked away from is information you
  otherwise simply lose, and a state that never clears stops being a signal.
  - **Only as wide as the terminal.** The rail and the tool column are not part of what is running.
  - **Per tab**, like everything else about a tab: two terminals run different things.
  - Not a spinner. A spinner turns forever and says "something, somewhere"; this says *this terminal*,
    and it says how it ended. `prefers-reduced-motion` freezes it to a static line.
  - **Two sources, because measurement said so.** A probe emitted OSC 133 from inside a tmux session
    and counted **zero** `133;C` and **zero** `133;D` at the outer terminal, while a plain shell
    delivered both — tmux swallows them exactly as it swallows OSC 7. So the shell hook drives it
    outside tmux (instantly, with the exit status), and inside tmux it is polled from
    `#{pane_current_command}` on the poll that already runs there. That path has no exit status to
    give: it knows *running* and *not*, and does not pretend otherwise.
- **URLs in the terminal open with ⌘-click** (Ctrl-click elsewhere), in the default browser. The
  modifier is the point: a plain click in a terminal is a selection or a cursor move, and opening a
  browser because somebody clicked a line of log output is the surprise it prevents. The URL goes
  through the backend, which still refuses anything that is not `http(s)` — it came out of somebody
  else's output.
- **Copy on select**, off by default (Settings → Terminal). Off because it silently replaces whatever
  you had copied, which is only welcome when it was expected. Bound to the *end* of a selection rather
  than to every change: `onSelectionChange` fires for every cell the pointer crosses, and a hundred
  clipboard writes during one drag is both wasteful and, on a slow write, wrong. A middle-click still
  pastes the last selection either way.
- **Your tabs come back after a close or a crash.** Which tabs were open, where each one was, its
  profile and its colour scheme — restored, with the tab that was in front still in front.
  - **Two different things are restored, and the difference is the design.** A PTY does not survive
    the app: the shell gets its `SIGHUP` and dies, and no bookkeeping brings it back. So the
    *workspace* comes back as fresh shells in the same places — which is what every terminal means by
    "restore" — while the *process* comes back only through **tmux**, which outlives us by design: a
    tab records the session it attached to and returns to it, finding the work exactly where it was.
  - **What is deliberately not restored**, because it would be false the moment it appeared: a title
    the shell set (`cargo watch` is not running any more), a backend session id, an open diff, and a
    tab's detached-from-tmux state — its profile decides again. Each has a test that says so, and each
    of those tests was run against a version that kept it, to confirm it fails there.
  - A restored directory that has since gone is not an error. The backend logs it and the shell starts
    where it otherwise would have; a project moved between two runs must not leave someone staring at
    a message instead of a terminal.
  - Restored tabs count as the bootstrap, so none is opened on top of them.
- **Diffs and commits now follow the terminal's text size.** Code is code: the size chosen to read a
  terminal at is the size a diff should be read at, and having one follow the setting while the other
  stayed fixed was an oversight. It is not divided by the UI scale like the emulator's, because the
  panel is ordinary DOM and the WebView zoom already applies to it.
- **The Git tool's header names the repository**, beside the column's own name: `GIT · yggshell`. A
  branch on its own does not say where you are — `main` is `main` in every checkout, and this app is
  built to have several open at once. The full path is in a tooltip, because two checkouts of the same
  project share a folder name. Header and panel read through one hook, so they cannot name different
  repositories, and sharing the query key means the header costs a cache hit rather than a second walk
  of the repository.
- **Fourteen colour schemes ship with the app** — three of ours (Yggdrasil, Bifrost, Fimbulwinter) and
  eleven ported ones whose licences were each checked at their own upstream, not at the collection they
  were downloaded from: Solarized (dark/light), Dracula, Nord, Catppuccin (Mocha/Latte), Tomorrow,
  Tomorrow Night and Ayu (dark/mirage/light). All MIT; attribution in
  `src-tauri/resources/themes/CREDITS.md`. **Gruvbox is deliberately absent**: its repository carries no
  licence file, and "widely used" is not a licence. A shipped scheme can be copied and edited, never
  deleted — it is part of the app rather than of your data.
- **`.yggtheme`, which is an iTerm2 plist with our name on it.** Byte for byte the same format, so
  iTerm2 reads our files and we read `.itermcolors` — the extension marks where a file came from and
  changes nothing else. A round-trip test pins that, because the moment it stopped being true the
  extension would be a lie.
- **Diffs side by side**, old on the left with its line numbers and new on the right with its own,
  which is what makes a reindent or a rename readable at all. A row where one side has no line renders
  as a *gap* rather than a blank line — a blank line is a line that exists. Toggled in the panel header
  and remembered; the interleaved view is still there for a narrow window.
- **Diffs and commits can be read in a scheme of their own** (Settings → Terminal). The chain is
  explicit and every step earns its place: the setting for that kind of view, then the diff setting for
  commits, then the tab's own terminal scheme, then the default. "Same as the terminal" is a button
  rather than the absence of a choice — an inheritance chain nobody can see is one nobody can predict.
- **A colour scheme per tab.** Right-click a terminal → *Colour scheme…* A tab without a choice of its
  own follows its profile, and failing that the setting — so changing the default in Settings repaints
  every tab that has not opted out, immediately.
  - This corrects a wrong call in the profile work: shell, directory and scheme were treated as one
    thing. They are not. A shell is decided once, when the process starts, and a tab cannot change its
    mind about it afterwards; a scheme is decided every frame, which is why the emulator is repainted
    live. Freezing it into the profile made “give this tab another scheme” mean “open another tab”.
- **Terminal profiles** (Settings → Terminal): a named set of overrides for what a new tab starts as —
  its shell, its starting directory, its colour scheme. Right-click the tab strip to open one; the `+`
  stays a one-click terminal with the defaults.
  - **`terminal_open` takes a profile id — a reference, never a command line** (ADR-PROJ-001 §5). The
    backend turns the id into a program. A profile's shell is checked against the same list Settings
    is checked against, so a profile cannot be a way around that check.
  - **Everything is an override and Settings holds the defaults**, so there is no "default profile"
    document to keep in step: a profile that sets only a theme follows Settings for the rest, and
    changing Settings changes it.
  - A tab keeps the profile it was opened with. It decided which shell is running, and a tab whose
    profile changed underneath it would be claiming something about a process that is not true.
  - Two things that have gone stale are handled rather than fatal, because neither is a reason to
    leave someone without a shell: a profile that was deleted falls back to the defaults, and a
    starting directory that no longer exists means the shell starts where it otherwise would.
- **iTerm2 colour schemes, and an editor for them** (Settings → Terminal).
  - **Import is a file drop**: drop an `.itermcolors` file anywhere on the window. A drop hands the
    webview a *path*, never contents, so the backend is what opens the file — extension-checked, size-
    bounded, and parsed by a reader written for this and nothing else.
  - **That reader is hand-written on purpose, and it is a security decision rather than a size one.**
    Every `.itermcolors` opens with a `<!DOCTYPE plist PUBLIC … "http://www.apple.com/DTDs/…">`, and a
    general XML parser is a machine for resolving exactly that — external entities, nested expansion,
    DTDs — on a file the user downloaded from the internet. This one resolves nothing: it walks tags
    and understands five element names, so the class of attack does not exist rather than being
    configured away. There is a test that drops an XXE payload on it.
  - **A scheme carries only what it defines.** Colour has one home in this project and it is the
    frontend (rule:theming); a full palette stored in Rust would be a second source for the same fact.
    Anything a scheme never mentions keeps the HUD's colour — which is also what a user expects,
    rather than a stray black caret on a dark background.
  - **A theme editor** for all twenty-two colours, with a live preview of the palette on the
    background it will actually sit on, and a `ColorField` HUD primitive behind each one: the native
    picker is used as the *mechanism* — it is the OS picker people already know — and never seen, with
    a hex field beside it because schemes are written, pasted and shared as hex.
  - Changing a scheme repaints every open terminal at once. The emulator is not restarted, so nothing
    running is disturbed.
- **The Git tool got its layout, and two things to click.**
  - **Branch on top, fixed; changes and history below it, sharing a draggable divider.** The branch is
    two lines whatever happens, so a share of a scroll area would only ever be wasted on it. The other
    two genuinely compete — the file list is long while you work, the graph while you review — so the
    balance is the user's, and it is remembered like the column width. Both scroll on their own, so
    neither can push the other off screen. The divider is a share of the height rather than a pixel
    count: a stored `240px` would be most of a short window and a sliver of a tall one.
  - **Click a changed file to read its diff**, and **click a commit to read it in full** — the whole
    message the graph could only show the first line of, its author and parents, and the files it
    touched with `+n −m`. A file in that list opens its diff inside that commit, with a way back.
  - Both open in a panel **over the terminal** — the widest surface in the window, which is what a diff
    needs — while the shell underneath keeps running. Escape or × gives it straight back.
  - **Syntax highlighting** via `shiki`, which earns its place on three counts: it returns *tokens*, so
    there is no raw HTML injected over a repository somebody else wrote; its theme is ours, built from
    `PALETTE` (rule:theming), so nothing arrives wearing a stock look; and it runs on the JavaScript
    regex engine, so no WASM ships. Grammars load on demand from an explicit map — a variable import
    path would have bundled all two hundred.
  - `Row` and a horizontal `Splitter` are new HUD primitives, both tested. A list of forty native
    `<button>`s in a panel that is meant to be ours is exactly what ADR-APP-026 exists to prevent.
- **Which shell a terminal starts is now a setting** (Settings → Terminal). Until now it was `$SHELL`
  with no way to say otherwise.
  - It is a **list, never a text field**, and that is the point rather than a nicety. `terminal_open`
    deliberately takes no command line so the webview cannot name the program a terminal runs
    (ADR-PROJ-001 §5); a free-text shell path would have handed that straight back. The backend
    produces what this machine offers — `/etc/shells` plus the user's own `$SHELL` on Unix, the known
    interpreter locations plus `COMSPEC` and a `pwsh.exe` on PATH on Windows — the frontend picks from
    it, and anything else is refused when it is stored **and** again before a spawn, because a shell
    can be uninstalled in between and `settings.json` is an ordinary file.
  - Two shells with the same file name (`/bin/zsh` and `/opt/homebrew/bin/zsh` is a common macOS pair)
    are shown by full path. Two buttons both reading `zsh` are not a choice.
  - Changing it affects terminals opened from then on; the ones already running keep their shell.
- **The terminal — YggShell's first running feature** (ADR-PROJ-001). A real PTY per tab, multiple
  independent tabs, and the emulator behind the primitive layer:
  - Backend: `src-tauri/src/terminal/` — a session registry the backend owns, `portable-pty` behind
    the single module allowed to name it, and two threads per session whose deaths are both declared
    in `crash-boundaries.json`. Output is coalesced before it reaches the IPC (~8 ms or 64 KiB),
    because the PTY delivers roughly a kilobyte per read.
  - Security: `terminal_open` takes geometry and an optional working directory, never a command
    line. The shell is resolved in the backend and logged; the directory is canonicalised and must
    exist. No terminal content is ever logged, in either direction.
  - Frontend: `TerminalSurface` (the only file that may import `@xterm/*`), a `TerminalView` whose
    panes all stay mounted so scrollback survives tab switches, and tabs in the **title bar** — which
    cost no extra height, so the tagline yields to them once a terminal is open.
  - Closing a tab takes the foreground process group with it, so a build or an AI harness started
    inside the shell does not survive as an orphan.
- **Unix middle-click paste, on the tab too.** A middle-click on a tab pastes into *that* terminal
  and brings it to the front first — text arriving in a terminal the user cannot see is alarming.
  It routes through the emulator, so it is bracketed like every other paste.
- **Unix middle-click paste.** Selecting text in a terminal fills an app-scoped PRIMARY selection —
  on Unix, selecting *is* the copy — and a middle-click pastes it. A WebView cannot reach the real
  X11 PRIMARY (`navigator.clipboard` maps to CLIPBOARD on every platform), so the stand-in works
  between YggShell terminals but not across applications; that limit is the browser's.
- **Copy, paste and search shortcuts.** ⌘C/⌘V/⌘F on macOS, Ctrl+Shift+C/V/F elsewhere — never plain
  Ctrl+C, which a terminal owes to SIGINT. Every paste goes through the emulator so it is bracketed:
  a multi-line paste must not execute line by line as it arrives.
- **Search over the scrollback** (`@xterm/addon-search`): a HUD search bar with next/previous, Enter
  and Shift+Enter, Escape to dismiss, and a visible "not found" rather than a silent no-op. It
  searches the active terminal's scrollback — not other tabs, not the filesystem.
- **The shell names its own tab.** A title set by the shell (OSC 0/2) replaces the `Terminal N`
  fallback, so a tab can read `cargo watch` instead of a number.
- **HUD scrollbars, applied globally.** 6px, no track, no stepper arrows, cyan at 22% and 45% on
  hover. A native scrollbar is stock OS chrome (ADR-APP-026) and in a terminal it also simply
  competes with the text.
- **`ContextMenu` HUD primitive** (`src/components/ui/ContextMenu.tsx`) — the right-click menu the
  terminal and the tab strip need. Portal-rendered so a parent's `clip-path` cannot crop it, measured
  and clamped into the viewport so a menu opened near an edge stays on screen, and suppressing the
  native menu itself rather than relying on `useNativeContextMenuGuard` having run. WAI-ARIA menu
  keyboard model: first enabled row focused on open, arrows skip disabled rows and wrap, Home/End
  jump, Enter/Space activate, Escape closes and returns focus to the trigger.
- **`Tabs` HUD primitive** (`src/components/ui/Tabs.tsx`) — the tab strip behind the terminal's tabs,
  which live in the title bar (ADR-PROJ-001) and therefore scroll rather than wrap. WAI-ARIA tabs
  pattern with automatic activation: arrow keys move selection and focus, Home/End jump, Delete
  closes, and a roving tabindex keeps the whole strip to a single Tab stop. Closing a background tab
  does not select it. Middle-click is handed to the caller rather than bound to close: in a browser
  that is the convention, but in a terminal middle-click means paste, and one gesture meaning two
  opposite things inside the same window is how a user loses a running process.
- **ADR-PROJ-001 — terminal architecture.** Emulator, PTY crate, transport, session model and threat
  model decided before any code, each against a measurement: `@xterm/xterm` behind the primitive layer,
  `portable-pty` behind a single module with three named re-evaluation tripwires, and a Tauri Channel
  whose backend side *must* coalesce (66.7 MB of PTY output arrives as 68 267 reads of ~1 KB).
- Bootstrapped `saga-rust-template` into **YggShell**: identity `YggShell` /
  `com.kaoszwerg.yggshell` in `app.identity.json`, propagated by `identity:sync` to all 8 derived
  locations; version reset to `0.1.0`; CHANGELOG reset.
- New app icon: Yggdrasil as a rune-stave standing on a shell prompt (`src-tauri/icons/icon.svg`),
  rasterized into the desktop icon set.
- `src/test/environment.test.ts` — pins that the test environment exposes working `localStorage` and
  `sessionStorage`.

### Changed

- `SettingsStore::update` takes a `SettingsPatch` instead of a growing list of positional `Option`s.
  At six fields, `update(None, None, Some(x), None, None, None)` said nothing about which setting `x`
  was, and inserting a field in the middle would have silently re-targeted every existing call.
- Looking an executable up on the login shell's `PATH` moved from `tmux.rs` into
  `terminal::environment::which` — the shell list needs the same lookup, and a GUI app's `PATH` trap
  (ADR: launchd hands it four directories) is not something to solve twice.
- **Web Storage in tests now comes from an in-memory `Storage`, per upstream briefing `app-108`.**
  The previous shim re-pointed the globals at jsdom's Storage through `globalThis.jsdom` — a vitest
  internal — and probed the existing global first, which throws on Node ≤ 25 (a version `engines`
  still allows). The replacement installs unconditionally and is guarded only on `typeof document`.
  `src/test/environment.test.ts` now also pins *ownership* of the globals, not just their behaviour,
  so the setup block cannot be tidied away without a test failing.
- `hudButtonClass`'s `ghost` variant now honours the `accent` instead of always brightening to cyan.
  A close `×` on a cyan-filled active tab used to disappear exactly when the pointer reached it. The
  accent-to-class mapping is spelled out rather than interpolated — Tailwind scans for literal class
  names, so a built-up `text-${accent}` would ship as no colour at all.

### Fixed

- **Every tab attached to the SAME tmux session.** With attach-or-create, every terminal joined one
  session — and two clients on one session share one *view* of it: same window, same scrollback. A
  second tab therefore appeared to do nothing at all, which is not a multi-terminal app. The first tab
  now takes the configured session, and each one after it gets its own (`work`, `work-2`, …), reusing a
  name as soon as a tab closes. In plain attach mode, a session another tab is already showing yields a
  plain shell instead of a duplicate view.
- **Detaching from tmux closed the tab.** Detaching ends the *client*, not the work: the session keeps
  running and the user asked to be back in a terminal. The tab now gets a plain shell in place of the
  tmux client, keeping its window, its scrollback and its place in the strip. A shell that exited, or a
  client that died with a failure, still closes the tab.
- **The diff and commit panel belonged to the window instead of to a tab.** Two tabs are two
  repositories as often as not, so opening a diff in one and finding it laid over another was the
  natural consequence. Each tab now carries its own.
- **Looking at Settings or Logs killed every running terminal.** Navigating away unmounted the
  terminal view, and each pane closed its session on unmount — so a glance at a preferences page took
  down whatever was running in every tab, and coming back left an empty workspace. Two things were
  wrong and both are fixed:
  - **A session now ends when its TAB goes away, never when its component unmounts.** The session
    belongs to the tab, so the tab list is what decides. React unmounts components for reasons that
    have nothing to do with the user closing anything — navigation, StrictMode's double-mount in
    development, a hot reload — and none of them may take a build, an agent or an ssh session with
    them.
  - **The terminal view is hidden when you navigate away, not unmounted.** Even with the first fix,
    unmounting destroys every emulator and resets each pane's session id, so returning would open a
    *second* PTY per tab and leave the first running with nobody reading it — one orphan per
    navigation, and the scrollback gone each time.
  - Both are pinned by tests that were run against the broken code first, to confirm they fail on it.
- **Right-clicking the tab strip did nothing.** `ContextMenu` attaches its handler to the element it
  is given, and it was given `<Tabs>` — a component, which does not forward unknown props to a DOM
  node and therefore dropped it in silence. It now wraps a real element, and the primitive warns in
  development when it is handed a component, because the failure has no other symptom.
- **The Git detail panel sat *under* the terminal instead of over it, and would not scroll.** One
  cause for both: `.hud-panel` declares `position: relative` so its `::before` can draw the chamfered
  border, that declaration is unlayered, and unlayered CSS beats every `@layer` — including the one
  Tailwind's utilities live in. So `absolute inset-0` did nothing, the panel stayed in the flow, it
  had no height of its own, and the `overflow-auto` region inside it never became a scroll container.
  `.hud-popover` is the same border with `position` left to the caller, which is what a floating
  surface wants.
  - **Now gated**, because nothing reported any of it — not the type checker, not the linter, not a
    test: a project ESLint rule (`hud/floating-panel-position`, with its own tests) refuses
    `hud-panel` together with `absolute`/`fixed`, in a string or a template literal.
  - Worth recording: the first attempt added the check to the base config's `no-restricted-syntax`
    entry, which **silently switched off its bans on native `<button>`, `<input>` and the `title`
    tooltip** — flat config replaces a rule's options rather than merging them. Caught by probing the
    gate instead of trusting it. Hence a rule of our own.
- **The Git tool no longer sits blank for a tick after a terminal opens.** Its working-directory poll
  starts when the pane mounts, at which point there is no session yet — so its first ask hit a `null`
  id and did nothing, and inside tmux (where the poll is the only source) the tool waited a full
  interval for its first answer. It now waits for the session and asks immediately.
- **The stray `%` at the top of a fresh terminal.** It was a race in this app, not the shell. zsh
  draws its end-of-line mark as `%` + (`COLUMNS`-1) spaces + CR + erase-line, which erases itself —
  *if* the shell and the emulator agree on the width. They did not always: the settings query
  resolves shortly after a terminal mounts, the font size changes with it and the pane re-measures,
  and that second measurement was **dropped** whenever it landed while `terminal_open` was still in
  flight. The shell then drew for a wider window, the spaces wrapped onto a second line, and the
  erase cleared the wrong one. A geometry measured during the open is now remembered and applied the
  moment the session exists.
  - Measured, not reasoned: a PTY probe showed `$COLUMNS` and `stty size` matching what was passed
    exactly (so the backlog's column-mismatch-at-spawn theory was wrong), and the mark appearing with
    *and without* our shell integration; feeding zsh's exact byte sequence into the emulator at 80
    real vs. 100 believed columns leaves `%` on the first line, at 100 vs. 100 it leaves nothing.
  - `TerminalView` now has tests at all — the view where this lived had none.
- **The Git tool now follows a `cd` inside tmux.** It never did: tmux consumes OSC 7 for its own
  `pane_current_path` and does not forward it, so the sequence the shell hook emits was measured
  arriving zero times at the outer terminal — wrapping it in tmux's DCS passthrough changed nothing.
  What does work is asking tmux, which tracks the path itself; the active tab polls
  `terminal_cwd` while the backend answers `null` for an ordinary shell, where OSC 7 has already said
  so instantly. It also covers a session that existed **before** this app started and could never have
  had a hook injected into it.
  - Consequence, and a welcome one: **inside tmux no shell integration is installed at all.** No
    injected `ZDOTDIR`, none of the repairs that go with it — a tmux user's shell starts untouched.
- **A tmux detach took the whole interface down.** Sessions end underneath pending calls constantly —
  the user typed `exit`, tmux detached, the tab closed a keystroke ago — and the backend answers
  `no terminal session N`. Those rejections were unhandled, reached the app's global handler and
  became a **fatal screen over everything**. Every terminal call, and the clipboard and link paths
  with them, now handles its own failure. `void somePromise` satisfies the linter and throws the
  rejection away; it is gone from this view.
- **HUD buttons were broken by their own text.** `Button` carried no padding at all — every caller had
  been passing its own, and the fatal screen was the one that did not, so its label sat inside the
  chamfer. Padding and `whitespace-nowrap` belong to the primitive: a clipped shape whose label wraps
  is not taller, it is cropped.
- **With tmux enabled, shell integration silently stopped being installed.** It was prepared for the
  program being spawned, which is `tmux` and not a shell, so no hook was written and the Git tool
  stopped following `cd`. It is prepared for the shell now — the environment reaches every shell tmux
  starts either way. On top of that, tmux *consumes* OSC 7 for its own pane tracking: the hook now
  wraps the sequence in tmux's DCS passthrough and enables `allow-passthrough` for its own pane only.
- **A bundled app could not find anything the user has installed.** macOS launches a GUI app through
  `launchd`, which hands it `PATH=/usr/bin:/bin:/usr/sbin:/sbin` — so the user's own `.zshrc` failed
  with `command not found: direnv`, and the tmux integration reported "not installed" for a `tmux`
  sitting in `/opt/homebrew/bin`. Both were true of the *process* and neither of the machine, and
  neither shows in `tauri dev`, where the app inherits the terminal that started it. A login shell is
  now asked once what environment it would set; that answer is the base for every terminal and the
  search path for anything the backend looks up. Bounded by a timeout, because a profile that blocks
  must cost a short PATH rather than a window that never opens.
- **The app icon had a grey border, and filled its whole canvas.** The border was a 22%-opacity cyan
  hairline of ours, which on a near-black plate reads as dull grey — gone. And macOS expects the
  artwork inside 824×824 of the 1024 canvas (the Big Sur template); full-bleed made it larger and
  squarer than every neighbour in the Dock, with corners disagreeing with the system squircle.
- **Window size and position are written when the window closes**, not only on a clean process exit.
  The window-state plugin keeps everything in memory until `RunEvent::Exit`, so any other ending — a
  signal, a crash, a `tauri dev` restart — lost the geometry silently. The tray's Quit already had to
  save explicitly for the same reason; the × button and hide-to-tray now do too, from one place.
- **Your shell history was empty, and completion was degraded.** The shell integration points
  `ZDOTDIR` at a generated directory so its rc files are found — but macOS' `/etc/zshrc` runs
  *between* those two files and contains `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history`, so every terminal
  wrote its history into this app's data directory and opened with nothing in it. `ZDOTDIR` is now
  restored around each hand-off, and a `HISTFILE` that points into our directory is put back. Verified
  against the real shell: `HISTFILE=/Users/…/.zsh_history` with 2939 entries, `ZSH_COMPDUMP` back in
  `$HOME`. The shell itself was never the problem — it reported `INTERACTIVE=on ZLE=on` with 421
  widgets loaded throughout.
- The terminal now reports geometry only when the row/column count actually **changed**. Dragging the
  tool column fires the resize observer every frame, but a terminal's size only moves every whole
  cell — without the filter one drag would have been a hundred IPC calls and a hundred `SIGWINCH`s
  for a terminal that had not resized.
- **Middle-click did not paste at all.** It listened for `auxclick`, but xterm's selection service
  calls `preventDefault` on `mousedown` and WebKit then never dispatches the auxclick — so the
  handler simply never ran. It listens on `mousedown` in the *capture* phase now, which runs before
  any descendant listener. On Linux it deliberately does nothing: xterm already moves the textarea
  under the cursor there so the WebView performs a **native** paste of the real X11 PRIMARY — text
  selected in any other application included — and the app-scoped stand-in would be strictly worse.
- **Paste inserted everything twice on macOS.** ⌘V is handled natively by the WebView — Tauri's
  default Edit menu supplies the key equivalent and xterm listens for the resulting `paste` event —
  so the custom handler was a second paste on top of it. `return false` from xterm's key handler
  stops xterm's own key processing, not the browser default that produces the event. The shortcut is
  now intercepted only on Windows and Linux, where `Ctrl+Shift+C/V` are not browser shortcuts and
  nothing happens unless the app does it.
- `useTerminalStore.closePane` left `activeKey` pointing at the pane it had just removed when that
  pane was the only one open: `Array.at(index - 1)` wraps to the END of the list at index 0. Found by
  the test written for it, not in the app.
- **A crash report could erase the one before it.** `crash.rs` named reports from a millisecond
  timestamp alone, so two panics inside the same millisecond — or two processes crashing at once —
  produced the same path and the second `fs::write` overwrote the first. Report names are now claimed
  atomically with `create_new` and a bounded suffix search, so no crash record is lost
  (rule:crash-handling). Reproduced by the existing `two_crashes_never_overwrite_each_other`, which was
  passing only by luck of the clock; pinned deterministically by
  `a_second_crash_in_the_same_millisecond_does_not_erase_the_first` and
  `the_collision_search_is_bounded` — the latter now also asserting, per upstream briefing `app-107`,
  that an exhausted search leaves every earlier report intact.
- Test suite was red on Node >= 26 (11 failures): Node defines its own, unavailable
  `localStorage`/`sessionStorage` as non-enumerable globals, which shadow jsdom's working Storage
  because vitest copies only the enumerable window keys. `src/test/setup.ts` now re-points both
  globals at the jsdom window's Storage objects.
- `src-tauri/examples/crash_probe.rs` still referenced the old crate as `saga_rust_template_lib`:
  `sync-identity.mjs` does not cover `src-tauri/examples/`, so `cargo clippy --all-targets` broke
  after the rename. (The script fix belongs upstream — see `.claude/memory/open-work-backlog.md`.)
- `README.md` claimed Node >= 22 while `package.json#engines` requires >= 20.19.

### Removed

- **The Home view.** It described the empty template — "no product features yet", "add a backend
  module under src-tauri/src/" — which stopped being true the moment this became a terminal. The one
  thing it was good for, the build identity, is now the About section of Settings. A persisted
  `view: "home"` falls back to the terminal instead of leaving a blank pane.
- Two of the three copies of the build-identity block. `BuildIdentity` is the one source now; the
  About dialog and the About section both render it (rule:reusability).
- Template-creation artifacts: `docs/howto/new-project-from-template.md`, the `/bootstrap` command,
  and the "Create a project from this template" section of the README.
- Mobile icon assets emitted by `tauri icon` (`src-tauri/icons/android/`, `ios/`, `64x64.png`) —
  unreferenced by `tauri.conf.json` on a desktop-only app.
