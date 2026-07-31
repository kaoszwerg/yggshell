import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { gitApi } from "../api/git";
import { useTerminalStore } from "../store/terminal";
import { useSettings } from "./useSettings";

/**
 * How often the snapshot is re-read while the tool is open.
 *
 * A harness editing files should show up without the user asking, but reading a repository is not
 * free — this is the compromise, and the refresh control is there for the moment it feels too slow.
 */
const REFRESH_MS = 4000;

/**
 * How often the remote is asked, while the tool is open.
 *
 * Far slower than the local read above, and for a different reason: reading the repository is cheap
 * and local, while this is a network request to somebody else's server. Five minutes keeps the counts
 * honest without being traffic anyone would notice (ADR-PROJ-002).
 */
const FETCH_MS = 5 * 60 * 1000;

/**
 * The repository the tab in front is in.
 *
 * One hook rather than a query per caller, so the column header and the tool itself cannot disagree
 * about which repository is being shown — and, because they share a query key, the second caller is a
 * cache hit rather than a second walk of the repository (rule:reusability).
 *
 * Keyed on the ACTIVE tab's directory: the Git tool follows the terminal in front, which is what makes
 * it useful in a tabbed app where two tabs are two projects.
 */
export function useGitSnapshot() {
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);
  const settings = useSettings();
  const autoFetch = settings.data?.git_auto_fetch ?? true;
  const client = useQueryClient();

  const query = useQuery({
    queryKey: ["git", cwd],
    queryFn: () => (cwd === null ? Promise.resolve(null) : gitApi.snapshot(cwd)),
    enabled: cwd !== null,
    refetchInterval: REFRESH_MS,
  });

  // Asking the remote, so `↑2 ↓0` is a fact rather than a memory: the counts come from the local
  // remote-tracking ref, which only moves when something fetches (ADR-PROJ-002).
  //
  // Its own query rather than part of the snapshot: the snapshot is a cheap local read on a four-second
  // interval, and a network request has no business on that timer.
  const fetched = useQuery({
    queryKey: ["git-fetch", cwd],
    queryFn: async () => {
      if (cwd === null) return "";
      const problem = await gitApi.fetch(cwd);
      // The refs may have moved, so the counts have to be read again — the fetch itself returns none.
      await client.invalidateQueries({ queryKey: ["git", cwd] });
      return problem;
    },
    enabled: cwd !== null && autoFetch,
    refetchInterval: FETCH_MS,
    // Retrying a network call that just failed, on a display refresh, only multiplies the traffic.
    retry: false,
  });

  /** Fetch now, then re-read — what the refresh button does. */
  const refresh = useCallback(async () => {
    if (cwd !== null && autoFetch) await fetched.refetch();
    await query.refetch();
  }, [autoFetch, cwd, fetched, query]);

  return {
    cwd,
    query,
    refresh,
    /** Why the counts may be stale, or `null` when they are current. */
    remoteProblem: fetched.data === undefined || fetched.data === "" ? null : fetched.data,
  };
}

/**
 * What to call the repository: the last segment of its working-tree path.
 *
 * That is the name people use for a checkout, whatever the remote is called — and a checkout may have
 * no remote at all. `null` when there is no repository, which the caller shows as nothing rather than
 * as a name it made up.
 */
export function repositoryName(root: string | null | undefined): string | null {
  if (typeof root !== "string") return null;
  const trimmed = root.replace(/[/\\]+$/, "");
  const name = trimmed.split(/[/\\]/).pop() ?? "";
  return name === "" ? null : name;
}
