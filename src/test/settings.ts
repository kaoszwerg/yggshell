import type { SettingsDto } from "../bindings/SettingsDto";

/**
 * A settings document for a test, with every field filled in and only the ones a test cares about
 * spelled out.
 *
 * The same reason `panes.ts` exists: settings have grown a field several times now, and each time
 * every literal in every suite had to be edited to say something none of those tests were about. This
 * is where a new field is added once.
 */
export function settings(over: Partial<SettingsDto> = {}): SettingsDto {
  return {
    ui_scale: 1,
    terminal_font_size: 13,
    tool_font_size: 13,
    terminal_shell: "",
    terminal_theme: "",
    diff_theme: "",
    commit_theme: "",
    notes_theme: "",
    notes_edit_theme: "",
    terminal_font: "",
    git_auto_fetch: true,
    language: "",
    copy_on_select: false,
    tmux_mode: "off",
    tmux_session: "",
    minimize_to_tray: false,
    notes_remote: "",
    notes_branch: "",
    notes_sync: true,
    ...over,
  };
}
