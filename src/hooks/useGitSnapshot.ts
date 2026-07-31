import { useQuery } from "@tanstack/react-query";
import { gitApi } from "../api/git";
import { useTerminalStore } from "../store/terminal";

/**
 * How often the snapshot is re-read while the tool is open.
 *
 * A harness editing files should show up without the user asking, but reading a repository is not
 * free — this is the compromise, and the refresh control is there for the moment it feels too slow.
 */
const REFRESH_MS = 4000;

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

  const query = useQuery({
    queryKey: ["git", cwd],
    queryFn: () => (cwd === null ? Promise.resolve(null) : gitApi.snapshot(cwd)),
    enabled: cwd !== null,
    refetchInterval: REFRESH_MS,
  });

  return { cwd, query };
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
