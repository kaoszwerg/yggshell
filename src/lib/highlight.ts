import { createHighlighterCore, type HighlighterCore, type ThemeRegistration } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { HUD_TERMINAL_THEME as HUD_COLOURS, type XtermTheme } from "./terminalTheme";

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

/**
 * Build a shiki theme out of a terminal colour scheme.
 *
 * A colour scheme is sixteen ANSI slots plus a foreground and a background — which is exactly what
 * every terminal syntax highlighter has ever had to work with, and it is enough: keywords take the
 * scheme's magenta, strings its green, comments its bright black. That is what makes "configure the
 * diff's colours" the same act as "configure a terminal's", rather than a second palette to maintain.
 *
 * With no scheme the HUD's own colours are used, which is what `PALETTE` is for.
 */
function syntaxTheme(scheme: XtermTheme | null): ThemeRegistration {
  const c = scheme ?? HUD_COLOURS;
  return {
    name: "hud",
    type: "dark",
    colors: {
      "editor.background": c.background,
      "editor.foreground": c.foreground,
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: c.brightBlack },
      },
      {
        scope: ["string", "constant.other.symbol", "string.regexp"],
        settings: { foreground: c.green },
      },
      {
        scope: ["constant.numeric", "constant.language", "constant.character"],
        settings: { foreground: c.yellow },
      },
      {
        scope: ["keyword", "storage", "storage.type", "keyword.operator.new"],
        settings: { foreground: c.magenta },
      },
      {
        scope: ["entity.name.function", "support.function", "meta.function-call"],
        settings: { foreground: c.blue },
      },
      {
        scope: ["entity.name.type", "support.type", "support.class", "entity.name.class"],
        settings: { foreground: c.yellow },
      },
      { scope: ["variable.parameter", "variable.other"], settings: { foreground: c.foreground } },
      {
        scope: ["entity.name.tag", "punctuation.definition.tag"],
        settings: { foreground: c.magenta },
      },
      { scope: ["entity.other.attribute-name"], settings: { foreground: c.cyan } },
      { scope: ["invalid", "invalid.illegal"], settings: { foreground: c.red } },
      { scope: ["markup.heading"], settings: { foreground: c.cyan } },
      { scope: ["markup.inserted"], settings: { foreground: c.green } },
      { scope: ["markup.deleted"], settings: { foreground: c.red } },
    ],
  };
}

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
const themes = new Set<string>();

function core(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [syntaxTheme(null)],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

/** A scheme to colour with: its id names the shiki theme, its colours build it. */
export interface SyntaxScheme {
  id: string;
  colours: XtermTheme;
}

/**
 * Colour `code`, one array of tokens per line.
 *
 * Falls back to a single uncoloured token per line whenever anything at all goes wrong — an unknown
 * language, a grammar that fails to load, a highlighter that will not start. **Reading the diff
 * always wins over colouring it**: this is a viewer, and a viewer that shows nothing because the
 * syntax highlighter had an opinion is worse than one that shows plain text.
 */
export async function tokenize(
  code: string,
  language: string | null,
  scheme?: SyntaxScheme | null,
): Promise<Token[][]> {
  const plain = () => code.split("\n").map((line) => [{ content: line }]);
  const loader = language === null ? undefined : LOADERS.get(language);
  if (language === null || loader === undefined) return plain();

  try {
    const shiki = await core();
    if (!loaded.has(language)) {
      await shiki.loadLanguage((await loader()) as never);
      loaded.add(language);
    }
    // A theme per scheme, registered once and named after it. Registering it under one shared name
    // would mean the last diff rendered decided the colours of every other.
    let name = "hud";
    if (scheme) {
      name = `hud-${scheme.id}`;
      if (!themes.has(name)) {
        await shiki.loadTheme({ ...syntaxTheme(scheme.colours), name });
        themes.add(name);
      }
    }
    const { tokens } = shiki.codeToTokens(code, { lang: language, theme: name });
    return tokens.map((line) =>
      line.map((token) => ({ content: token.content, color: token.color })),
    );
  } catch (error) {
    // Surfaced rather than swallowed (rule:logging) — and the diff still renders.
    console.warn(`highlight: could not colour ${language} —`, error);
    return plain();
  }
}
