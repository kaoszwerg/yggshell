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
import { useTerminalStore } from "../../store/terminal";
import { KebabMenu } from "../ui/KebabMenu";
import { copyText } from "../../lib/clipboard";
import { terminalApi } from "../../api/terminal";

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
  const sessionId = useTerminalStore(
    (s) => s.panes.find((p) => p.key === s.activeKey)?.sessionId ?? null,
  );

  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  // **Following the front tab is right, and it cannot be the ONLY way in.** A project whose checkout
  // was moved, renamed or thrown away would otherwise have notes nobody can reach — including to
  // delete them — and simply having the wrong tab in front makes the panel look empty when it is not,
  // which is exactly what was reported. Decided in the plan and missing from the first build.
  const [everything, setEverything] = useState(false);
  const [newTopic, setNewTopic] = useState<string | null>(null);

  const allProjects = useQuery({
    queryKey: ["notes-projects"],
    queryFn: notesApi.projects,
  });
  const projects = everything ? (allProjects.data ?? []) : [project];

  const notes = useQuery({
    queryKey: ["notes-content", projects],
    queryFn: async () => {
      const out: { project: string; topic: string; text: string }[] = [];
      for (const each of projects) {
        for (const topic of await notesApi.topics(each)) {
          out.push({ project: each, topic, text: await notesApi.read(each, topic) });
        }
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
    void qc.invalidateQueries({ queryKey: ["notes-projects"] });
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
    mutationFn: ({
      project: inProject,
      topic,
      offset,
    }: {
      project: string;
      topic: string;
      offset: number;
    }) => notesApi.toggle(inProject, topic, offset),
    onSuccess: refresh,
  });

  /**
   * Remove one item from its note.
   *
   * Done by splicing the markdown and writing it back rather than by a new backend command: the
   * parser already reports the item's byte range, and a second way to edit a note is a second place
   * for the two to disagree about what an item IS (ADR-CORE-005).
   */
  const removeItem = useMutation({
    mutationFn: async (at: { project: string; topic: string; from: number; to: number }) => {
      const text = await notesApi.read(at.project, at.topic);
      const rest = text.slice(at.to).replace(/^\n/, "");
      await notesApi.write(at.project, at.topic, text.slice(0, at.from) + rest);
    },
    onSuccess: refresh,
  });

  const removeNote = useMutation({
    mutationFn: ({ project: p, topic }: { project: string; topic: string }) =>
      notesApi.remove(p, topic),
    onSuccess: refresh,
  });

  const removeProject = useMutation({
    mutationFn: (p: string) => notesApi.removeProject(p),
    onSuccess: refresh,
  });

  const addTopic = useMutation({
    mutationFn: ({ project: p, topic }: { project: string; topic: string }) =>
      notesApi.write(p, topic, `# ${topic}\n\n`),
    onSuccess: (_r, { project: p, topic }) => {
      setNewTopic(null);
      refresh();
      openNote(p, topic);
      setView("notes");
    },
  });

  const toTerminal = (text: string) => {
    const id = sessionId;
    if (id === null) return;
    void terminalApi.write(id, text).catch((error: unknown) => {
      console.warn("could not type the note into the terminal", error);
    });
  };

  const open = (inProject: string, topic: string) => {
    openNote(inProject, topic);
    setView("notes");
  };

  /** What one entry offers. "Type into the terminal" first: it is the reason this tool exists. */
  const itemActions = (inProject: string, topic: string, item: Task) => [
    {
      id: "terminal",
      label: t("notes.toTerminal"),
      disabled: sessionId === null,
      onSelect: () => {
        toTerminal(item.title);
      },
    },
    {
      id: "copy",
      label: t("notes.copy"),
      onSelect: () => {
        copyText(item.title, "clipboard.note");
      },
    },
    {
      id: "open",
      label: t("notes.openNote"),
      onSelect: () => {
        open(inProject, topic);
      },
    },
    {
      id: "delete",
      label: t("notes.delete"),
      onSelect: () => {
        removeItem.mutate({ project: inProject, topic, from: item.offset, to: item.end });
      },
    },
  ];

  /** What a topic offers: a new one beside it, and getting rid of this one or the whole project. */
  const topicActions = (inProject: string, topic: string) => [
    {
      id: "new",
      label: t("notes.newTopic"),
      onSelect: () => {
        setNewTopic("");
      },
    },
    {
      id: "delete",
      label: t("notes.deleteNote.title"),
      onSelect: () => {
        removeNote.mutate({ project: inProject, topic });
      },
    },
    {
      id: "deleteProject",
      label: t("notes.deleteProject.title"),
      onSelect: () => {
        removeProject.mutate(inProject);
      },
    },
  ];

  const sections = (notes.data ?? []).map((note) => ({
    project: note.project,
    topic: note.topic,
    // Across projects the topic alone is ambiguous — two projects both have an `inbox`.
    heading: everything
      ? `${note.project.split("/").at(-1) ?? note.project} · ${note.topic}`
      : note.topic,
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
        <Button
          variant="ghost"
          accent={everything ? "cyan" : "green"}
          className="shrink-0 px-1.5 py-0.5 text-[0.56rem] tracking-[0.12em]"
          onClick={() => {
            setEverything((on) => !on);
          }}
        >
          {everything ? t("notes.allProjects") : t("notes.thisProject")}
        </Button>
        <IconButton
          label={t("notes.open")}
          onClick={() => {
            open(sections[0]?.project ?? project, sections[0]?.topic ?? "inbox");
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

      {newTopic === null ? null : (
        <div className="border-cyan/10 flex shrink-0 items-center gap-1 border-b px-2 py-1">
          <TextField
            aria-label={t("notes.topicName")}
            ref={(el) => {
              // Focused after mount rather than with `autoFocus`, which jsx-a11y bans because it
              // steals focus on page load. Here the field appears because the user asked for it.
              el?.focus();
            }}
            value={newTopic}
            onChange={(event) => {
              setNewTopic(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setNewTopic(null);
              if (event.key !== "Enter" || newTopic.trim() === "") return;
              addTopic.mutate({ project, topic: newTopic.trim() });
            }}
            placeholder={t("notes.topicName")}
            className="min-w-0 flex-1"
          />
        </div>
      )}

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
        ) : sections.length === 0 ? (
          // **Says how a project comes about.** "Nothing here yet" answered nothing, and the first
          // question after connecting was "how do I create projects?" — they are not created, they
          // appear: a note captured while a terminal is in a repository makes one, keyed off that
          // repository's remote so it is the same folder on every machine.
          <Note>{everything ? t("notes.noneAnywhere") : t("notes.howProjects")}</Note>
        ) : (
          sections.map((section) => (
            <section key={`${section.project}:${section.topic}`} className="py-1">
              <div className="flex items-center gap-1 px-2 py-0.5">
                <h3 className="text-dim min-w-0 flex-1 truncate font-mono text-[0.56rem] tracking-[0.12em]">
                  {section.heading.toUpperCase()}
                </h3>
                <KebabMenu
                  label={t("notes.actions", { name: section.topic })}
                  items={topicActions(section.project, section.topic)}
                  size={11}
                />
              </div>
              {section.items
                .filter((item) => !item.done)
                .map((item) => (
                  <TaskRow
                    key={item.offset}
                    item={item}
                    onToggle={() => {
                      toggle.mutate({
                        project: section.project,
                        topic: section.topic,
                        offset: item.offset,
                      });
                    }}
                    onOpen={() => {
                      open(section.project, section.topic);
                    }}
                    actions={itemActions(section.project, section.topic, item)}
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
                        key={`${section.project}:${section.topic}:${String(item.offset)}`}
                        item={item}
                        onToggle={() => {
                          toggle.mutate({
                            project: section.project,
                            topic: section.topic,
                            offset: item.offset,
                          });
                        }}
                        onOpen={() => {
                          open(section.project, section.topic);
                        }}
                        actions={itemActions(section.project, section.topic, item)}
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
  actions,
}: {
  item: Task;
  onToggle: () => void;
  onOpen: () => void;
  /** What the row's `⋮` offers. Built by the caller, which is the only thing that knows the note. */
  actions: { id: string; label: string; onSelect: () => void; disabled?: boolean }[];
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
      {/* VISIBLE, and it opens on a plain click. Right-click alone is not a discoverable gesture —
          the first build had these actions and the first question was "where is the menu?". */}
      <KebabMenu label={t("notes.actions", { name: item.title })} items={actions} />
    </Row>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-dim px-2 py-1 font-mono text-[10px]">{children}</p>;
}
