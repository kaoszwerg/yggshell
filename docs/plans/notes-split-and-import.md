# Plan — the notes side by side, and notes that come from somewhere else

**Status: decided, not built.** Two features asked for on 2026-08-04, and the decisions the request
needed, taken with the maintainer before any code exists (`rule:clarify-and-plan`). Where a decision
created a follow-on question, it is answered here rather than left for the keyboard.

Two things were asked for:

1. **View and edit side by side, in follow mode.**
2. **Importing markdown files, including their image folder, into the repository.**

## The premise check, first

**Side by side does not contradict the decision recorded in `NotesView.tsx:22`.** That comment rejects
*editing each block in place*, and the objection was that it leaves the page looking rendered while
parts of it are not. A split does the opposite: each pane is wholly one thing — source on the left,
rendering on the right. The comment is nevertheless **rewritten in the same change**, because it
currently states "two states, and you are always in exactly one" as a rule, and there will be three
(`rule:documentation`: a stale doc comment is worse than none, because it is trusted).

## Three findings that came out of the verification, and what they change

### 1. Drag and drop does not exist in this app, and one feature already depends on it

`src-tauri/tauri.conf.json:25` carries `"dragDropEnabled": false`, set in `7d8254d` so the
`StatusBarEditor`'s HTML5 reordering would work. The chain, verified rather than assumed:

| Step | Evidence |
| --- | --- |
| The config sets the flag | `tauri.conf.json:25` — `"dragDropEnabled": false` |
| The flag disables the handler | `tauri-runtime-2.11.3/src/webview.rs:477` — `if !config.drag_drop_enabled { builder.disable_drag_drop_handler() }` |
| No handler, no event | `tauri-runtime-wry-2.11.4/src/lib.rs:4862` — `with_drag_drop_handler` is registered **only** when `drag_drop_handler_enabled` |
| One feature listens for exactly that event | `src/components/settings/ThemeControls.tsx:104` — `getCurrentWebview().onDragDropEvent(...)` |

So the theme drop zone has been inert since that commit — and the tests stayed green, because jsdom has
no such layer. That is the failure class `7d8254d`'s own message named, hit a second time in the same
commit.

