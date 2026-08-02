import { useGitSnapshot } from "./useGitSnapshot";

/**
 * The notes project the front tab belongs to.
 *
 * **The git remote, falling back to the folder name**, so the same project is the same folder on
 * every machine however differently it is checked out — `git@github.com:kaoszwerg/yggshell.git` and
 * the https form both become `github.com/kaoszwerg/yggshell`. A tab with no repository at all gets
 * the shared `_inbox`, so a thought is never refused for being had in the wrong window.
 *
 * **Following the front tab is right here and would be wrong for the attention signal**, which the
 * rules warn about at length (`rule:attention-signals`). The difference is what the surface is for:
 * that one has to reach somebody looking elsewhere, this one is a panel you are reading. Gating it on
 * the front tab is the feature.
 */
export function useNoteProject(): string {
  const { query } = useGitSnapshot();
  const remote = query.data?.remote ?? "";
  const root = query.data?.root ?? "";
  return projectKey(remote) ?? folderKey(root) ?? "_inbox";
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
