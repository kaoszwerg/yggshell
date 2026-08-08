import type { FilePreviewDto } from "../bindings/FilePreviewDto";
// Typed wrapper around the file browser's read-only command surface.
import { invoke } from "@tauri-apps/api/core";
import type { DirListing } from "../bindings/DirListing";

export const filesApi = {
  /**
   * Hand a path to whatever the platform opens it with.
   *
   * **This starts an application chosen by the file.** Kept narrow on purpose: anything the viewer
   * can draw has {@link preview}, which launches nothing. This is for a PDF, an archive, a binary —
   * the cases an inline viewer cannot answer, and the button the viewer itself offers when it says
   * so. The backend verifies the path against `root` first.
   */
  open: (root: string, path: string) => invoke<void>("open_path", { root, path }),

  /**
   * A file for the viewer: its text, its pixels, or a named reason it has neither.
   *
   * **This replaced a `readText` that answered text or an *error*** — so a picture arrived as
   * the string "… is not a text file" and the panel had nothing better to do than print it. What a
   * file *is* gets decided in the backend, next to the root check and the byte sniffing — never here
   * from an extension, which is a claim by whoever named the file.
   *
   * An image travels as bytes rather than as a URL the webview fetches: this app has no
   * `assetProtocol` capability at all, so everything on disk reaches the webview through a command
   * confined by a root check. Drawing a picture does not widen the sandbox (ADR-PROJ-004).
   */
  preview: (root: string, path: string) => invoke<FilePreviewDto>("preview_file", { root, path }),

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
