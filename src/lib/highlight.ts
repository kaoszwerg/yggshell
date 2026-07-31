import { createHighlighterCore, type HighlighterCore, type ThemeRegistration } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { PALETTE } from "../styles/palette";

/**
 * Syntax highlighting for the diff and commit views.
 *
 * Three decisions worth knowing, because each of them is what keeps this from being the usual
 * highlighter drop-in:
 *
 * 1. **Tokens, never HTML.** `codeToTokens` returns a list of `{ content, colour }`; the caller turns
 *    them into React nodes. A highlighter that hands back an HTML string would mean injecting raw
 *    markup over content that came out of a repository someone else wrote — an XSS sink for the sake
 *    of colouring a line, and one this codebase has nowhere else.
 * 2. **Our theme, not theirs.** The palette below is the HUD's own (rule:theming — `PALETTE` is one of
 *    the two places allowed to hold colour). Nothing ships wearing a stock look (ADR-APP-026).
 * 3. **The JavaScript regex engine, so there is no WASM** to ship, load or fail to load — and one
 *    fewer binary in a desktop app that is meant to work offline the first time it is opened.
 *
 * Grammars load on demand: a diff of a Rust file must not cost the user the TypeScript grammar too.
 */

/** The HUD's own token colours. Every value comes from `PALETTE`. */
const HUD_THEME: ThemeRegistration = {
  name: "hud",
  type: "dark",
  colors: {
    "editor.background": PALETTE.deep,
    "editor.foreground": PALETTE.fg,
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: PALETTE.dim } },
    {
      scope: ["string", "constant.other.symbol", "string.regexp"],
      settings: { foreground: PALETTE.green },
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character"],
      settings: { foreground: PALETTE.gold },
    },
    {
      scope: ["keyword", "storage", "storage.type", "keyword.operator.new"],
      settings: { foreground: PALETTE.purple },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: PALETTE.cyan },
    },
    {
      scope: ["entity.name.type", "support.type", "support.class", "entity.name.class"],
      settings: { foreground: PALETTE.gold },
    },
    { scope: ["variable.parameter", "variable.other"], settings: { foreground: PALETTE.fg } },
    {
      scope: ["entity.name.tag", "punctuation.definition.tag"],
      settings: { foreground: PALETTE.purple },
    },
    { scope: ["entity.other.attribute-name"], settings: { foreground: PALETTE.cyan } },
    { scope: ["invalid", "invalid.illegal"], settings: { foreground: PALETTE.danger } },
    { scope: ["markup.heading"], settings: { foreground: PALETTE.cyan } },
    { scope: ["markup.inserted"], settings: { foreground: PALETTE.green } },
    { scope: ["markup.deleted"], settings: { foreground: PALETTE.danger } },
  ],
};

/**
 * The grammars we carry, and the extensions that reach them.
 *
 * An explicit map rather than a computed `import(\`…/${name}\`)`: a bundler can only include what it
 * can see, and a variable path either pulls in all 200 grammars or none of them. This list is meant
 * to grow — adding a language is one line here and one loader below.
 */
const LOADERS = new Map<string, () => Promise<unknown>>([
  ["typescript", () => import("@shikijs/langs/typescript")],
  ["tsx", () => import("@shikijs/langs/tsx")],
  ["javascript", () => import("@shikijs/langs/javascript")],
  ["jsx", () => import("@shikijs/langs/jsx")],
  ["rust", () => import("@shikijs/langs/rust")],
  ["json", () => import("@shikijs/langs/json")],
  ["jsonc", () => import("@shikijs/langs/jsonc")],
  ["toml", () => import("@shikijs/langs/toml")],
  ["yaml", () => import("@shikijs/langs/yaml")],
  ["css", () => import("@shikijs/langs/css")],
  ["html", () => import("@shikijs/langs/html")],
  ["markdown", () => import("@shikijs/langs/markdown")],
  ["shellscript", () => import("@shikijs/langs/shellscript")],
  ["python", () => import("@shikijs/langs/python")],
  ["go", () => import("@shikijs/langs/go")],
  ["sql", () => import("@shikijs/langs/sql")],
]);

/** File extension → grammar. Anything absent renders as plain text, which is a fine outcome. */
const BY_EXTENSION = new Map<string, string>([
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["jsx", "jsx"],
  ["rs", "rust"],
  ["json", "json"],
  ["jsonc", "jsonc"],
  ["toml", "toml"],
  ["lock", "toml"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["css", "css"],
  ["html", "html"],
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["sh", "shellscript"],
  ["bash", "shellscript"],
  ["zsh", "shellscript"],
  ["fish", "shellscript"],
  ["py", "python"],
  ["go", "go"],
  ["sql", "sql"],
]);

/** Files with no extension that still have an obvious grammar. */
const BY_NAME = new Map<string, string>([
  ["Cargo.lock", "toml"],
  ["Dockerfile", "shellscript"],
  ["Makefile", "shellscript"],
  [".zshrc", "shellscript"],
  [".bashrc", "shellscript"],
  [".gitignore", "shellscript"],
]);

/**
 * The grammar for a path, or `null` when we have none.
 *
 * `null` is a normal answer, not a failure: the file still renders, in the foreground colour, and a
 * `.editorconfig` nobody wrote a grammar for is not worth an error.
 */
export function languageFor(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const byName = BY_NAME.get(name);
  if (byName !== undefined) return byName;

  const dot = name.lastIndexOf(".");
  // A leading dot is the whole name (`.gitignore`), not an extension.
  if (dot <= 0) return null;
  return BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? null;
}

/** One coloured run of text. */
export interface Token {
  content: string;
  color?: string;
}

let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

function core(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [HUD_THEME],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

/**
 * Colour `code`, one array of tokens per line.
 *
 * Falls back to a single uncoloured token per line whenever anything at all goes wrong — an unknown
 * language, a grammar that fails to load, a highlighter that will not start. **Reading the diff
 * always wins over colouring it**: this is a viewer, and a viewer that shows nothing because the
 * syntax highlighter had an opinion is worse than one that shows plain text.
 */
export async function tokenize(code: string, language: string | null): Promise<Token[][]> {
  const plain = () => code.split("\n").map((line) => [{ content: line }]);
  const loader = language === null ? undefined : LOADERS.get(language);
  if (language === null || loader === undefined) return plain();

  try {
    const shiki = await core();
    if (!loaded.has(language)) {
      await shiki.loadLanguage((await loader()) as never);
      loaded.add(language);
    }
    const { tokens } = shiki.codeToTokens(code, { lang: language, theme: "hud" });
    return tokens.map((line) =>
      line.map((token) => ({ content: token.content, color: token.color })),
    );
  } catch (error) {
    // Surfaced rather than swallowed (rule:logging) — and the diff still renders.
    console.warn(`highlight: could not colour ${language} —`, error);
    return plain();
  }
}
