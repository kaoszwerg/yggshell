import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/commands";
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
