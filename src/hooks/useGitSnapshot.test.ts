import { describe, it, expect } from "vitest";
import { repositoryName } from "./useGitSnapshot";

describe("repositoryName", () => {
  it("is the last segment of the working-tree path", () => {
    // What people call a checkout, whatever the remote is named — and a checkout may have no remote.
    expect(repositoryName("/Users/steve/git-projects/private/yggshell")).toBe("yggshell");
    expect(repositoryName("/repo")).toBe("repo");
  });

  it("ignores a trailing separator", () => {
    expect(repositoryName("/Users/steve/yggshell/")).toBe("yggshell");
    expect(repositoryName("/Users/steve/yggshell//")).toBe("yggshell");
  });

  it("reads a Windows path too", () => {
    expect(repositoryName("C:\\Users\\steve\\git\\yggshell")).toBe("yggshell");
    expect(repositoryName("C:\\Users\\steve\\git\\yggshell\\")).toBe("yggshell");
  });

  it("answers null rather than inventing a name", () => {
    expect(repositoryName(null)).toBeNull();
    expect(repositoryName(undefined)).toBeNull();
    expect(repositoryName("")).toBeNull();
    expect(repositoryName("/")).toBeNull();
  });
});
