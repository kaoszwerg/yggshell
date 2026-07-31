// Typed wrapper around the Git tool's read-only command surface (ADR-PROJ-001).
import { invoke } from "@tauri-apps/api/core";
import type { GitSnapshot } from "../bindings/GitSnapshot";

export const gitApi = {
  /**
   * Everything the Git tool renders for the repository containing `cwd`, in one call.
   *
   * `null` when that directory is not inside a repository — the normal case for most of the
   * filesystem, and not an error. One call rather than four so the branch, the file list and the
   * history can never disagree with each other on screen.
   */
  snapshot: (cwd: string) => invoke<GitSnapshot | null>("git_snapshot", { cwd }),
};
