import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, ExternalLink } from "lucide-react";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { Markdown } from "../components/ui/Markdown";
import { TextArea } from "../components/ui/TextArea";
import { api } from "../api/commands";
import { notesApi } from "../api/notes";
import { copyText } from "../lib/clipboard";
import { useContentFontSize } from "../hooks/useContentFontSize";
import { useT } from "../hooks/useT";
import { useUiStore } from "../store/ui";

/** How long after the last keystroke the note is written. */
const SAVE_MS = 600;

/**
 * One note, in full — the detail half of the tool beside it.
 *
 * **Two states, and you are always in exactly one.** LESEN is rendered markdown and is never
 * accidentally editable; SCHREIBEN is the whole file as raw text, which is how markdown is actually
 * written. Clicking a block while reading is not a third state: it switches to writing with the caret
 * at that block's source, which is what the parser's byte ranges are for.
 *
 * The alternative — editing each block in place — was built first and rejected by the maintainer, and
 * the objection was right: it is neither of the two things, leaving the page looking rendered while
 * parts of it are not, and fighting you the moment you actually sit down to write.
 *
 * **There is no save.** Writing persists debounced, like every other setting in this app, so switching
 * back costs nothing and there is nothing to lose. A save button would make two states feel like a
 * commitment; they are a lens.
 */
export function NotesView() {
  const t = useT();
  const fontSize = useContentFontSize();
  const qc = useQueryClient();
  const note = useUiStore((s) => s.note);
  const setView = useUiStore((s) => s.setView);
  const openNote = useUiStore((s) => s.openNote);
  const project = note?.project ?? "_inbox";
  const topic = note?.topic ?? "inbox";

  const [writingHere, setWritingHere] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);

  /**
   * Whether the editor is showing.
   *
   * **Derived, not set from an effect.** The tool's "edit this entry" opens the note WITH an offset,
   * and turning that into `setWriting(true)` inside an effect is the `set-state-in-effect` pattern the
   * lint rejects — rightly: it renders once in the wrong state and then corrects itself. Reading the
   * offset as the state means the first frame is already right.
   */
  const writing = writingHere || note?.at != null;

  const content = useQuery({
    queryKey: ["notes-note", project, topic],
    queryFn: () => notesApi.read(project, topic),
  });

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
  });

  const save = useMutation({
    mutationFn: (text: string) => notesApi.write(project, topic, text),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notes-content"] });
      void qc.invalidateQueries({ queryKey: ["notes-note"] });
    },
  });

  // Debounced, and only while writing: a save on every keystroke would be a commit per character once
  // the sync is on.
  useEffect(() => {
    if (draft === null) return;
    const timer = setTimeout(() => {
      save.mutate(draft);
    }, SAVE_MS);
    return () => {
      clearTimeout(timer);
    };
    // `save` is a stable mutation object; including it would re-arm the timer on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Escape leaves — the writing state first, then the view. Two presses at most from anywhere in
  // here, and neither of them is something to know in advance.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (writing) return; // the editor handles its own Escape, which returns to reading
      setView("terminal");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [writing, setView]);

  // Put the caret where the user pointed, once the editor exists — either the block whose "edit
  // here" they pressed, or the entry the tool sent them in on.
  useEffect(() => {
    if (!writing) return;
    const at = caret.current ?? note?.at ?? null;
    if (at === null) return;
    caret.current = null;
    const area = editor.current;
    if (area === null) return;
    area.focus();
    area.setSelectionRange(at, at);
  }, [writing, note?.at]);

  const text = draft ?? content.data ?? "";

  const startWriting = (at: number | null) => {
    setDraft(text);
    caret.current = at;
    setWritingHere(true);
  };

  const stopWriting = () => {
    if (draft !== null) save.mutate(draft);
    setWritingHere(false);
    setDraft(null);
    // Clears the offset the tool sent, or `writing` would stay derived-true and reading would be
    // unreachable — the state has one source and this is where it is put back.
    if (note !== null && note.at !== null) openNote(note.project, note.topic);
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
          {writing ? t("notes.editHint") : ""}
        </span>
        <Button
          variant="ghost"
          accent={writing ? "cyan" : "green"}
          onClick={() => {
            if (writing) stopWriting();
            else startWriting(null);
          }}
        >
          {/* Named after what pressing it DOES. "Read" while writing described the state you would
              land in and hid the thing that actually happens on the way there: leaving the editor
              is what commits the text. */}
          {writing ? t("notes.save") : t("notes.edit")}
        </Button>
      </header>

      {writing ? (
        <TextArea
          ref={editor}
          aria-label={t("notes.editor")}
          value={draft ?? ""}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") stopWriting();
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
              const before = (draft ?? "").slice(0, at);
              const after = (draft ?? "").slice(at);
              setDraft(`${before}![](${rel})${after}`);
            });
          }}
          style={{ fontSize: `${fontSize}px` }}
          className="min-h-0 flex-1 rounded-none border-0 font-mono leading-relaxed"
        />
      ) : (
        // **Reading is reading.** The first version turned the whole surface into a click target that
        // switched to writing, and it fought everything the text contains — a link, a checkbox, the
        // copy control, selecting a sentence. Reported, and the maintainer is right: an explicit
        // affordance says what it does and takes nothing away. Each block carries its own "edit here"
        // beside its copy control, and the header carries the state toggle.
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {text.trim() === "" ? (
            <p className="text-dim font-mono text-[11px]">{t("notes.none")}</p>
          ) : (
            <Markdown
              source={text}
              // A copy control per block, the way documentation sites do it. The point of the tool is
              // handing something over; "select the code fence with the mouse without catching the
              // line above it" is the friction that decides whether it gets used.
              onCopyBlock={(block) => {
                copyText(block, "clipboard.note");
              }}
              onEditBlock={(at) => {
                startWriting(at);
              }}
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
              style={{ fontSize: `${fontSize}px` }}
              className="max-w-3xl"
              image={(src, alt) => <NoteImage project={project} src={src} alt={alt} />}
            />
          )}
        </div>
      )}

      {writing ? null : <BlockActions text={text} />}
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

  const data = useQuery({
    queryKey: ["note-image", project, src, load],
    // Local: read at once. Remote: only after the user has pressed — the whole point.
    enabled: !remote || load,
    queryFn: async () => {
      const bytes = remote
        ? await notesApi.fetchImage(src)
        : await notesApi.readImage(project, src);
      const binary = Uint8Array.from(bytes);
      let out = "";
      for (const byte of binary) out += String.fromCharCode(byte);
      return `data:image/*;base64,${btoa(out)}`;
    },
  });

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

  if (data.data === undefined) return <span className="text-dim/70">{alt}</span>;
  return <img src={data.data} alt={alt} className="my-2 max-w-full" />;
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
