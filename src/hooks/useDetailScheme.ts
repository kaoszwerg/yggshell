import { useSettings, useTerminalThemes } from "./useSettings";
import { useTerminalStore } from "../store/terminal";
import { detailThemeId, resolveTheme, themeById } from "../lib/terminalTheme";
import type { SyntaxScheme } from "../lib/highlight";

/**
 * The colour scheme a detail view is drawn in — a diff, a commit, a note, the note editor.
 *
 * **Shared rather than copied.** This lived inside `GitDetailPanel` while diffs and commits were the
 * only views that had a scheme of their own. The notes view is the third and fourth caller, and a
 * second copy of the chain would be a second place for "which scheme wins" to drift (ADR-CORE-005) —
 * with the two answers diverging in front of the user, which is exactly what the chain exists to
 * prevent.
 *
 * `paneKey` names the terminal a view sits over, and it is what makes a diff match the tab it opened
 * from. A view that belongs to no tab passes `null`: the chain then skips that step and goes on to
 * the default terminal scheme (`detailThemeId`).
 *
 * Returns `null` for "the HUD palette" — no scheme configured anywhere, which is the default and is
 * not an error.
 */
export function useDetailScheme(
  paneKey: string | null,
  kind: "diff" | "commit" | "notes" | "notesEdit",
): SyntaxScheme | null {
  const settings = useSettings();
  const themes = useTerminalThemes();
  const paneThemeId = useTerminalStore((s) =>
    paneKey === null ? null : (s.panes.find((p) => p.key === paneKey)?.themeId ?? null),
  );
  const id = detailThemeId(kind, settings.data, paneThemeId);
  const theme = themeById(themes.data, id);
  if (theme === null) return null;
  return { id: theme.id, colours: resolveTheme(theme) };
}
