// Typed wrapper around the Claude-environment surface.
import { invoke } from "@tauri-apps/api/core";
import type { AgentAttention } from "../bindings/AgentAttention";
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

  /**
   * Whether the agent hooks are in place, and which directories are asking for attention.
   *
   * `cwd` is optional and only selects which account's settings are checked for the hook. The
   * events are machine-wide — they are about the tabs you are *not* looking at — so this must stay
   * answerable before any tab has reported a directory.
   */
  attention: (cwd: string | null) => invoke<AgentAttention>("agent_attention", { cwd }),

  /**
   * Install the hook into this project's Claude account.
   *
   * Resolves to the settings file that was written. **It takes effect in the NEXT session** — Claude
   * Code reads its hooks when a session starts — and the interface has to say so, or the button
   * looks like it did nothing.
   */
  installHook: (cwd: string) => invoke<string>("install_agent_hook", { cwd }),

  /**
   * Install the plan nudge — one sentence appended to a prompt, and only when the session has no
   * task list.
   *
   * **Its own call, separate from `installHook`, and that is the design** (ADR-PROJ-005 §7): the
   * attention hook reports to this app, this one writes into the model's context. Agreeing to be
   * told when an agent is waiting is not agreeing to that.
   */
  installPlanNudge: (cwd: string) => invoke<string>("install_plan_nudge", { cwd }),

  /** Whether the plan nudge is installed for this directory's account. */
  nudgeInstalled: (cwd: string) => invoke<boolean>("agent_nudge_installed", { cwd }),

  /** Forget every attention event recorded so far. */
  clearAttention: () => invoke<void>("clear_agent_attention"),
};
