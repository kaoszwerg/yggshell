import { describe, expect, it } from "vitest";
import { parseOsc7 } from "./osc7";

describe("parseOsc7", () => {
  it("reads the path out of a file:// payload", () => {
    expect(parseOsc7("file://mac.local/Users/steve/git-projects/yggshell")).toBe(
      "/Users/steve/git-projects/yggshell",
    );
  });

  it("ignores the host, whatever the shell calls this machine", () => {
    // A shell may report any hostname for itself; the path is the part that means something here.
    expect(parseOsc7("file:///tmp")).toBe("/tmp");
    expect(parseOsc7("file://anything-at-all/tmp")).toBe("/tmp");
  });

  it("decodes what the shell percent-encoded", () => {
    expect(parseOsc7("file://host/Users/steve/my%20projects")).toBe("/Users/steve/my projects");
    expect(parseOsc7("file://host/tmp/caf%C3%A9")).toBe("/tmp/café");
  });

  it("rejects a payload that is not a file URL", () => {
    // Another OSC 7 sender, or a program printing something that merely looks like one.
    expect(parseOsc7("https://example.com/")).toBeNull();
    expect(parseOsc7("")).toBeNull();
    expect(parseOsc7("/plain/path")).toBeNull();
  });

  it("rejects a payload with no path at all", () => {
    expect(parseOsc7("file://justahost")).toBeNull();
  });

  it("rejects broken percent-encoding rather than guessing", () => {
    // Handing a half-decoded path to the filesystem would point the Git tool at the wrong directory,
    // which is worse than showing nothing.
    expect(parseOsc7("file://host/tmp/%E0%A4%A")).toBeNull();
  });
});