**Decided:** the picker below replaces it. Themes get the same native picker, and the dead
`onDragDropEvent` listener and its drop-zone UI are **removed** — with the maintainer's consent, on the
record here (`rule:core-principles` §9: removal is never the agent's call). The *feature* "import a
theme" is repaired, not dropped; only the gesture changes.

### 2. The picker belongs in Rust, and that makes the boundary stronger rather than weaker

`tauri-plugin-dialog` **2.7.2** (crates.io, `Apache-2.0 OR MIT`, same family as the already-accepted
`tauri-plugin-clipboard-manager`) exposes `blocking_pick_file` / `blocking_pick_files` /
`blocking_pick_folder` on its **Rust** `FileDialogBuilder` (verified on docs.rs for 2.7.2).

Opening the picker in the command rather than in the webview means:

- **no `@tauri-apps/plugin-dialog` npm package**, so no `ui-boundary.json` entry and no new
  runtime dependency on the frontend at all (`rule:dependencies`: prefer the smaller thing);
- **no new webview capability** — the permission surface in `capabilities/default.json` is untouched,
  which is what least privilege actually means here (`rule:security`);
- **the path never reaches the webview.** ADR-PROJ-004's rule — *the frontend names a project and a
  topic, never a path* — holds **unchanged**, with no import-shaped exception carved into it. The
  webview says "import into project X"; Rust asks the user, reads, writes and answers with a report.

The `blocking_*` variants must not run on the main thread. `commands/notes.rs` already routes
everything through an off-main-thread helper for exactly this reason, so the requirement is satisfied
by using the path that is already there.

### 3. The offset contract between TS and Rust is unproven, and follow mode rests on it

`src/lib/markdown.ts:65` takes `node.position.start.offset` from mdast — an offset into the JS string,
in UTF-16 code units. `notes::toggle` (`src-tauri/src/notes/mod.rs:236`) does `text.get(offset..)` — a
**byte** offset. For any note with a non-ASCII character above a task item — an umlaut, an emoji — the
two disagree.

`str::get` is boundary-safe, so nothing is corrupted: the user sees *"that item is no longer a task"*
and a checkbox that will not tick. **This is stated as suspected, not as fact.** It is the first thing
built, as a failing test on the Rust side with a German note (`rule:testing`: a fix begins with a test
that reproduces the bug), and it is fixed before anything else, because follow mode maps the same
offsets onto pixels and must not be built on an ambiguous unit.

The fix, if the test confirms it: the boundary carries **one** unit. Rust converts at the edge
(`char_indices`-based) rather than the frontend guessing, since the frontend's unit is whatever mdast
reports and cannot be changed.

---

# Feature 1 — Read | Split | Write, with follow

## The shape

A three-way lens in the header, plus a follow toggle. `read` and `write` are today's two states
unchanged; `split` is both at once, editor left, preview right.

```
┌────────────────────────────────────────────┐
│ ← proj · topic   [Read|Split|Write]  ⇅     │
├──────────────────────┬─────────────────────┤
│ # Title              │ Title               │
│                      │ ─────               │
│ A paragraph, ![]…    │ A paragraph,        │
│                      │ [image]             │
│ - [ ] todo           │ ☐ todo              │
└──────────────────────┴─────────────────────┘
   editor (editScheme)    preview (readScheme)
```

Three rather than "a preview switch on the editor", because the narrow window and distraction-free
writing both want the editor alone, and because *split* should be reachable from reading without
passing through writing.

## Why the sync is anchor-based, and never proportional

Proportional `scrollTop` mapping is the obvious implementation and it is wrong for markdown: an image
is one line of source and 400 px of preview, a code fence is the reverse. The panes drift apart on the
first note that has either — which is most of them.

**Both anchors already exist in the code:**

- **Preview:** `Markdown.tsx:126` writes `data-md-start` / `data-md-end` on every top-level block.
- **Editor:** `MarkdownEditor.tsx:96` renders the coloured mirror as **one `<span>` per source line**,
  and that mirror is laid out pixel-identically to the textarea by construction (that is the whole
  point of the two-layer trick). `span.offsetTop` is therefore the pixel position of source line *N* —
  no text metrics to reimplement, no font measurement, no guessing about wrapping.

```
editor scrollTop → topmost visible source line   (mirror spans)
                 → offset                        (prefix sums of line lengths)
                 → the block whose [start, end) contains it
                 → that block's offsetTop + progress within the block
                 → preview scrollTop
```

The reverse direction is symmetric. **The pane with the pointer or the focus drives**; the other
suppresses its own handler for one frame (a `syncing` ref cleared on `requestAnimationFrame`), or the
two chase each other.

**Follow also tracks the caret**, not only the scroll: typing scrolls the preview to the block being
written. That is what makes it *follow* rather than *linked scrollbars*, and it costs nothing extra
once the anchor map exists.

## One change the mechanism needs

`MarkdownEditor.tsx:109`: when the tokens are stale (`fresh === false`) the mirror renders the raw
value with **no per-line spans** — so the anchors vanish for a frame on every keystroke. The
uncoloured fallback must render one span per line too. Layout-neutral: they are inline spans, and the
existing metrics contract is untouched.

## Files

| File | What |
| --- | --- |
| `src/lib/followScroll.ts` **new** | The pure core: `lineStarts(source)`, `offsetAtLine`, `blockFor(offset, blocks)`, `alignFrom(...)`. No DOM. Unit-tested first (TDD). |
| `src/hooks/useFollowScroll.ts` **new** | The DOM glue: reads `offsetTop` off mirror spans and `[data-md-start]` elements, owns the `syncing` ref and the driver rule. jsdom test with stubbed offsets. |
| `src/components/ui/MarkdownEditor.tsx` | Per-line spans in the uncoloured fallback; expose the mirror element to the hook. |
| `src/views/NotesView.tsx` | The lens, the split layout, the `Splitter`, the follow toggle; the rewritten doc comment. |
| `src/store/ui.ts` | `notesLens`, `notesFollow`, `notesSplit` (editor share, 20–80), persisted and **clamped on rehydrate** — the same trap the existing width already handles at `ui.ts:246`. |
| `src/i18n/en.ts` + `de.ts` | `notes.lens.read` / `.split` / `.write`, `notes.follow`, `notes.splitter`. English is the source; the compiler refuses a missing German key (`rule:i18n`). |

## Details already decided

- **The splitter** is the existing HUD primitive (`ui/Splitter.tsx`), vertical, keyboard-operable.
  Minimum 260 px per pane; below ~560 px of view width the *split* option is disabled with a tooltip
  saying why, rather than silently rendering something else.
- **Schemes:** editor pane `editScheme`, preview pane `readScheme` — both already exist
  (`NotesView.tsx:69`), and split is the first time the two are visible together, which is exactly the
  case they were built for.
- **Font size** stays `useContentFontSize()` on each scroll region, once (`rule:content-size`).
- **The toolbar** floats inside the editor pane, as it does today.
- **Block controls in the preview while split:** *edit here* moves the caret in the live editor
  instead of switching state — the byte ranges it already passes are the same ones follow uses.
- **Escape** stays a ladder: split or write → read → leave the view.
- **Saving is unchanged**: debounced 600 ms, committed when the editor is left.

---

# Feature 2 — Importing markdown, with its images

## What the user does

Notes tool → the project's kebab menu → **Import markdown…** → the OS picker (files *and* folders,
multi-select) → a result panel saying what happened.

The import targets **the project the menu belongs to**. Nothing guesses a project from the front tab —
that was decided against once already (`notes/mod.rs:274`).

## What the backend does, per file

1. Canonicalise the source; it must be a regular file ending `.md` / `.markdown`, under a size cap.
2. Read it, and scan for image targets: inline `![alt](path "title")`, `<path>` form, and
   reference-style `[id]: path` definitions. Anything else is left untouched **and reported**.
