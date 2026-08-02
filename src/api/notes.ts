import { invoke } from "@tauri-apps/api/core";
import type { NoteFile } from "../bindings/NoteFile";
import type { NoteHit } from "../bindings/NoteHit";
import type { NoteOrphan } from "../bindings/NoteOrphan";
import type { NotesStatus } from "../bindings/NotesStatus";

/**
 * The notes store, typed.
 *
 * **Every call names a project and a topic, never a path.** The root is derived in Rust from the
 * app's data directory; the webview can ask for a note to be written and cannot say *where* — the
 * same principle as ADR-PROJ-001 §5, applied to writing instead of running (ADR-PROJ-004).
 */
export const notesApi = {
  /** Where the notes are kept, and what the last sync said — git's own message if it failed. */
  status: () => invoke<NotesStatus>("notes_status"),

  /**
   * Point the notes at a repository that **already exists**.
   *
   * The app never creates one: a creation flow would have to choose a visibility, and choosing wrong
   * is silent and permanent. A remote it cannot reach comes back with git's own words.
   */
  connect: (remote: string, branch: string) =>
    invoke<NotesStatus>("notes_connect", { remote, branch }),

  /**
   * Save what is configured, without connecting.
   *
   * The settings fields call this on every edit, so what they show is what is stored. They used to
   * be local state written only on a successful connect — which left them looking empty after a
   * failed attempt, with the text the user had just typed gone.
   */
  configure: (remote: string, branch: string, sync: boolean) =>
    invoke<NotesStatus>("notes_configure", { remote, branch, sync }),

  /**
   * Delete the local clone, notes and all.
   *
   * The escape hatch adoption needs: connecting adopts what is already in the directory rather than
   * clobbering it, so a directory in a state you do not want otherwise has no way out from inside
   * the app.
   */
  reset: () => invoke<NotesStatus>("notes_reset"),

  /** Stop syncing and keep every local note. */
  disconnect: () => invoke<NotesStatus>("notes_disconnect"),

  /** Pull, then commit and push whatever changed. Offline is a state, not an error. */
  sync: () => invoke<NotesStatus>("notes_sync"),

  projects: () => invoke<string[]>("notes_projects"),

  /**
   * Every note of these projects, contents and all — **one call**.
   *
   * The tool used to ask for a project's topics and then for each note's text separately. Every one
   * of those was a round trip, and every one of them ran on Tauri's main thread, so they could not
   * overlap with each other or with anything else: opening the panel was a wait that grew with the
   * number of notes ("das laden des todo widgets dauert extrem lange").
   */
  tree: (projects: string[]) => invoke<NoteFile[]>("notes_tree", { projects }),

  /** Every file in the repository, named but not read — what a "move to" menu needs. */
  index: () => invoke<NoteFile[]>("notes_index"),

  /** A project's topics, `inbox` first. */
  topics: (project: string) => invoke<string[]>("notes_topics", { project }),

  /** One note's markdown. A note nobody has written to reads as empty rather than failing. */
  read: (project: string, topic: string) => invoke<string>("notes_read", { project, topic }),

  write: (project: string, topic: string, text: string) =>
    invoke<void>("notes_write", { project, topic, text }),

  /** Append a captured thought to the project's inbox, as a task. */
  capture: (project: string, text: string) => invoke<void>("notes_capture", { project, text }),

  /**
   * Flip the task at `offset`, and return whether it is now done.
   *
   * A byte offset, because that is what the markdown parser reports and a line number is wrong the
   * moment anything above it changes. The backend verifies it still points at a marker before
   * rewriting anything.
   */
  toggle: (project: string, topic: string, offset: number) =>
    invoke<boolean>("notes_toggle", { project, topic, offset }),

  remove: (project: string, topic: string) => invoke<void>("notes_delete", { project, topic }),

  removeProject: (project: string) => invoke<void>("notes_delete_project", { project }),

  /**
   * Rename a project, keeping every note and image in it.
   *
   * Projects are named by the user rather than derived from the front tab's git remote, which is how
   * they started: which repository a terminal is sitting in has nothing to do with which project a
   * note belongs to, and a name you cannot change is a name that is wrong for ever.
   */
  renameProject: (from: string, to: string) => invoke<void>("notes_rename_project", { from, to }),

  /** Create an empty project. "A project exists" and "a project has notes" are different states. */
  createProject: (project: string) => invoke<void>("notes_create_project", { project }),

  /**
   * Fetch a remote image, once, because the user pressed.
   *
   * Never on render: rendering it from a pasted note would call a stranger's server the instant the
   * note is read, and reading a note is not consent to that (ADR-PROJ-004).
   */
  fetchImage: (url: string) => invoke<number[]>("notes_image_fetch", { url }),

  /** Case-insensitive plain text, across every project. Not a regex, deliberately. */
  search: (query: string) => invoke<NoteHit[]>("notes_search", { query }),

  /** Copy an image into the project's assets; returns the note-relative path to write. */
  addImage: (project: string, name: string, bytes: number[]) =>
    invoke<string>("notes_image_add", { project, name, bytes }),

  /**
   * One image's bytes.
   *
   * The webview cannot read a file itself — there is no `assetProtocol` capability in this app at all
   * — so this is how a screenshot reaches the screen without widening the sandbox.
   */
  readImage: (project: string, path: string) =>
    invoke<number[]>("notes_image_read", { project, path }),

  /** Every image no note refers to. Deletes nothing. */
  orphans: () => invoke<NoteOrphan[]>("notes_orphans"),

  /** Delete the orphans the user picked. */
  clean: (keys: string[]) => invoke<number>("notes_clean", { keys }),
};
