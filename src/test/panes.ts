import type { TerminalPane } from "../store/terminal";

/**
 * A terminal tab for a test, with every field it needs and only the ones a test cares about spelled
 * out.
 *
 * A tab has grown a field three times now — a profile, a colour scheme, a detail panel — and each time
 * every literal in every suite had to be edited to say something none of those tests were about. This
 * is where a new field is added once.
 */
export function pane(over: Partial<TerminalPane> & { key: string }): TerminalPane {
  return {
    title: "Terminal",
    cwd: null,
    profileId: null,
    themeId: null,
    plain: false,
    generation: 0,
    detail: null,
    tmuxSession: null,
    ...over,
  };
}
