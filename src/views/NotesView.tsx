import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, ExternalLink, Link2, Link2Off } from "lucide-react";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { ImageViewer, ZoomableImage } from "../components/ui/ImageViewer";
import { Markdown } from "../components/ui/Markdown";
import { MarkdownEditor } from "../components/ui/MarkdownEditor";
import { Splitter } from "../components/ui/Splitter";
import { MarkdownToolbar } from "../components/notes/MarkdownToolbar";
import { applyConstruct, type Construct } from "../lib/markdownInsert";
import { useDetailScheme } from "../hooks/useDetailScheme";
import { useFollowScroll } from "../hooks/useFollowScroll";
import { lineIndexAt, lineStarts } from "../lib/followScroll";
import { surfaceStyle } from "../lib/schemeSurface";
import { api } from "../api/commands";
import { notesApi } from "../api/notes";
import { copyText } from "../lib/clipboard";
import { useContentFontSize } from "../hooks/useContentFontSize";
import { useEscapeToTerminal } from "../hooks/useEscapeToTerminal";
import { toDataUrl } from "../lib/dataUrl";
import { setNoteFlush } from "../lib/noteDraft";
import { useT } from "../hooks/useT";
import { useToastStore } from "../store/toast";
import { NOTES_SPLIT_MAX, NOTES_SPLIT_MIN, useUiStore, type NotesLens } from "../store/ui";

/** How long after the last keystroke the note is written. */
const SAVE_MS = 600;

/**
 * Narrower than this and two panes are two slivers, so the split is offered and refused rather than
 * quietly rendered as something else.
 */
const SPLIT_MIN_WIDTH = 560;

/**
 * How much is left above a place the tool sent us to.
 *
 * Not flush with the top edge: a line pinned to the very top has lost the heading or the sentence
 * that told you what it belongs to, and finding *that* again is the same hunt in the other direction.
 */
const MARGIN = 48;

/**
 * One note, in full — the detail half of the tool beside it.
 *
 * **Three lenses, and you are always in exactly one.** READ is rendered markdown and is never
 * accidentally editable; WRITE is the whole file as raw text, which is how markdown is actually
 * written; SPLIT is both at once, source on the left, rendering on the right, tied together so they
 * point at the same place.
 *
 * **A pane is always wholly one thing**, and that is the line the earlier design crossed. Editing
 * each block in place was built first and rejected by the maintainer, rightly: it left the page
 * looking rendered while parts of it were not, and fought you the moment you sat down to write. A
 * split is the opposite — neither half pretends to be the other. Clicking a block while reading is
 * still not a third state: it opens an editor with the caret at that block's source, which is what
 * the parser's offsets are for.
 *
 * **There is no save.** Writing persists debounced, like every other setting in this app, so
 * switching lens costs nothing and there is nothing to lose. Leaving the editor commits immediately,
 * and so does leaving the note.
 */
export function NotesView() {
  const note = useUiStore((s) => s.note);
  const project = note?.project ?? "_inbox";
  const topic = note?.topic ?? "inbox";

  // **A different note is a different document.** Keyed, so opening one drops the previous one's
  // component state outright — rather than an effect that clears the draft when the topic changes,
  // which is the `set-state-in-effect` pattern the lint rejects and which renders one frame showing
  // the wrong note's text before correcting itself.
  return <NoteDocument key={`${project}/${topic}`} project={project} topic={topic} />;
}

