#!/usr/bin/env node
/**
 * Turn a VS Code colour theme into a `.yggtheme` (iTerm2 plist).
 *
 * **Why a script and not twenty hand-written numbers.** The iTerm2 format stores every channel as a
 * floating-point fraction inside a plist dictionary — twenty colours is sixty numbers, each an
 * opportunity for a digit to be wrong in a way nobody sees until a specific escape sequence turns up
 * in somebody's output. The conversion is arithmetic; arithmetic belongs in a program.
 *
 * **What it does NOT do:** invent colours. A VS Code theme that leaves an ANSI slot undefined leaves
 * it undefined here too, and the app falls back to the HUD's own value for it — which is what an
 * imported theme missing a colour is supposed to mean (`theme::resolve`). Guessing a bright variant
 * by lightening the base is how an imported theme stops looking like the theme it came from.
 *
 *   node scripts/project/vscode-to-yggtheme.mjs <theme.json> <out.yggtheme> "Display Name"
 */
import { readFileSync, writeFileSync } from "node:fs";

/** iTerm2's key for each VS Code colour id. Order is the plist's, which is alphabetical. */
const MAPPING = [
  ["Ansi 0 Color", "terminal.ansiBlack"],
  ["Ansi 1 Color", "terminal.ansiRed"],
  ["Ansi 2 Color", "terminal.ansiGreen"],
  ["Ansi 3 Color", "terminal.ansiYellow"],
  ["Ansi 4 Color", "terminal.ansiBlue"],
  ["Ansi 5 Color", "terminal.ansiMagenta"],
  ["Ansi 6 Color", "terminal.ansiCyan"],
  ["Ansi 7 Color", "terminal.ansiWhite"],
  ["Ansi 8 Color", "terminal.ansiBrightBlack"],
  ["Ansi 9 Color", "terminal.ansiBrightRed"],
  ["Ansi 10 Color", "terminal.ansiBrightGreen"],
  ["Ansi 11 Color", "terminal.ansiBrightYellow"],
  ["Ansi 12 Color", "terminal.ansiBrightBlue"],
  ["Ansi 13 Color", "terminal.ansiBrightMagenta"],
  ["Ansi 14 Color", "terminal.ansiBrightCyan"],
  ["Ansi 15 Color", "terminal.ansiBrightWhite"],
  ["Background Color", "terminal.background"],
  ["Foreground Color", "terminal.foreground"],
  ["Cursor Color", "terminalCursor.foreground"],
  ["Selection Color", "terminal.selectionBackground"],
];

/**
 * `#rrggbb` (or `#rgb`) as the three fractions iTerm2 stores.
 *
 * Returns `null` for anything else — including the `#rrggbbaa` form, whose alpha this format has no
 * place for. Refusing beats silently dropping the transparency and shipping a colour the theme's
 * author never chose.
 */
export function parseHex(value) {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const channel = (at) => parseInt(full.slice(at, at + 2), 16) / 255;
  return { red: channel(0), green: channel(2), blue: channel(4) };
}

/** One colour, as the plist writes it. */
function colourEntry(key, { red, green, blue }) {
  // The channel order is the plist's own: alpha, blue, colour space, green, red. Kept identical to
  // what iTerm2 emits so a diff against a theme exported from it is empty rather than noisy.
  return [
    `\t<key>${key}</key>`,
    "\t<dict>",
    "\t\t<key>Alpha Component</key>",
    "\t\t<real>1</real>",
    "\t\t<key>Blue Component</key>",
    `\t\t<real>${blue}</real>`,
    "\t\t<key>Color Space</key>",
    "\t\t<string>sRGB</string>",
    "\t\t<key>Green Component</key>",
    `\t\t<real>${green}</real>`,
    "\t\t<key>Red Component</key>",
    `\t\t<real>${red}</real>`,
    "\t</dict>",
  ].join("\n");
}

/** The whole file. `colors` is a VS Code theme's colour map. */
export function convert(colors) {
  const missing = [];
  const entries = [];

  for (const [itermKey, vscodeKey] of MAPPING) {
    const parsed = parseHex(colors[vscodeKey]);
    if (parsed === null) {
      // Recorded and reported, never guessed: an ANSI slot the source leaves out falls back to the
      // HUD's own colour, which is what "this theme does not define it" is supposed to mean.
      missing.push(vscodeKey);
      continue;
    }
    entries.push(colourEntry(itermKey, parsed));
  }

  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    ...entries,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");

  return { plist, missing };
}

const [, , source, target] = process.argv;
if (source && target) {
  const theme = JSON.parse(readFileSync(source, "utf8"));
  const { plist, missing } = convert(theme.colors ?? {});
  writeFileSync(target, plist);
  console.log(`wrote ${target} from ${theme.name ?? source}`);
  if (missing.length > 0) {
    console.log(`  not defined by the source, left to the HUD default: ${missing.join(", ")}`);
  }
}
