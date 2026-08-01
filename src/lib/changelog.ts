/**
 * Reading our own changelog.
 *
 * Here rather than beside the component: these are pure functions of a string, and a file that
 * exports both components and helpers breaks React Fast Refresh — editing the parser would remount
 * the whole interface, terminals included.
 */

/** One line of the changelog, classified by the little markdown it actually uses. */
export type Line =
  | { kind: "release"; text: string }
  | { kind: "section"; text: string }
  | { kind: "item"; text: string }
  | { kind: "text"; text: string };

/**
 * Split the changelog into the four shapes it is written in.
 *
 * **Not a markdown renderer, and deliberately not.** The file uses exactly three constructs —
 * `## version`, `### section`, `- item` — and a parser for those is fifteen lines. Pulling in a
 * markdown library to read our own file, with its own sanitiser to argue about, would be a
 * dependency justified by nothing (rule:dependencies).
 *
 * Everything unrecognised stays as it is rather than being dropped, which is what keeps this honest
 * when somebody writes a paragraph the parser has never seen.
 */
export function parseChangelog(text: string): Line[] {
  return text.split("\n").map((raw) => {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) return { kind: "release", text: line.slice(3) };
    if (line.startsWith("### ")) return { kind: "section", text: line.slice(4) };
    if (line.startsWith("- ")) return { kind: "item", text: line.slice(2) };
    return { kind: "text", text: line };
  });
}

/** Strip the emphasis markers markdown uses, since nothing here renders them. */
export function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
}
