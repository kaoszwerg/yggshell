// Typed wrapper around the Claude-environment surface.
import { invoke } from "@tauri-apps/api/core";
import type { EnvironmentStatus } from "../bindings/EnvironmentStatus";

export const environmentApi = {
  /** How this project is pointed at an account, and what the machine can do about it. Read-only. */
  status: (cwd: string) => invoke<EnvironmentStatus>("environment_status", { cwd }),

  /**
   * Point this project at an account: write the `.envrc` and approve it.
   *
   * Resolves to the path that was written, so the interface can say exactly what changed — which is
   * a condition of approving it at all (`agent::direnv`).
   */
  setProject: (cwd: string, home: string) =>
    invoke<string>("set_project_environment", { cwd, home }),

  /** Make a new, empty Claude home. Claude Code signs in there on first use; no credential is
   *  touched by this app. */
  createHome: (name: string) => invoke<string>("create_claude_home", { name }),

  /** Install direnv through the machine's own package manager. Resolves to the manager used. */
  installDirenv: () => invoke<string>("install_direnv"),
};
