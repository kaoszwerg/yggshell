import { describe, it, expect } from "vitest";
import { projectKey } from "./useNoteProject";

/**
 * The frontend's half of a contract the backend also implements (`notes::project_key`).
 *
 * Pinned on **both** sides, which is what `rule:testing` asks for when two runtimes must agree: the
 * frontend needs the answer to decide what to *show* before anything is written, and the backend
 * needs it to decide where to write. If they disagree, a project's notes split in two and nothing
 * says so — the same silent divergence as a stale cache.
 */
describe("projectKey", () => {
  it("gives one key for the ssh and https forms of the same repository", () => {
    // The commonest way for one project to become two folders: cloned over ssh on one machine and
    // https on the other.
    expect(projectKey("git@github.com:kaoszwerg/yggshell.git")).toBe(
      "github.com/kaoszwerg/yggshell",
    );
    expect(projectKey("https://github.com/kaoszwerg/yggshell")).toBe(
      "github.com/kaoszwerg/yggshell",
    );
    expect(projectKey("https://github.com/kaoszwerg/yggshell.git")).toBe(
      "github.com/kaoszwerg/yggshell",
    );
  });

  it("drops a scheme, a user and a trailing .git alike", () => {
    expect(projectKey("ssh://git@example.com/team/thing.git")).toBe("example.com/team/thing");
  });

  it("has no answer for a repository with no remote", () => {
    expect(projectKey("")).toBeNull();
    expect(projectKey("   ")).toBeNull();
  });

  it("refuses to let a remote climb out of the notes root", () => {
    // The key becomes a directory. A remote is not a path the user typed, but it is a string from
    // outside all the same, and `..` in it must not become a folder somewhere else.
    expect(projectKey("https://example.com/../../etc")).toBe("example.com/etc");
  });
});
