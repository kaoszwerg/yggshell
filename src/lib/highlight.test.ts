import { describe, it, expect, vi, afterEach } from "vitest";
import { languageFor, languageForTag, tokenize } from "./highlight";
import { PALETTE, TERMINAL_ANSI } from "../styles/palette";

describe("languageFor", () => {
  it("recognises the languages this project is actually written in", () => {
    expect(languageFor("src/views/TerminalView.tsx")).toBe("tsx");
    expect(languageFor("src/lib/highlight.ts")).toBe("typescript");
    expect(languageFor("src-tauri/src/git/diff.rs")).toBe("rust");
    expect(languageFor("package.json")).toBe("json");
    expect(languageFor("src-tauri/Cargo.toml")).toBe("toml");
    expect(languageFor("README.md")).toBe("markdown");
  });

  it("ignores the case of an extension", () => {
    expect(languageFor("Notes.MD")).toBe("markdown");
  });

  it("names a few extensionless files by name", () => {
    expect(languageFor("src-tauri/Cargo.lock")).toBe("toml");
    expect(languageFor("Dockerfile")).toBe("shellscript");
    expect(languageFor(".gitignore")).toBe("shellscript");
  });

  it("treats a leading dot as the name, not an extension", () => {
    // `.gitignore` is not a file with the extension `gitignore`.
    expect(languageFor(".editorconfig")).toBeNull();
  });

  it("answers null for anything it has no grammar for", () => {
    expect(languageFor("notes.xyz")).toBeNull();
    expect(languageFor("LICENSE")).toBeNull();
  });
});

describe("tokenize", () => {
  afterEach(() => vi.restoreAllMocks());

  it("colours code with the HUD's own palette, never a stock theme", async () => {
    const lines = await tokenize('const x = "hi";', "typescript");
    const flat = lines.flat();
    const colours = flat.map((t) => t.color?.toLowerCase()).filter(Boolean);

    // Everything it emits must be a colour we chose — a stray hex would mean a stock theme leaked in.
    // Both sources count: the syntax theme is built from the terminal palette, which is TERMINAL_ANSI
    // rather than the HUD accents (see the comment there — the accents are read ON a surface, these
    // ARE surfaces).
    const ours = [...Object.values(PALETTE), ...Object.values(TERMINAL_ANSI)].map((c) =>
      c.toLowerCase(),
    );
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) expect(ours).toContain(colour);
  });

  it("keeps every line, including the empty ones", async () => {
    const lines = await tokenize("const a = 1;\n\nconst b = 2;", "typescript");
    expect(lines).toHaveLength(3);
    expect(lines[1]?.flatMap((t) => t.content).join("")).toBe("");
  });

  it("reproduces the source exactly — a highlighter may not alter what it shows", async () => {
    const source = "function greet(name: string) {\n  return `hi ${name}`;\n}";
    const lines = await tokenize(source, "typescript");
    expect(lines.map((line) => line.map((t) => t.content).join("")).join("\n")).toBe(source);
  });

  it("returns plain lines for a language it has no grammar for", async () => {
    const lines = await tokenize("some text\nmore text", null);
    expect(lines).toEqual([[{ content: "some text" }], [{ content: "more text" }]]);
  });

  it("falls back to plain text rather than losing the content when highlighting fails", async () => {
    // Reading the diff beats colouring it: a highlighter that throws must cost colour, not content.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lines = await tokenize("let x = 1;", "not-a-language");
    expect(lines).toEqual([[{ content: "let x = 1;" }]]);
    expect(warn).not.toHaveBeenCalled(); // an unknown language is expected, not an error
  });

  it("highlights more than one language in the same session", async () => {
    const rust = await tokenize("fn main() {}", "rust");
    const json = await tokenize('{"a": 1}', "json");
    expect(rust.flat().some((t) => t.color)).toBe(true);
    expect(json.flat().some((t) => t.color)).toBe(true);
  });
});

describe("languageForTag", () => {
  it("takes the language NAME a fence is labelled with", () => {
    // The whole reason this is separate from `languageFor`: a fence says ```python, and no file is
    // ever called `x.python`, so the extension table alone answers null for the commonest tags.
    expect(languageForTag("python")).toBe("python");
    expect(languageForTag("markdown")).toBe("markdown");
    expect(languageForTag("shellscript")).toBe("shellscript");
  });

  it("still takes the short forms people actually type", () => {
    expect(languageForTag("py")).toBe("python");
    expect(languageForTag("sh")).toBe("shellscript");
    expect(languageForTag("bash")).toBe("shellscript");
    expect(languageForTag("zsh")).toBe("shellscript");
    expect(languageForTag("rs")).toBe("rust");
    expect(languageForTag("yml")).toBe("yaml");
    expect(languageForTag("html")).toBe("html");
  });

  it("ignores case and stray spacing, which a fence tag collects", () => {
    expect(languageForTag(" Bash ")).toBe("shellscript");
    expect(languageForTag("HTML")).toBe("html");
  });

  it("answers null for a language we have no grammar for, and for a bare fence", () => {
    // Not an error: the block renders in the foreground colour, exactly as every fence did before.
    expect(languageForTag("perl")).toBeNull();
    expect(languageForTag("")).toBeNull();
    expect(languageForTag("   ")).toBeNull();
  });
});
