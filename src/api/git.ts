// Typed wrapper around the Git tool's read-only command surface (ADR-PROJ-001).
import { invoke } from "@tauri-apps/api/core";
import type { GitCommitDetail } from "../bindings/GitCommitDetail";
import type { GitDiff } from "../bindings/GitDiff";
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

  /**
   * What changed in one file of the working tree.
   *
   * `staged` picks the side: `true` compares HEAD with the index, `false` the index with the file on
   * disk. The same path can have both, and they are different diffs.
   */
  fileDiff: (cwd: string, path: string, staged: boolean) =>
    invoke<GitDiff | null>("git_file_diff", { cwd, path, staged }),

  /** One commit in full: the whole message, its author, and the files it touched. */
  commit: (cwd: string, rev: string) => invoke<GitCommitDetail | null>("git_commit", { cwd, rev }),

  /** One file inside one commit, against its first parent. */
  commitFileDiff: (cwd: string, rev: string, path: string) =>
    invoke<GitDiff | null>("git_commit_file_diff", { cwd, rev, path }),
};