3. Resolve each **local** target against the source file's own directory and canonicalise it.
4. **Copy it only if it resolves under that directory.** Otherwise: skip, keep the link as it is, and
   name it in the report.
5. Copy through the existing `images::add` — which already supplies the timestamp prefix and
   `safe_segment` — and rewrite the link to the returned `assets/<stamp>-<name>`. The same source file
   referenced twice is copied once.
6. Topic = the file stem through `safe_segment`. **If that topic already exists, the file is skipped
   and named in the report.** Nothing is overwritten: a note is the one thing here that cannot be
   regenerated.
7. Write through `notes::write` (atomic, sibling + rename), then `tracing::info!(project, topic,
   images, skipped, "notes import")`.

A folder is every `.md` **directly inside it**, each one through the steps above. Not recursive:
subfolders would have to be flattened (collisions) or mapped to nested projects (a naming policy
nobody asked for). The referenced-images rule picks up `assets/`, `images/`, `note.assets/` and
anything else *because they sit inside the folder* — no special case, no list of blessed directory
names.

## Step 4 is a security boundary, not tidiness

A markdown file is content that arrives from anywhere. Without the check,
`![](/Users/steve/.ssh/id_rsa)` in an offered file copies a private key into a repository that is then
**pushed to a remote**. `rule:security` states the defence in general terms — canonicalise a
user-supplied path and verify it against an allowed root — and this is its concrete case.

The complement matters too: **an image nobody references is not copied.** Sweeping in a whole folder
would import files that `images::orphans` then reports as unreferenced, which is a mess the user did
not make.

## Nothing is silent

The result panel names, per file: imported (with how many images), skipped because the topic exists,
skipped because it is not markdown; and per image: skipped because it lies outside the note's folder.
A toast would not carry that, and dropping it would be exactly the silent partial success
`rule:logging` forbids.

## Files

| File | What |
| --- | --- |
| `src-tauri/src/notes/import.rs` **new** | The whole mechanism, unit-tested against a `tempfile` directory — never a real notes root (`rule:testing`). |
| `src-tauri/src/notes/mod.rs` | `pub mod import;` and the module note extended with the read-source-vs-write-target distinction. |
| `src-tauri/src/commands/notes.rs` | `notes_import(project)` — opens the picker, imports, returns the report. Off the main thread through the existing helper. |
| `src-tauri/src/dto.rs` | `NoteImportReport` / `NoteImportEntry` with `ts-rs`; `npm run gen:types` regenerates `src/bindings/`. |
| `src-tauri/Cargo.toml` + `Cargo.lock` | `tauri-plugin-dialog = "=2.7.2"`, exact pin like every other direct dependency. |
| `src-tauri/src/lib.rs` | Register the plugin. |
| `src/api/notes.ts` | `import: (project) => invoke<NoteImportReport>("notes_import", { project })`. |
| `src/components/tools/NotesTool.tsx` | The menu entry and the result panel. |
| `src/components/settings/ThemeControls.tsx` | The theme import button; the dead drop zone removed. |
| `src/i18n/en.ts` + `de.ts` | The import strings. |
| `docs/adr/project/proj-004-notes-egress-and-trust.md` | See below. |

## ADR-PROJ-004 is amended in the same change

The threat model gains a row, and the import is recorded where the rest of the notes' trust boundary
lives:

| Abuse case | Defence |
| --- | --- |
| An offered markdown file referencing `/Users/…/.ssh/id_rsa` — the copy would be **pushed** | Only references that canonicalise under the source file's own directory are copied; anything else keeps its link, is not read, and is named in the report. |

And a paragraph stating that the import reads a path the **user** chose in a native picker opened by
the backend, that the path never enters the webview, and that the write target is still derived in
Rust and nowhere else — so the rule the ADR already carries is unchanged rather than excepted.

---

# Order of work

1. **The offset contract.** A failing Rust test with a German note over a task item; fix if it
   confirms. Everything after this depends on the unit being known.
2. **Follow's pure core** — `followScroll.ts` + its tests, no DOM.
3. **`MarkdownEditor`** — per-line spans in the uncoloured fallback.
4. **The lens and the split** — store, view, splitter, i18n, tests.
5. **`notes::import`** — Rust, test-first against a temp directory.
6. **The dialog plugin, the command, the DTO, `gen:types`.**
7. **The tool menu, the result panel, the theme import button, the drop-zone removal.**
8. **ADR-PROJ-004** amended; `npm run governance:sync` + `governance:check`.
9. **`npm run check:all` green**, then a **visual** confirmation of the split at the scale the defect
   would appear (`rule:ui-design`: a wrong split, a drifting follow and a misplaced toolbar all render
   as *something*, and no gate can see any of them).

Two features, two commits, `feat:` each — so two minor bumps through
`npm version minor --no-git-tag-version`, each riding in its own commit (`rule:versioning`). No tag,
no release: that is the maintainer's word alone.

**The app is not restarted by the agent.** YggShell is the terminal this session runs in
(`rule:live-app`); the build is produced and the maintainer decides when to install it.
