import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize2, Plus, RefreshCw, Search, X } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { TextField } from "../ui/TextField";
import { TextArea } from "../ui/TextArea";
import { notesApi } from "../../api/notes";
import { taskItems, type Task } from "../../lib/noteTasks";
import { useContentFontSize } from "../../hooks/useContentFontSize";
import { useNoteProject } from "../../hooks/useNoteProject";
import { useNotesSync } from "../../hooks/useNotesSync";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../store/ui";
import { KebabMenu } from "../ui/KebabMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { copyText } from "../../lib/clipboard";
import type { NotesStatus } from "../../bindings/NotesStatus";

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
  const setNotesProject = useUiStore((s) => s.setNotesProject);

  // Opening the notes IS the moment to fetch them — and the only moment, because the shell root
  // deliberately does not: syncing at startup put a Touch ID prompt in front of the app.
  const sync = useNotesSync({ now: true });

  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  // **Following the front tab is right, and it cannot be the ONLY way in.** A project whose checkout
  // was moved, renamed or thrown away would otherwise have notes nobody can reach — including to
  // delete them — and simply having the wrong tab in front makes the panel look empty when it is not,
  // which is exactly what was reported. Decided in the plan and missing from the first build.
  const [everything, setEverything] = useState(false);
  const [newTopic, setNewTopic] = useState<string | null>(null);
  const [newProject, setNewProject] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamingTopic, setRenamingTopic] = useState<{
    project: string;
    topic: string;
    to: string;
  } | null>(null);
  /** What a confirmation is currently about. A note and a project are both asked for by name. */
  const [confirming, setConfirming] = useState<{
    kind: "note" | "project";
    project: string;
    topic: string;
  } | null>(null);

  const allProjects = useQuery({
    queryKey: ["notes-projects"],
    queryFn: notesApi.projects,
  });

  /**
   * Every file in every project — the list "move to" is built from.
   *
   * Names only, never contents: this is a menu, and reading every note in the repository to fill one
   * would make opening a menu the most expensive thing the tool does.
   */
  const allTopics = useQuery({
    queryKey: ["notes-tree", allProjects.data ?? []],
    enabled: allProjects.data !== undefined,
    queryFn: async () => {
      const out: { project: string; topic: string }[] = [];
      for (const each of allProjects.data ?? []) {
        for (const topic of await notesApi.topics(each)) out.push({ project: each, topic });
      }
      return out;
    },
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

  // Cheap and entirely local — `git status` and a `rev-list --count` against the ref origin already
  // has here. No network, so no keychain prompt, and it is as fresh as the last sync: exactly the
  // claim the badge makes.
  const status = useQuery({ queryKey: ["notes-status"], queryFn: notesApi.status });

  const hits = useQuery({
    queryKey: ["notes-search", query],
    enabled: query.trim() !== "",
    queryFn: () => notesApi.search(query),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["notes-projects"] });
    void qc.invalidateQueries({ queryKey: ["notes-tree"] });
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

  /**
   * Move an entry to another note.
   *
   * Read, splice, append, write — twice. Not a backend command: both halves are edits this tool
   * already knows how to make, and a third way of deciding what an item IS would be a third place for
   * the definitions to drift (ADR-CORE-005). The append happens FIRST, so a failure between the two
   * leaves a duplicate rather than a hole.
   */
  const moveItem = useMutation({
    mutationFn: async ({
      from,
      to,
      item,
    }: {
      from: { project: string; topic: string };
      to: { project: string; topic: string };
      item: Task;
    }) => {
      const source = await notesApi.read(from.project, from.topic);
      const block = source.slice(item.offset, item.end);
      const target = await notesApi.read(to.project, to.topic);
      const gap = target === "" || target.endsWith("\n") ? "" : "\n";
      await notesApi.write(to.project, to.topic, `${target}${gap}${block}\n`);
      const rest = source.slice(item.end).replace(/^\n/, "");
      await notesApi.write(from.project, from.topic, source.slice(0, item.offset) + rest);
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

  const addProject = useMutation({
    mutationFn: (name: string) => notesApi.createProject(name),
    onSuccess: (_r, name) => {
      setNewProject(null);
      setEverything(false);
      setNotesProject(name);
      refresh();
    },
  });

  const renameProject = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => notesApi.renameProject(from, to),
    onSuccess: (_r, { to }) => {
      setRenaming(null);
      setNotesProject(to);
      refresh();
    },
  });

  /**
   * Rename a topic — read it, write it under the new name, drop the old one.
   *
   * Copy-then-delete rather than a filesystem rename in the backend, and in that order: a failure
   * between the two leaves the note under both names, where the other order would leave it under
   * neither. Losing a note is not a trade worth making to avoid a duplicate.
   */
  const renameTopic = useMutation({
    mutationFn: async ({
      project: p,
      topic,
      to,
    }: {
      project: string;
      topic: string;
      to: string;
    }) => {
      const text = await notesApi.read(p, topic);
      await notesApi.write(p, to, text);
      await notesApi.remove(p, topic);
    },
    onSuccess: () => {
      setRenamingTopic(null);
      refresh();
    },
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

  const open = (inProject: string, topic: string) => {
    openNote(inProject, topic);
    setView("notes");
  };

  /** What one entry offers. "Type into the terminal" first: it is the reason this tool exists. */
  const itemActions = (inProject: string, topic: string, item: Task) => [
    {
      // **No "type into the terminal" here**, and that reverses a plan decision on the maintainer's
      // instruction: it was written down as the reason this tool exists. It is not. A checklist item
      // is not a prompt, and typing one into a shell is senseless — "die Checklisten will ich garnicht
      // ins Terminal einfügen". Handing something over is copying it and pasting it where it belongs,
      // which is what the per-block copy control in the view is for.
      id: "copy",
      label: t("notes.copy"),
      onSelect: () => {
        // The whole entry, body and all, with the checkbox marker taken off — what gets pasted is the
        // thought, not the list syntax around it.
        void notesApi.read(inProject, topic).then((text) => {
          const block = text.slice(item.offset, item.end).replace(/^\s*-\s*\[[ xX]\]\s*/, "");
          copyText(block.trim(), "clipboard.note");
        });
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
      // Editing an entry IS opening its file at that entry — a note is markdown, and an entry is
      // some lines of it. A separate one-line editor here would be a second way to change a note,
      // which is a second definition of what an entry is (ADR-CORE-005).
      id: "edit",
      label: t("notes.editItem"),
      onSelect: () => {
        openNote(inProject, topic, item.offset);
        setView("notes");
      },
    },
    ...moveTargets(inProject, topic).map((to) => ({
      id: `move:${to.project}:${to.topic}`,
      label: t("notes.moveTo", { where: to.label }),
      onSelect: () => {
        moveItem.mutate({ from: { project: inProject, topic }, to, item });
      },
    })),
    {
      id: "delete",
      label: t("notes.delete"),
      onSelect: () => {
        removeItem.mutate({ project: inProject, topic, from: item.offset, to: item.end });
      },
    },
  ];

  /**
   * Every other note this entry could go to — this project's files first, then every other
   * project's.
   *
   * Built from the WHOLE tree, not from what is on screen. Reading it off `sections` meant the list
   * held only the current project's files, so "move to another project" was an entry that could not
   * do what it said — reported as the menu partly not doing what it should.
   */
  const moveTargets = (fromProject: string, fromTopic: string) =>
    (allTopics.data ?? [])
      .filter((s) => !(s.project === fromProject && s.topic === fromTopic))
      .sort((a, b) => Number(b.project === fromProject) - Number(a.project === fromProject))
      .map((s) => ({
        project: s.project,
        topic: s.topic,
        label:
          s.project === fromProject
            ? s.topic
            : `${s.project.split("/").at(-1) ?? s.project} · ${s.topic}`,
      }));

  /**
   * The project menu: every project there is, plus making one.
   *
   * **Addressable from any tab**, which is the point. It was derived from the front tab's git remote
   * and nothing else, so there was exactly one project and no way to reach another — reported as "es
   * gibt nur ein Projekt … der hat aber rein garnichts mit dem Projekt zu tun".
   */
  const projectMenu = [
    {
      id: "all",
      label: t("notes.allProjects"),
      onSelect: () => {
        setEverything(true);
      },
    },
    ...(allProjects.data ?? []).map((p) => ({
      id: `p:${p}`,
      label: p,
      onSelect: () => {
        setEverything(false);
        setNotesProject(p);
      },
    })),
    { separator: true as const },
    {
      id: "newProject",
      label: t("notes.newProject"),
      onSelect: () => {
        setNewProject("");
      },
    },
    {
      id: "renameProject",
      label: t("notes.renameProject"),
      onSelect: () => {
        setRenaming(project);
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
      id: "rename",
      label: t("notes.renameTopic"),
      onSelect: () => {
        setRenamingTopic({ project: inProject, topic, to: topic });
      },
    },
    {
      id: "delete",
      label: t("notes.deleteNote.title"),
      onSelect: () => {
        setConfirming({ kind: "note", project: inProject, topic });
      },
    },
    {
      id: "deleteProject",
      label: t("notes.deleteProject.title"),
      onSelect: () => {
        setConfirming({ kind: "project", project: inProject, topic });
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
          // Escape leaves the search, the same key that leaves everything else here. A search
          // REPLACES the list, so it is a state, and emptying a field by hand is not a way out.
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
          placeholder={t("common.search")}
          className="min-w-0 flex-1"
        />
        {query === "" ? null : (
          <IconButton
            label={t("notes.clearSearch")}
            onClick={() => {
              setQuery("");
            }}
            variant="ghost"
            className="h-5 w-5 shrink-0"
          >
            <X size={12} aria-hidden />
          </IconButton>
        )}
        {/* The project, and every other one. A picker rather than a toggle: projects are chosen, not
            derived from whichever tab is in front. */}
        <KebabMenu
          label={t("notes.projectMenu", {
            project: everything ? t("notes.allProjects") : project,
          })}
          items={projectMenu}
          size={11}
        />
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
        {/* **It syncs, and it says so.** It used to invalidate three local queries and touch no
            remote — which, beside a badge that claims to know whether the remote has your work, is
            a button that looks like the way to make that true and is not. Asked outright: "was
            macht der refresh button, lokal neu einlesen oder resyncen oder was?" */}
        <IconButton
          label={t("notes.syncNow")}
          onClick={() => {
            sync.syncNow();
            refresh();
          }}
          variant="ghost"
          className="h-5 w-5 shrink-0"
        >
          <RefreshCw size={12} aria-hidden className={notes.isFetching ? "animate-spin" : ""} />
        </IconButton>
      </header>

      {/* **What git already knows, shown where the notes are.** "sonst weiß ich ja nie ob mein stand
          auch remote liegt" — and a "last synced 14:02" cannot answer it: it says when something
          worked, not whether THIS note went with it. Commits ahead of origin and uncommitted edits
          are two different ways of being only here, and both are counted. */}
      <SyncBadge status={status.data ?? null} />

      {newProject === null && renaming === null ? null : (
        <div className="border-cyan/10 flex shrink-0 items-center gap-1 border-b px-2 py-1">
          <TextField
            ref={(el) => {
              el?.focus();
            }}
            aria-label={t(newProject === null ? "notes.renameProject" : "notes.newProject")}
            value={newProject ?? renaming ?? ""}
            onChange={(event) => {
              if (newProject === null) setRenaming(event.target.value);
              else setNewProject(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setNewProject(null);
                setRenaming(null);
                return;
              }
              if (event.key !== "Enter") return;
              const value = (newProject ?? renaming ?? "").trim();
              if (value === "") return;
              if (newProject === null) renameProject.mutate({ from: project, to: value });
              else addProject.mutate(value);
            }}
            placeholder={t(newProject === null ? "notes.renameProject" : "notes.newProject")}
            className="min-w-0 flex-1"
          />
        </div>
      )}

      {renamingTopic === null ? null : (
        <div className="border-cyan/10 flex shrink-0 items-center gap-1 border-b px-2 py-1">
          <TextField
            ref={(el) => {
              el?.focus();
            }}
            aria-label={t("notes.renameTopic")}
            value={renamingTopic.to}
            onChange={(event) => {
              setRenamingTopic({ ...renamingTopic, to: event.target.value });
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setRenamingTopic(null);
              if (event.key !== "Enter" || renamingTopic.to.trim() === "") return;
              renameTopic.mutate({
                project: renamingTopic.project,
                topic: renamingTopic.topic,
                to: renamingTopic.to.trim(),
              });
            }}
            className="min-w-0 flex-1"
          />
        </div>
      )}

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
        <div className="border-cyan/10 flex shrink-0 items-center gap-2 border-b px-2 py-0.5">
          {/* Where the note is about to land, named. Without it the model is invisible — and it was:
              "es entstehen keine Projekte" is what a capture going somewhere you cannot see looks
              like from outside. */}
          <span className="text-dim/70 min-w-0 flex-1 truncate font-mono text-[10px]">
            {everything ? t("notes.allProjects") : t("notes.filesInto", { project })}
          </span>
          <Button
            variant="ghost"
            className="shrink-0 px-1 py-0 text-[0.56rem] tracking-[0.12em]"
            onClick={() => {
              setNewTopic("");
            }}
          >
            {t("notes.newTopic")}
          </Button>
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
                {/* **Where the hit is**, not just which file. The search covers every project
                    regardless of which one is selected, so "release" alone is two different notes
                    in two repositories rendered as the same row. */}
                <span className="text-dim/70 shrink-0 text-[10px]">
                  {`${hit.project.split("/").at(-1) ?? hit.project} · ${hit.topic}`}
                </span>
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
              {/* **The file's own name IS the way into it**, and that is the whole navigation model
                  of this tool. It used to be a caption over a list of checkbox items, so a note
                  holding a prepared prompt, prose or a code block had nothing to click at all —
                  "wie zum geier soll ich an die eigentlichen dateien kommen wenn sie keine
                  checkboxen enthalten". A note is a note; a task is one kind of line inside one.

                  A `Row` rather than a caption with a button beside it: it is a real button, in the
                  tab order, and it may hold the `⋮` without either swallowing the other — a click
                  out of the menu stays the menu's. */}
              <Row
                label={t("notes.openFile", { name: section.topic })}
                onActivate={() => {
                  open(section.project, section.topic);
                }}
                className="items-center gap-1 px-2 py-0.5"
              >
                <h3 className="text-dim min-w-0 flex-1 truncate font-mono text-[0.56rem] tracking-[0.12em]">
                  {section.heading.toUpperCase()}
                </h3>
                <KebabMenu
                  label={t("notes.actions", { name: section.topic })}
                  items={topicActions(section.project, section.topic)}
                  size={11}
                />
              </Row>
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

      {confirming === null ? null : (
        // **Names what is inside**, the way the tmux tool names a session's command and window count
        // rather than asking "are you sure?" about a name. And it says the thing that makes deletion
        // safe rather than frightening: every deletion here is a commit, so nothing is truly gone.
        <ConfirmDialog
          label={t(
            confirming.kind === "note" ? "notes.deleteNote.title" : "notes.deleteProject.title",
          )}
          question={
            confirming.kind === "note"
              ? t("notes.deleteNote.question", { topic: confirming.topic })
              : t("notes.deleteProject.question", { project: confirming.project })
          }
          detail={
            confirming.kind === "note"
              ? t("notes.deleteNote.detail")
              : t("notes.deleteProject.detail", {
                  notes: sections.filter((s) => s.project === confirming.project).length,
                })
          }
          confirmLabel={t("notes.deleteNote.confirm")}
          cancelLabel={t("notes.cancel")}
          onConfirm={() => {
            if (confirming.kind === "note") {
              removeNote.mutate({ project: confirming.project, topic: confirming.topic });
            } else {
              removeProject.mutate(confirming.project);
            }
            setConfirming(null);
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}

      {capture.error === null && toggle.error === null ? null : (
        <p className="text-danger px-2 py-1 font-mono text-[10px]">
          {String(capture.error ?? toggle.error)}
        </p>
      )}

      {/* **A sync that keeps failing has to say so where the notes are.** It failed on every attempt
          for days and reported it to the log file alone; what that looked like from here was notes
          missing on the other machine and a note from the repository that never arrived, with
          nothing anywhere suggesting a problem. Gold rather than red: the notes are still written
          and still readable, it is the copy elsewhere that is not happening. */}
      {sync.error === null ? null : (
        <p className="text-gold px-2 py-1 font-mono text-[10px]">
          {t("notes.syncFailed", { reason: sync.error })}
        </p>
      )}
    </div>
  );
}

/**
 * Whether what is here is anywhere else — in one line, above the notes.
 *
 * It is a **git-based** tool, so the honest answer is git's own: commits `origin` does not have, and
 * edits that are not committed at all. A "last synced 14:02" answers a different question and reads
 * like this one, which is worse than saying nothing.
 *
 * Green is a promise and is only made when nothing is outstanding. Gold means "still only on this
 * machine" — not an error: the notes are written and readable either way, and being offline is the
 * normal case (ADR-PROJ-004). Dim "local" is a repository that was never connected, where "not
 * pushed" would be alarming nonsense.
 */
function SyncBadge({ status }: { status: NotesStatus | null }) {
  const t = useT();
  if (status === null) return null;
  if (!status.connected) {
    return <Badge className="text-dim/70">{t("notes.localOnly")}</Badge>;
  }
  const outstanding = status.ahead + (status.dirty ? 1 : 0);
  if (status.last_error !== null) {
    return (
      <Badge className="text-gold">{t("notes.syncFailed", { reason: status.last_error })}</Badge>
    );
  }
  if (outstanding === 0) {
    return <Badge className="text-green">{t("notes.inSync")}</Badge>;
  }
  return (
    <Badge className="text-gold">
      {status.dirty && status.ahead === 0
        ? t("notes.unsaved")
        : t("notes.notPushed", { count: status.ahead })}
    </Badge>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <p
      className={`border-cyan/10 shrink-0 border-b px-2 py-0.5 font-mono text-[10px] ${className}`}
    >
      {children}
    </p>
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
