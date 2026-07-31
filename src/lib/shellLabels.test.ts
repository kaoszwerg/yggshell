import { describe, it, expect } from "vitest";
import { labelShells } from "./shellLabels";

const shell = (path: string, name: string, is_default = false) => ({ path, name, is_default });

describe("labelShells", () => {
  it("uses the short name when it is unambiguous", () => {
    expect(labelShells([shell("/bin/zsh", "zsh"), shell("/bin/bash", "bash")])).toEqual([
      { path: "/bin/zsh", label: "zsh" },
      { path: "/bin/bash", label: "bash" },
    ]);
  });

  it("falls back to the full path for every shell that shares a name", () => {
    // Two `zsh` buttons would be a coin toss, not a choice.
    expect(
      labelShells([
        shell("/bin/zsh", "zsh"),
        shell("/opt/homebrew/bin/zsh", "zsh"),
        shell("/bin/bash", "bash"),
      ]),
    ).toEqual([
      { path: "/bin/zsh", label: "/bin/zsh" },
      { path: "/opt/homebrew/bin/zsh", label: "/opt/homebrew/bin/zsh" },
      { path: "/bin/bash", label: "bash" },
    ]);
  });

  it("has nothing to say about an empty list", () => {
    expect(labelShells([])).toEqual([]);
  });
});
