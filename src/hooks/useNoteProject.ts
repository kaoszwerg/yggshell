import { useGitSnapshot } from "./useGitSnapshot";
import { useUiStore } from "../store/ui";

/**
 * Which project the notes tool is filing into.
 *
 * **The user's choice first.** This was derived from the front tab's git remote and nothing else, and
 * the maintainer overruled it: which repository a terminal happens to be sitting in has nothing to do
 * with which project a note belongs to, and it left every project unreachable from any other tab —
 * "es gibt nur ein Projekt … der hat aber rein garnichts mit dem Projekt zu tun". Projects are now
 * created, renamed and picked deliberately.
 *
 * **The tab still supplies the default**, because it is a good guess on the day you start: the git
 * remote reduced to a key, so the same repository is the same folder on every machine however
 * differently it is checked out. A tab with no repository falls back to the shared `_inbox`, so a
 * thought is never refused for being had in the wrong window.
 */
export function useNoteProject(): string {
  const chosen = useUiStore((s) => s.notesProject);
  const { query } = useGitSnapshot();
  const remote = query.data?.remote ?? "";
  const root = query.data?.root ?? "";
  // The user's choice wins, always. The tab only ever supplies a first suggestion.
  return chosen ?? projectKey(remote) ?? folderKey(root) ?? "_inbox";
}

/**
 * A git remote reduced to a nested directory key.
 *
 * Mirrors `notes::project_key` in the backend, and deliberately so: the frontend needs the answer to
 * decide what to *show* before anything is written, and the backend needs it to decide where to
 * write. Both are pinned by tests on their own side, which is what `rule:testing` asks for when two
 * sides must agree on one contract.
 */
export function projectKey(remote: string): string | null {
  const trimmed = remote.trim();
  if (trimmed === "") return null;
  const withoutScheme = trimmed.replace(/^(https?|ssh):\/\//, "");
  const withoutUser = withoutScheme.includes("@")
    ? (withoutScheme.split("@").at(-1) ?? withoutScheme)
    : withoutScheme;
  const normalised = withoutUser.replace(":", "/");
  const cleaned = normalised
    .replace(/\.git$/, "")
    .split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..");
  return cleaned.length === 0 ? null : cleaned.join("/");
}

/** The last path segment of a checkout, for a repository with no remote. */
function folderKey(root: string): string | null {
  const name = root.split("/").filter(Boolean).at(-1);
  return name === undefined || name === "" ? null : `local/${name}`;
}
