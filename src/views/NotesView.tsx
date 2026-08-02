import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Terminal } from "lucide-react";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { Markdown } from "../components/ui/Markdown";
import { TextArea } from "../components/ui/TextArea";
import { api } from "../api/commands";
import { notesApi } from "../api/notes";
import { terminalApi } from "../api/terminal";
import { copyText } from "../lib/clipboard";
import { useContentFontSize } from "../hooks/useContentFontSize";
import { useT } from "../hooks/useT";
import { useTerminalStore } from "../store/terminal";
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
  const project = note?.project ?? "_inbox";
  const topic = note?.topic ?? "inbox";

  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);

  const content = useQuery({
    queryKey: ["notes-note", project, topic],
    queryFn: () => notesApi.read(project, topic),
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

  // Put the caret where the click was, once the editor exists.
  useEffect(() => {
    if (!writing || caret.current === null) return;
    const at = caret.current;
    caret.current = null;
    const area = editor.current;
    if (area === null) return;
    area.focus();
    area.setSelectionRange(at, at);
  }, [writing]);

  const text = draft ?? content.data ?? "";

  const startWriting = (at: number | null) => {
    setDraft(text);
    caret.current = at;
    setWriting(true);
  };

  const stopWriting = () => {
    if (draft !== null) save.mutate(draft);
    setWriting(false);
    setDraft(null);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-cyan/15 flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
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
          {writing ? t("notes.read") : t("notes.edit")}
        </Button>
      </header>

      {writing ? (
        <TextArea
          ref={editor}
          aria-label={t("notes.edit")}
          value={draft ?? ""}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") stopWriting();
          }}
          style={{ fontSize: `${fontSize}px` }}
          className="min-h-0 flex-1 rounded-none border-0 font-mono leading-relaxed"
        />
      ) : (
        // ONE handler for the whole document, not one per block. Every top-level block carries its
        // source range as a data attribute, so the nearest one answers "edit WHAT?" — where making
        // each block interactive would have nested a hundred buttons around the links already inside
        // them, which is both an accessibility violation and invalid HTML.
        //
        // The keyboard route is not missing: it is the "Write" control in the header, and Escape to
        // leave. This click is a SHORTCUT to a place in the text, and a keydown handler on a region
        // full of links would take Enter away from them — which would be the real accessibility
        // defect, in the name of avoiding a reported one.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
        <div
          className="min-h-0 flex-1 cursor-text overflow-auto px-3 py-2"
          onClick={(event) => {
            const block = (event.target as HTMLElement).closest<HTMLElement>("[data-md-start]");
            startWriting(block === null ? null : Number(block.dataset.mdStart ?? 0));
          }}
        >
          {text.trim() === "" ? (
            <p className="text-dim font-mono text-[11px]">{t("notes.none")}</p>
          ) : (
            <Markdown
              source={text}
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
 * **From the network: not fetched.** Rendering `![](https://…)` would call a stranger's server the
 * moment the note is read, which is exactly what a tracking pixel counts on, and reading a note is
 * not consent to that. The placeholder opens it in the user's browser instead — where a remote image
 * already belongs, with a user agent they chose.
 */
function NoteImage({ project, src, alt }: { project: string; src: string; alt: string }) {
  const t = useT();
  const remote = src.includes("://");

  const data = useQuery({
    queryKey: ["note-image", project, src],
    enabled: !remote,
    queryFn: async () => {
      const bytes = await notesApi.readImage(project, src);
      const binary = Uint8Array.from(bytes);
      let out = "";
      for (const byte of binary) out += String.fromCharCode(byte);
      return `data:image/*;base64,${btoa(out)}`;
    },
  });

  if (remote) {
    return (
      <span className="border-dim/30 my-1 inline-flex items-center gap-2 border px-2 py-1">
        <span className="text-dim font-mono text-[10px]">{t("notes.remoteImage")}</span>
        <IconButton
          label={t("notes.openInBrowser")}
          variant="ghost"
          className="h-4 w-4"
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
 * Copy the whole note, and hand it to the terminal.
 *
 * **"Type into the terminal" is the feature this tool exists for**: a note becomes a prompt without
 * touching the clipboard, through the same typed-not-run channel the file browser's `cd` uses. It
 * types; it never sends a newline, so nothing runs that the user did not press Enter on themselves
 * (ADR-PROJ-001 §5).
 */
function BlockActions({ text }: { text: string }) {
  const t = useT();
  const sessionId = useTerminalStore(
    (s) => s.panes.find((p) => p.key === s.activeKey)?.sessionId ?? null,
  );

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
      <Button
        variant="ghost"
        accent="green"
        disabled={sessionId === null}
        onClick={() => {
          if (sessionId === null) return;
          void terminalApi.write(sessionId, text).catch((error: unknown) => {
            console.warn("could not type the note into the terminal", error);
          });
        }}
      >
        <Terminal size={11} aria-hidden className="mr-1 inline" />
        {t("notes.toTerminal")}
      </Button>
    </footer>
  );
}
