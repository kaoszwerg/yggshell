import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/commands";
import type { TerminalProfile } from "../bindings/TerminalProfile";
import type { TerminalTheme } from "../bindings/TerminalTheme";
import type { TmuxMode } from "../bindings/TmuxMode";

/** Read the persisted user settings (async/server state owned by TanStack Query, cached 60s). */
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
    staleTime: 60_000,
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
