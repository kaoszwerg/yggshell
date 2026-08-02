import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize2, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { TextField } from "../ui/TextField";
import { TextArea } from "../ui/TextArea";
import { notesApi } from "../../api/notes";
import { taskItems, type Task } from "../../lib/noteTasks";
import { useContentFontSize } from "../../hooks/useContentFontSize";
import { useNoteProject } from "../../hooks/useNoteProject";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../store/ui";

/**
 * The notes, as a list you can take in at a glance and tick things off.
 *
 * **The tool is the navigation; the view is the detail** (`docs/plans/notes-tool.md`). One line per
 * item — checkbox, title — and never a body, a code block, a table or an image. The moment those
 * appear in a 280 px column it stops being a list you can read at a glance, which is the objection
 * this whole surface was designed around: *"ich will auf einen Blick die aktuelle Situation erfassen
 * können, nicht durch Rumklicken."*
 *
 * **Ticking is not editing.** It rewrites `- [ ]` to `- [x]` in the file, from here, with no trip to
 * the view and no mode — by far the most frequent thing anyone does with this, and the second reason
 * the markdown parser reports byte offsets.
 *
 * **Search lives here**, because searching is navigation: it spans every project, the hits replace
 * the list, and picking one opens that note in the view.
 */
export function NotesTool() {
  const t = useT();
  const fontSize = useContentFontSize();
  const qc = useQueryClient();
  const project = useNoteProject();
  const setView = useUiStore((s) => s.setView);
  const openNote = useUiStore((s) => s.openNote);

  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);

  const topics = useQuery({
    queryKey: ["notes-topics", project],
    queryFn: () => notesApi.topics(project),
  });

  const notes = useQuery({
    queryKey: ["notes-content", project, topics.data ?? []],
    enabled: topics.data !== undefined,
    queryFn: async () => {
      const out: { topic: string; text: string }[] = [];
      for (const topic of topics.data ?? []) {
        out.push({ topic, text: await notesApi.read(project, topic) });
      }
      return out;
    },
  });

  const hits = useQuery({
    queryKey: ["notes-search", query],
    enabled: query.trim() !== "",
    queryFn: () => notesApi.search(query),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["notes-topics"] });
    void qc.invalidateQueries({ queryKey: ["notes-content"] });
  };

  const capture = useMutation({
    mutationFn: (text: string) => notesApi.capture(project, text),
    onSuccess: () => {
      setDraft("");
      refresh();
    },
  });

  const toggle = useMutation({
    mutationFn: ({ topic, offset }: { topic: string; offset: number }) =>
      notesApi.toggle(project, topic, offset),
    onSuccess: refresh,
  });

  const open = (topic: string) => {
    openNote(project, topic);
    setView("notes");
  };

  const sections = (notes.data ?? []).map((note) => ({
    topic: note.topic,
    items: taskItems(note.text),
  }));
  const doneCount = sections.reduce(
    (sum, section) => sum + section.items.filter((i) => i.done).length,
    0,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-cyan/15 flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <Search size={12} className="text-dim shrink-0" aria-hidden />
        <TextField
          aria-label={t("notes.search")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder={t("common.search")}
          className="min-w-0 flex-1"
        />
        <IconButton
          label={t("notes.open")}
          onClick={() => {
            open(topics.data?.[0] ?? "inbox");
          }}
          variant="ghost"
          className="h-5 w-5 shrink-0"
        >
          <Maximize2 size={12} aria-hidden />
        </IconButton>
        <IconButton
          label={t("common.refresh")}
          onClick={refresh}
          variant="ghost"
          className="h-5 w-5 shrink-0"
        >
          <RefreshCw size={12} aria-hidden className={notes.isFetching ? "animate-spin" : ""} />
        </IconButton>
      </header>

      {query.trim() !== "" ? null : (
        <div className="border-cyan/10 flex shrink-0 items-start gap-1 border-b px-2 py-1">
          <TextArea
            aria-label={t("notes.capture")}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            placeholder={t("notes.capture")}
            rows={draft.includes("\n") ? 3 : 1}
            // Enter files it, Shift+Enter adds a line — exactly what the maintainer already types at
            // the harness one panel over, so the same keys mean the same thing here. A one-line
            // thought and a paragraph are both ONE gesture; a staging area that costs two is one
            // people stop using within a week.
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              if (draft.trim() !== "") capture.mutate(draft);
            }}
            className="min-w-0 flex-1"
          />
          <IconButton
            label={t("notes.add")}
            onClick={() => {
              if (draft.trim() !== "") capture.mutate(draft);
            }}
            variant="ghost"
            className="mt-0.5 h-5 w-5 shrink-0"
          >
            <Plus size={12} aria-hidden />
          </IconButton>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto" style={{ fontSize: `${fontSize}px` }}>
        {query.trim() !== "" ? (
          (hits.data ?? []).length === 0 ? (
            <Note>{t("notes.none")}</Note>
          ) : (
            (hits.data ?? []).map((hit) => (
              <Row
                key={`${hit.project}:${hit.topic}:${String(hit.offset)}`}
                label={hit.line}
                onActivate={() => {
                  openNote(hit.project, hit.topic);
                  setView("notes");
                }}
                className="gap-2 px-2 font-mono"
              >
                <span className="text-dim/70 shrink-0 text-[10px]">{hit.topic}</span>
                <span className="text-fg min-w-0 flex-1 truncate">{hit.line}</span>
              </Row>
            ))
          )
        ) : sections.every((s) => s.items.length === 0) ? (
          <Note>{t("notes.none")}</Note>
        ) : (
          sections.map((section) => (
            <section key={section.topic} className="py-1">
              <h3 className="text-dim px-2 py-0.5 font-mono text-[0.56rem] tracking-[0.12em]">
                {section.topic.toUpperCase()}
              </h3>
              {section.items
                .filter((item) => !item.done)
                .map((item) => (
                  <TaskRow
                    key={item.offset}
                    item={item}
                    onToggle={() => {
                      toggle.mutate({ topic: section.topic, offset: item.offset });
                    }}
                    onOpen={() => {
                      open(section.topic);
                    }}
                  />
                ))}
            </section>
          ))
        )}

        {doneCount === 0 || query.trim() !== "" ? null : (
          <section className="py-1">
            <Button
              variant="ghost"
              className="w-full justify-start px-2 py-0.5 font-mono text-[0.56rem] tracking-[0.12em]"
              onClick={() => {
                setShowDone((on) => !on);
              }}
            >
              {showDone ? "▾ " : "▸ "}
              {t("notes.done", { count: doneCount }).toUpperCase()}
            </Button>
            {!showDone
              ? null
              : sections.map((section) =>
                  section.items
                    .filter((item) => item.done)
                    .map((item) => (
                      <TaskRow
                        key={`${section.topic}:${String(item.offset)}`}
                        item={item}
                        onToggle={() => {
                          toggle.mutate({ topic: section.topic, offset: item.offset });
                        }}
                        onOpen={() => {
                          open(section.topic);
                        }}
                      />
                    )),
                )}
          </section>
        )}
      </div>

      {capture.error === null && toggle.error === null ? null : (
        <p className="text-danger px-2 py-1 font-mono text-[10px]">
          {String(capture.error ?? toggle.error)}
        </p>
      )}
    </div>
  );
}

/** One task, as one line. Never its body — that is what the view is for. */
function TaskRow({
  item,
  onToggle,
  onOpen,
}: {
  item: Task;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <Row label={item.title} onActivate={onOpen} className="gap-1.5 px-2 font-mono">
      <IconButton
        label={t(item.done ? "notes.untick" : "notes.tick")}
        onClick={onToggle}
        variant="ghost"
        className="h-4 w-4 shrink-0"
      >
        <span aria-hidden className={item.done ? "text-green" : "text-dim/60"}>
          {item.done ? "☑" : "☐"}
        </span>
      </IconButton>
      {item.priority === 0 ? null : (
        <span aria-hidden className={item.priority === 2 ? "text-danger" : "text-gold"}>
          {item.priority === 2 ? "!!" : "!"}
        </span>
      )}
      <span
        className={`min-w-0 flex-1 truncate ${item.done ? "text-dim line-through opacity-60" : "text-fg"}`}
      >
        {item.title}
      </span>
    </Row>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-dim px-2 py-1 font-mono text-[10px]">{children}</p>;
}
