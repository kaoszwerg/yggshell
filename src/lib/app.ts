/** Application display name — single source for all frontend labels (ADR-CORE-005). Synced from
 * app.identity.json by `identity:sync` (ADR-APP-031); do not hand-edit the value. */
export const APP_NAME = "YggShell";

/** Tagline — single source for the title bar and the About dialog (ADR-CORE-005). */
export const APP_TAGLINE = "The everyday terminal for agentic development";

/** One-paragraph description shown in the About dialog (synced from app.identity.json). */
export const APP_DESCRIPTION =
  "A Norse-inspired developer terminal, and a full replacement for the system one: independent tabs with tmux sessions that survive a crash, iTerm2-compatible themes and a theme editor, launchable from anywhere with `ygg`. What it adds is the work around the terminal — the repository, the files, the processes and ports, the containers, the sessions, and what an AI harness such as Claude Code is doing right now, each in the sidebar beside the shell rather than in another window. It is built to be used every day and extended continuously, so that running an agentic workflow needs one window instead of six.";
