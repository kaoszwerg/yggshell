import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/commands";
import type { SettingsDto } from "../bindings/SettingsDto";
import type { TerminalProfile } from "../bindings/TerminalProfile";
import type { TerminalTheme } from "../bindings/TerminalTheme";
import type { TmuxMode } from "../bindings/TmuxMode";

/**
 * Where the last known settings are kept so the FIRST frame can already be right.
 *
 * Not a second source of truth — see `useSettings`. `localStorage` because it is the only store the
 * webview can read synchronously, before anything has been painted.
 */
const LAST_KNOWN = "yggshell.settings.last-known";

/** The last settings this app saw, or `undefined` on a first run. Never throws. */
function lastKnown(): SettingsDto | undefined {
  try {
    const raw = localStorage.getItem(LAST_KNOWN);
    return raw === null ? undefined : (JSON.parse(raw) as SettingsDto);
  } catch {
    // Corrupt payload, private mode, quota — all of them mean "no head start", never a failure.
    return undefined;
  }
}

/**
 * Read the persisted user settings (async/server state owned by TanStack Query, cached 60s).
 *
 * **The first frame is drawn with the last known values, not with the defaults.** Settings arrive
 * over IPC, so for the first render there were none: the whole interface painted at scale 1.0, font
 * size 13 and the default theme, then jumped to the real values a moment later — on every single
 * launch. Reported as *"zuerst rendert die app mit den default, erst danach springt sie um"*, and it
 * is the same reasoning that already drives the locale mirror (rule:i18n), applied once at the point
 * every consumer goes through instead of once per setting.
 *
 * **The direction is never ambiguous: `settings.json` wins.** `initialDataUpdatedAt: 0` marks the
 * cached copy as infinitely old, so a real read is issued immediately and overwrites it. The cache
 * decides what is on screen for one frame; it never decides what is true.
 */
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const settings = await api.getSettings();
      try {
        localStorage.setItem(LAST_KNOWN, JSON.stringify(settings));
      } catch {
        // A head start next launch is a nicety; failing to store it must never fail the read.
      }
      return settings;
    },
    staleTime: 60_000,
    initialData: lastKnown,
    initialDataUpdatedAt: 0,
  });
}

/** Mutate user settings; writes the returned state straight into the settings query cache. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      uiScale?: number;
      terminalFontSize?: number;
      terminalShell?: string;
      terminalTheme?: string;
      diffTheme?: string;
      commitTheme?: string;
      terminalFont?: string;
      gitAutoFetch?: boolean;
      language?: string;
      copyOnSelect?: boolean;
      tmuxMode?: TmuxMode;
      tmuxSession?: string;
      minimizeToTray?: boolean;
    }) => api.updateSettings(opts),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

/**
 * The shells this machine offers.
 *
 * Effectively static for the life of the process — the backend reads `/etc/shells` and `$SHELL` once
 * per call and a shell is not installed while Settings is open — so this is cached for the session
 * rather than refetched on every visit.
 */
export function useShells() {
  return useQuery({
    queryKey: ["shells"],
    queryFn: api.listShells,
    staleTime: Infinity,
  });
}

/**
 * Every terminal colour scheme the user has stored.
 *
 * Not `staleTime: Infinity` like the shell list: themes change while the app is open — an import or
 * an edit adds one — so this is a normal query that the mutations below invalidate.
 */
export function useTerminalThemes() {
  return useQuery({
    queryKey: ["terminal-themes"],
    queryFn: api.listTerminalThemes,
  });
}

/** Import an `.itermcolors` file by path, and refresh the list. */
export function useImportTerminalTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.importTerminalTheme(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["terminal-themes"] }),
  });
}

/** Save an edited theme, and refresh the list. */
export function useSaveTerminalTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (theme: TerminalTheme) => api.saveTerminalTheme(theme),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["terminal-themes"] }),
  });
}

/** Delete a stored theme, and refresh the list. */
export function useDeleteTerminalTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTerminalTheme(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["terminal-themes"] }),
  });
}

/** Every terminal profile the user has saved. */
export function useTerminalProfiles() {
  return useQuery({
    queryKey: ["terminal-profiles"],
    queryFn: api.listTerminalProfiles,
  });
}

/** Save a profile, and refresh the list. */
export function useSaveTerminalProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: TerminalProfile) => api.saveTerminalProfile(profile),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["terminal-profiles"] }),
  });
}

/** Delete a profile, and refresh the list. */
export function useDeleteTerminalProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTerminalProfile(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["terminal-profiles"] }),
  });
}
