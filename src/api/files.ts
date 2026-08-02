import type { TextFileDto } from "../bindings/TextFileDto";
// Typed wrapper around the file browser's read-only command surface.
import { invoke } from "@tauri-apps/api/core";
import type { DirListing } from "../bindings/DirListing";

export const filesApi = {
  /**
   * A file's text, for the inline viewer.
   *
   * **Reading, never running.** The alternative — handing the path to the platform's default handler
   * — starts an application chosen by the file. Here the type decides only which highlighter colours
   * it. The backend refuses a directory, refuses anything binary, and caps what it reads; `path` is
   * checked against `root` exactly as a listing is.
   */
  /**
   * Hand a path to whatever the platform opens it with.
   *
   * **This starts an application chosen by the file.** Kept narrow on purpose: anything that is text
   * has {@link readText}, which launches nothing. This is for a PDF, an image, a binary — the cases
   * an inline viewer cannot answer. The backend verifies the path against `root` first.
   */
  open: (root: string, path: string) => invoke<void>("open_path", { root, path }),

  readText: (root: string, path: string) => invoke<TextFileDto>("read_text_file", { root, path }),

  /**
   * List one directory of the tab's own tree.
   *
   * `root` is the tab's working directory and bounds everything the browser may read: a path that
   * resolves outside it is refused by the backend, not by this wrapper (rule:security — the client
   * is treated as hostile even though we wrote it).
   *
   * One level per call. A recursive walk would read `node_modules` on the first frame, and a tree
   * that fetched everything up front would also be stale the moment a file changed.
   *
   * Rejects when the directory is gone or unreadable — which is a different fact from "it is empty",
   * and the caller renders it differently.
   */
  list: (root: string, path: string) => invoke<DirListing>("list_directory", { root, path }),

  /**
   * Show a file or folder in the system file manager, with the item selected.
   *
   * Deliberately not "open the file": opening a local path with the default handler *runs* whatever
   * application the file's type names, chosen by the file rather than by the user. Revealing puts
   * them in the right folder and lets them decide.
   */
  reveal: (root: string, path: string) => invoke<void>("reveal_in_file_manager", { root, path }),
};