function NoteDocument({ project, topic }: { project: string; topic: string }) {
  const t = useT();
  // **A reading surface**, like the diff and the commit beside it — so it follows the terminal's
  // size, not the tool column's. Writing a note and reading one are the same act as reading a
  // terminal; a dense list of paths is not, which is why the two settings hold different numbers.
  // Independent of the UI scale through the hook (`useContentFontSize`).
  const fontSize = useContentFontSize();
  const qc = useQueryClient();
  const note = useUiStore((s) => s.note);
  const setView = useUiStore((s) => s.setView);
  const openNote = useUiStore((s) => s.openNote);
  const storedLens = useUiStore((s) => s.notesLens);
  const setLens = useUiStore((s) => s.setNotesLens);
  const share = useUiStore((s) => s.notesSplit);
  const setShare = useUiStore((s) => s.setNotesSplit);
  const following = useUiStore((s) => s.notesFollow);
  const setFollowing = useUiStore((s) => s.setNotesFollow);

  const [draft, setDraft] = useState<string | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLPreElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const panes = useRef<HTMLDivElement>(null);
  const caret = useRef<number | null>(null);

  /**
   * Whether there is room for two panes.
   *
   * Measured rather than assumed: this view fills the window, and the window is the user's. Offering
   * a split that cannot be used is worse than not offering it — the control would appear to do
   * nothing.
   */
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const box = panes.current;
    if (box === null) return;
    const measure = () => {
      setWide(box.clientWidth >= SPLIT_MIN_WIDTH);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, []);

  /**
   * The colour schemes this view is drawn in — one for reading, one for writing.
   *
   * **A note is content, not chrome**, and it gets a scheme for the same reason it already got the
   * terminal's font size (`rule:content-size`): it is monospace text read like terminal output, and
   * drawing it in the HUD palette while the terminal beside it is Solarized is the app deciding it
   * knows better. Diffs and commits have had this since they were built; notes were the gap.
   *
   * **Two, because reading and writing are two activities.** Rendered markdown and its source are not
   * the same thing to look at, and somebody may well want more contrast for one — the same split that
   * lets a commit differ from a diff. The split lens is the first place both are on screen together,
   * which is the case they were built for. Configured in Settings › Theme; either left empty follows
   * the next step of the chain (`detailThemeId`).
   *
   * `null` for the pane: this view replaces the page rather than sitting over one terminal, so there
   * is no tab whose scheme it should borrow.
   */
  const readScheme = useDetailScheme(null, "notes");
  const editScheme = useDetailScheme(null, "notesEdit");

  /**
   * The lens actually drawn.
   *
   * **Derived, not set from an effect.** The tool's "edit this entry" opens the note asking for the
   * caret, and a caret needs an editor to sit in — so a stored `read` yields to it for as long as
   * that stands. Turning it into `setLens("write")` inside an effect is the `set-state-in-effect`
   * pattern the lint rejects, rightly: it renders once in the wrong state and then corrects itself.
   * Reading the request as the state means the first frame is already right.
   *
   * **Only `edit` does that, not any offset.** Pressing a todo in the list asks to be *shown* the
   * place; it used to force the editor open as well, because an offset meant both things at once —
   * so looking at an entry put you in a text field you had not asked for.
   *
   * A narrow window collapses `split` to the editor rather than to reading: the user asked to write.
   */
  const lens: NotesLens =
    storedLens === "read" && note?.edit === true
      ? "write"
      : storedLens === "split" && !wide
        ? "write"
        : storedLens;
  const editing = lens !== "read";
  const rendering = lens !== "write";

  const content = useQuery({
    queryKey: ["notes-note", project, topic],
    queryFn: () => notesApi.read(project, topic),
  });

  const text = draft ?? content.data ?? "";

  /**
   * Put a pasted image into the repository and give back the path to write in the markdown.
   *
   * The bytes go through the backend rather than the webview writing a file, for the same reason the
   * reading side does: this application has no filesystem capability in the webview at all, and
   * pasting a screenshot is not a reason to open one.
   */
  const addImage = useMutation({
    mutationFn: async (file: File) => {
      const bytes = [...new Uint8Array(await file.arrayBuffer())];
      const name = file.name === "" ? "pasted.png" : file.name;
      return notesApi.addImage(project, name, bytes);
    },
    onError: (error: unknown) => {
      console.warn("could not add the image to the note", error);
      useToastStore.getState().notify("notes.imageFailed", "error");
    },
  });

  const save = useMutation({
    mutationFn: (next: string) => notesApi.write(project, topic, next),
    onSuccess: (_result, written) => {
      void qc.invalidateQueries({ queryKey: ["notes-content"] });
      void qc.invalidateQueries({ queryKey: ["notes-note"] });
      // **Let go of the draft once it is the file.** `text` reads `draft ?? content.data`, so a draft
      // that is never released makes the editor blind to the file for as long as it stays open —
      // which is the reported half where ticking a checkbox in the tool appeared nowhere until you
      // left the note and came back. Only when nothing has been typed since: comparing against the
      // text actually written is what keeps this from snatching a sentence out from under the user.
      setDraft((current) => (current === written ? null : current));
    },
    // A write that failed used to go nowhere at all. A note is the one thing in this app that cannot
    // be regenerated, so "it looked like it saved" is the worst possible failure mode
    // (`rule:logging`: every caught error is logged AND surfaced).
    onError: (error: unknown) => {
      console.warn("could not save the note", error);
      useToastStore.getState().notify("notes.saveFailed", "error");
    },
  });

  // Debounced, and only once something has been typed: a save on every keystroke would be a commit
  // per character once the sync is on.
  //
  // **And while that debounce is counting, this editor owns the note** (`lib/noteDraft`). The tool's
  // checkbox toggles the same file by byte offset; without this the debounced write lands after the
  // toggle, carrying the old checkbox, and the tick is silently undone. Registering a flush lets the
  // tool write out these keystrokes first and then work from the file that results.
  useEffect(() => {
    if (draft === null) return;
    setNoteFlush(project, topic, async () => {
      await save.mutateAsync(draft);
    });
    const timer = setTimeout(() => {
      save.mutate(draft);
    }, SAVE_MS);
    return () => {
      clearTimeout(timer);
      setNoteFlush(project, topic, null);
    };
    // `save` is a stable mutation object; including it would re-arm the timer on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, project, topic]);

  /**
   * The last text typed, for the way out.
   *
   * Leaving the note — another note, another view, the window closing — can happen inside the 600 ms
   * the debounce is still counting, and the component is gone before its timer fires. A ref, because
   * the cleanup below runs once and would otherwise close over the draft as it was on mount.
   */
  const pending = useRef<string | null>(null);
  useEffect(() => {
    pending.current = draft;
  }, [draft]);
  useEffect(
    () => () => {
      const last = pending.current;
      if (last === null) return;
      notesApi.write(project, topic, last).then(
        () => {
          void qc.invalidateQueries({ queryKey: ["notes-content"] });
        },
        (error: unknown) => {
          console.warn("could not save the note on the way out", error);
          useToastStore.getState().notify("notes.saveFailed", "error");
        },
      );
    },
    [project, topic, qc],
  );

  const follow = useFollowScroll({
    enabled: following && lens === "split",
    source: text,
    editor,
    mirror,
    preview,
  });

  // Escape leaves — the editor first, then the view. Two presses at most from anywhere in here, and
  // neither of them is something to know in advance.
  //
  // **This used to be written out here, and that is how Settings and Logs came to have no way out
  // at all**: a behaviour living inside one component is a behaviour the next one does not inherit.
  // It is a shared hook now, and the two views that were missing it call it too (ADR-CORE-005).
  useEscapeToTerminal(!editing);

  // Put the caret where the user pointed, once the editor exists — either the block whose "edit
  // here" they pressed, or the entry the tool sent them in on.
  useEffect(() => {
    if (!editing) return;
    const at = caret.current;
    if (at === null) return;
    caret.current = null;
    const area = editor.current;
    if (area === null) return;
    area.focus();
    area.setSelectionRange(at, at);
    follow.followCaret();
    // `follow` is rebuilt every render and holds no state of its own; including it would re-run this
    // on every keystroke and drag the caret back to where writing started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  /**
   * Bring the place the tool sent us to into view — **in whichever panes are showing**.
   *
   * The missing half of "open this entry". The offset arrived, the caret was set, and nothing moved:
   * `setSelectionRange` does not scroll a textarea, and the rendered side was never told at all. So
   * pressing a todo opened the note at the top and left the line to be found by reading — which is
   * exactly the work pressing it was meant to save.
   *
   * Done **once per request**, not on every render: after this the scroll position is the user's, and
   * a note that jumped back to the entry on every keystroke would be unusable. The guard is the
   * request itself — project, topic and offset — so opening the same note at a different place works,
   * and opening the same place twice does not fight a scroll made in between.
   */
  const arrivedAt = useRef<string | null>(null);
  useEffect(() => {
    const at = note?.at ?? null;
    if (at === null || text === "") return;
    const request = `${project}/${topic}/${String(at)}`;
    if (arrivedAt.current === request) return;
    arrivedAt.current = request;

    // The caret, when the caret is what was asked for. **Here rather than in its own effect**,
    // because it has to wait for the same thing: the note arrives over IPC, and a `setSelectionRange`
    // issued while the field is still empty is clamped to nothing — then the text lands, the
    // controlled value changes, and the caret ends up at the end of the document instead.
    if (note?.edit === true) {
      const area = editor.current;
      if (area !== null) {
        area.focus();
        area.setSelectionRange(at, at);
      }
    }

    // The rendered side: every block carries its source range, so the one holding the offset is the
    // one to bring up. `lineIndexAt` is the same "last start at or before" search the follow uses.
    const view = preview.current;
    if (view !== null) {
      const blocks = [...view.querySelectorAll<HTMLElement>("[data-md-start]")];
      const found = blocks.at(
        lineIndexAt(
          at,
          blocks.map((node) => Number(node.dataset.mdStart)),
        ),
      );
      // A little above the top edge, so the line is not flush against it with its context cut off.
      if (found !== undefined) view.scrollTop = Math.max(0, found.offsetTop - MARGIN);
    }

    // The editor: the mirror knows where each line was drawn, which is the only pixel-accurate
    // source position there is here (`lib/followScroll`).
    const area = editor.current;
    const pre = mirror.current;
    if (area !== null && pre !== null) {
      const line = lineIndexAt(at, lineStarts(text));
      const span = [...pre.querySelectorAll<HTMLElement>("[data-md-line]")].at(line);
      if (span !== undefined) area.scrollTop = Math.max(0, span.offsetTop - MARGIN);
    }
  }, [project, topic, note?.at, note?.edit, text, lens]);

  /**
   * The selection to restore once an insert has re-rendered the editor.
   *
   * **A controlled `<textarea>` loses the caret on every render**, so a button that changes the text
   * has to put the caret back — and it can only do that after the new value is on screen. Separate
   * from the effect above on purpose: that one answers *where writing begins*, which happens once
   * when the editor opens; this one runs after each insert, and there is no set of dependencies that
   * means both without one of them firing when it should not.
   */
  const afterInsert = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    const at = afterInsert.current;
    if (at === null) return;
    afterInsert.current = null;
    const area = editor.current;
    if (area === null) return;
    area.focus();
    area.setSelectionRange(at.start, at.end);
  });

  /**
   * Put a markdown construct in at the caret.
   *
   * The editor is the source of the selection, not React state: the textarea knows where the caret
   * is between renders and a mirrored copy would be one keystroke behind.
   */
  const insert = (construct: Construct) => {
    const area = editor.current;
    if (area === null) return;
    const out = applyConstruct(text, area.selectionStart, area.selectionEnd, construct);
    afterInsert.current = { start: out.start, end: out.end };
    setDraft(out.value);
  };

  /**
   * Change lens.
   *
   * Leaving the editor commits at once rather than waiting out the debounce — the one thing the old
   * two-state toggle got right and had to be named after ("save"). A segmented control does not need
   * that name: three options that each say which lens you land in, with the current one filled, is
   * unambiguous in a way a single button labelled with its own opposite never was.
   */
  const pick = (next: NotesLens) => {
    if (next === "read" && draft !== null) save.mutate(draft);
    // Clears the offset the tool sent, or `lens` would stay derived away from what was picked and
    // reading would be unreachable — the state has one source and this is where it is put back.
    if (note !== null && note.at !== null) openNote(note.project, note.topic);
    setLens(next);
  };

  /** Open an editor at a block the reader pointed at. */
  const writeAt = (at: number) => {
    caret.current = at;
    // From the split, the editor is already there and only the caret moves. From reading, the whole
    // page becomes the editor — the same jump this control has always made.
    if (lens === "read") setLens("write");
    else {
      const area = editor.current;
      if (area !== null) {
        area.focus();
        area.setSelectionRange(at, at);
        follow.followCaret();
      }
    }
  };

  const toShare = (clientX: number) => {
    const box = panes.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return share;
    return ((clientX - box.left) / box.width) * 100;
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-cyan/15 flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        {/* **The way out.** The plan said "back is the rail, like every other view", and that was not
            enough: reported as "kein Stück Pfeil, nichts, kein close view, kein esc". A view you can
            enter with one press and only leave by knowing where else to click is a trap, however
            consistent it is with the others. Escape does the same, below. */}
        <IconButton
          label={t("common.back")}
          variant="ghost"
          className="h-5 w-5 shrink-0"
          onClick={() => {
            setView("terminal");
          }}
        >
          <ArrowLeft size={13} aria-hidden />
        </IconButton>
        <span className="text-dim min-w-0 flex-1 truncate font-mono text-[11px]">
          {project} · {topic}
        </span>
        <span className="text-dim/60 hidden font-mono text-[10px] sm:inline">
          {editing ? t("notes.editHint") : ""}
        </span>

        {/* The follow switch belongs to the split and appears with it: a control that is on screen
            while it can do nothing is a control the user tries once and stops believing. */}
        {lens === "split" ? (
          <IconButton
            label={t("notes.follow")}
            variant="ghost"
            accent={following ? "green" : "cyan"}
            active={following}
            className="h-5 w-5 shrink-0"
            aria-pressed={following}
            onClick={() => {
              setFollowing(!following);
            }}
          >
            {following ? <Link2 size={12} aria-hidden /> : <Link2Off size={12} aria-hidden />}
          </IconButton>
        ) : null}

        <div role="group" aria-label={t("notes.lens.label")} className="flex shrink-0 gap-px">
          {(["read", "split", "write"] as const).map((option) => (
            <Button
              key={option}
              variant="ghost"
              accent={option === lens ? "green" : "cyan"}
              active={option === lens}
              aria-pressed={option === lens}
              disabled={option === "split" && !wide}
              tooltip={option === "split" && !wide ? t("notes.lens.tooNarrow") : undefined}
              onClick={() => {
                pick(option);
              }}
            >
              {t(`notes.lens.${option}`)}
            </Button>
          ))}
        </div>
      </header>

      <div ref={panes} className="flex min-h-0 flex-1">
        {editing ? (
          // `relative`, because the toolbar floats INSIDE this area: it anchors to the editor rather
          // than to the page, so it stays put while the text scrolls under it.
          //
          // `scheme-surface` is what APPLIES the variables `surfaceStyle` sets — without it the nine
          // custom properties are declared and nothing reads them, which looks exactly like no theme.
          <div
            className="scheme-surface relative flex min-h-0 min-w-0"
            style={{
              ...surfaceStyle(editScheme, fontSize),
              width: rendering ? `${String(share)}%` : "100%",
            }}
          >
            <MarkdownEditor
              ref={editor}
              onMirror={(node) => {
                mirror.current = node;
              }}
              label={t("notes.editor")}
              value={text}
              onChange={setDraft}
              scheme={editScheme}
              fontSize={fontSize}
              onScroll={follow.onEditorScroll}
              onKeyUp={follow.followCaret}
              onClick={follow.followCaret}
              onKeyDown={(event) => {
                if (event.key === "Escape") pick("read");
              }}
              // **Paste an image and it becomes part of the note.** The clipboard is where a screenshot
              // is, so this is where one arrives; the file is copied INTO the repository and the note
              // refers to it relatively, because a note pointing at ~/Desktop is broken on the second
              // machine and again the day the desktop is tidied (ADR-PROJ-004).
              onPaste={(event) => {
                const file = [...event.clipboardData.items]
                  .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                  .map((item) => item.getAsFile())
                  .find((f): f is File => f !== null);
                if (file === undefined) return;
                event.preventDefault();
                const at = event.currentTarget.selectionStart;
                void addImage.mutateAsync(file).then((rel) => {
                  setDraft(`${text.slice(0, at)}![](${rel})${text.slice(at)}`);
                });
              }}
            />
            <MarkdownToolbar onPick={insert} />
          </div>
        ) : null}

        {editing && rendering ? (
          <Splitter
            label={t("notes.splitter")}
            value={share}
            min={NOTES_SPLIT_MIN}
            max={NOTES_SPLIT_MAX}
            onChange={setShare}
            toValue={toShare}
          />
        ) : null}

        {rendering ? (
          // **Reading is reading.** The first version turned the whole surface into a click target that
          // switched to writing, and it fought everything the text contains — a link, a checkbox, the
          // copy control, selecting a sentence. Reported, and the maintainer is right: an explicit
          // affordance says what it does and takes nothing away. Each block carries its own "edit here"
          // beside its copy control, and the header carries the lens.
          <div
            ref={preview}
            onScroll={follow.onPreviewScroll}
            className="scheme-surface min-h-0 min-w-0 flex-1 overflow-auto px-3 py-2"
            style={surfaceStyle(readScheme, fontSize)}
          >
            {text.trim() === "" ? (
              <p className="text-dim font-mono text-[11px]">{t("notes.none")}</p>
            ) : (
              <Markdown
                source={text}
                // A fenced block is coloured by the language it names — ```bash and ```python are two
                // different things to read, and the parser had the tag all along.
                scheme={readScheme}
                // A copy control per block, the way documentation sites do it. The point of the tool is
                // handing something over; "select the code fence with the mouse without catching the
                // line above it" is the friction that decides whether it gets used.
                onCopyBlock={(block) => {
                  copyText(block, "clipboard.note");
                }}
                onEditBlock={writeAt}
                // `[see](tmux.md)` opens that note. It is not a URL and never was — sending it to
                // `open_external` gets it refused for not being http(s), which is correct of that guard
                // and useless to a reader. A target with a slash names another project's file.
                onLocalLink={(target) => {
                  const clean = target.replace(/\.md$/, "");
                  const at = clean.lastIndexOf("/");
                  if (at === -1) openNote(project, clean);
                  else openNote(clean.slice(0, at), clean.slice(at + 1));
                }}
                // rule:content-size — a note reads like a terminal, and the size the user chose for
                // the terminal is the size they need for this. On the scroll region, once, rather than
                // on every block: a size repeated per element is one that gets forgotten on the sixth.
                style={{ fontSize: `${String(fontSize)}px` }}
                className={lens === "split" ? "" : "max-w-3xl"}
                image={(src, alt) => <NoteImage project={project} src={src} alt={alt} />}
              />
            )}
          </div>
        ) : null}
      </div>

      {lens === "write" ? null : <BlockActions text={text} />}
    </div>
  );
}

/**
 * An image in a note.
 *
 * **From the repository: simply shown.** That is the normal case and the point of pasting a
 * screenshot into a note. It is read through a backend command rather than by the webview, because
 * this app has no `assetProtocol` capability at all — showing a screenshot does not widen the
 * sandbox (ADR-PROJ-004).
 *
 * **From the network: never on render, and only ever by the BACKEND.** Rendering `![](https://…)`
 * would call a stranger's server the moment the note is read, which is exactly what a tracking pixel
 * counts on, and reading a note is not consent to that. Pressing *load* fetches it once, in Rust,
 * https-only with a timeout — so the webview still opens no connection of its own and the request
 * carries neither a referrer nor a user agent anywhere (ADR-PROJ-004).
 */
function NoteImage({ project, src, alt }: { project: string; src: string; alt: string }) {
  const t = useT();
  const remote = src.includes("://");
  const [load, setLoad] = useState(false);
  const [viewing, setViewing] = useState(false);
  const close = () => {
    setViewing(false);
  };

  /**
   * `![]()` is what the toolbar's own Image button writes, for the user to fill in.
   *
   * So a note holding an image with no path is the ordinary half-finished case, and asking the
   * backend to read `""` — which resolves to the project *directory* — is a failing IPC call per
   * render, logged once a second, about a picture nobody has chosen yet. The backend refuses it too
   * (`images::read`); this is the half that stops it being asked.
   */
  const named = src.trim() !== "";

  const data = useQuery({
    queryKey: ["note-image", project, src, load],
    // Local: read at once. Remote: only after the user has pressed — the whole point.
    enabled: named && (!remote || load),
    queryFn: async () => {
      const bytes = remote
        ? await notesApi.fetchImage(src)
        : await notesApi.readImage(project, src);
      // A note's image keeps the wildcard type: the bytes arrive from a command that does not sniff
      // them, and the honest answer to "which type" is that this caller does not know. The file
      // viewer's command does sniff, and passes the real one (`lib/dataUrl`).
      return toDataUrl(bytes, "image/*");
    },
  });

  // An image that names nothing draws its alt text, like any image that cannot be shown. Silent
  // would be wrong — the `![]()` is in the source and the reader should see that something is meant
  // to be here.
  if (!named) return <span className="text-dim/70">{alt}</span>;

  if (remote && data.data === undefined) {
    return (
      <span className="border-dim/30 my-1 inline-flex items-center gap-2 border px-2 py-1">
        <span className="text-dim min-w-0 truncate font-mono text-[10px]">
          {data.isError ? String(data.error) : t("notes.remoteImage")}
        </span>
        {/* Fetched by the BACKEND when this is pressed — the webview opens no connection either way. */}
        <Button
          variant="ghost"
          className="shrink-0 px-1 py-0 text-[10px]"
          disabled={data.isFetching}
          onClick={() => {
            setLoad(true);
          }}
        >
          {t("notes.loadImage")}
        </Button>
        <IconButton
          label={t("notes.openInBrowser")}
          variant="ghost"
          className="h-4 w-4 shrink-0"
          onClick={() => {
            void api.openExternal(src).catch((error: unknown) => {
              console.warn("could not open the image", error);
            });
          }}
        >
          <ExternalLink size={11} aria-hidden />
        </IconButton>
      </span>
    );
  }

  // Too large to inline is not "gone": the viewer holds one image rather than all of them, so it is
  // allowed a bigger one, and this is the way in. Without this the picture is in the repository, in
  // the note, and unreachable — which is what an import of a photograph produced.
  if (data.data === undefined) {
    return (
      <>
        <Button
          variant="ghost"
          className="my-1 px-1 py-0 text-[10px]"
          onClick={() => {
            setViewing(true);
          }}
        >
          {data.isError ? t("notes.openImage") : alt}
        </Button>
        {viewing ? <NoteImageViewer project={project} src={src} alt={alt} onClose={close} /> : null}
      </>
    );
  }

  return (
    <>
      {/* **The picture is the control.** A note's images are drawn at the column's width, which is
          right for reading and useless for looking — a screenshot of a stack trace arrives
          unreadable and a Retina capture at half its pixels. Clicking opens the viewer; the note
          itself is left exactly as it was, because enlarging in place pushes the text off the
          screen (`components/ui/ImageViewer`). */}
      <ZoomableImage
        src={data.data}
        alt={alt}
        label={t("notes.openImage")}
        className="my-2 max-w-full"
        onOpen={() => {
          setViewing(true);
        }}
      />
      {viewing ? <NoteImageViewer project={project} src={src} alt={alt} onClose={close} /> : null}
    </>
  );
}

/**
 * The viewer, with the image loaded at the viewer's own ceiling rather than the note's.
 *
 * Split out so the bigger read happens **only when somebody opens one** — a note full of pictures
 * must not fetch every one of them twice on the chance that one gets clicked.
 */
function NoteImageViewer({
  project,
  src,
  alt,
  onClose,
}: {
  project: string;
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const t = useT();
  const remote = src.includes("://");

  const data = useQuery({
    queryKey: ["note-image-large", project, src],
    queryFn: async () => {
      const bytes = remote
        ? await notesApi.fetchImage(src)
        : await notesApi.readImageLarge(project, src);
      return toDataUrl(bytes, "image/*");
    },
  });

  if (data.data === undefined) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85">
        <p className="text-dim font-mono text-[11px]">
          {data.isError ? String(data.error) : t("notes.loadingImage")}
        </p>
      </div>
    );
  }

  return (
    <ImageViewer
      src={data.data}
      alt={alt}
      caption={src}
      onClose={onClose}
      labels={{
        // "Back", not "Close" — the control is the same back arrow this view's own header carries,
        // in the same place, because a viewer is a surface you leave rather than a window you shut.
        back: t("common.back"),
        zoomIn: t("notes.zoomIn"),
        zoomOut: t("notes.zoomOut"),
        fit: t("notes.zoomFit"),
        actual: t("notes.zoomActual"),
      }}
    />
  );
}

/**
 * Copy the whole note.
 *
 * **There is no "type into the terminal", anywhere**, and that reverses what the plan called the
 * reason this tool exists. The maintainer's own description of what the notes are for is what
 * settles it: they hold prompts and instructions prepared to be *sent later*, and todos to be
 * ticked. Handing one over is copying a block and pasting it where it belongs — a decision made
 * where the paste happens, by a person, not a channel that types into whichever shell is in front.
 *
 * The per-block controls above are the ones that matter; this is the whole-document case.
 */
function BlockActions({ text }: { text: string }) {
  const t = useT();

  return (
    <footer className="border-cyan/15 flex shrink-0 items-center justify-end gap-2 border-t px-3 py-1">
      <Button
        variant="ghost"
        onClick={() => {
          copyText(text, "clipboard.note");
        }}
      >
        <Copy size={11} aria-hidden className="mr-1 inline" />
        {t("notes.copy")}
      </Button>
    </footer>
  );
}
