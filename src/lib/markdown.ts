/**
 * Just enough markdown to render our own two documents.
 *
 * **Why not a library.** `marked` or `markdown-it` would each bring a full CommonMark implementation
 * and, with it, the question of sanitising their HTML output — two dependencies to display two files
 * that ship inside the binary and are written by us (rule:dependencies: justify it, prefer the
 * smaller thing). This parses the constructs those files actually contain and produces *data*, not
 * HTML, so there is no markup to sanitise in the first place.
 *
 * **What it handles**, because it is what `CHANGELOG.md` and `CREDITS.md` use: headings, paragraphs,
 * bullet lists, tables, and inline `code`, `**bold**` and `[links](url)`.
 *
 * **What it does not**: anything else. An unrecognised line becomes a paragraph rather than
 * disappearing — a renderer that silently drops what it does not understand turns a licence notice
 * into a shorter licence notice, and nobody notices until the missing line is the one that mattered.
 */

/** A run of inline content. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "link"; text: string; href: string };

/** A block-level element. */
export type Block =
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

/**
 * Split one line into its inline runs.
 *
 * One pass with a combined pattern rather than three passes: nested markers (`[`code`](url)`, which
 * both our files use) would otherwise be mangled by whichever pass ran first.
 */
export function parseInline(text: string): Inline[] {
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;
  const out: Inline[] = [];
  let at = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > at) out.push({ kind: "text", text: text.slice(at, index) });

    const [, linkText, href, code, strong] = match;
    if (href !== undefined && linkText !== undefined) {
      // The label may itself be `code` — that is how both files write repository names.
      out.push({ kind: "link", text: linkText.replace(/`/g, ""), href });
    } else if (code !== undefined) {
      out.push({ kind: "code", text: code });
    } else if (strong !== undefined) {
      out.push({ kind: "strong", text: strong });
    }
    at = index + match[0].length;
  }

  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

/** Split a table row into its cells, dropping the leading and trailing pipes. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Whether a line is the `| --- | --- |` separator under a table's head. */
function isTableDivider(line: string): boolean {
  return /^\|?[\s:-]+\|[\s:|-]*$/.test(line.trim()) && line.includes("-");
}

/** Parse a whole document into blocks. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines.at(i) ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1]?.length ?? 1,
        content: parseInline(heading[2] ?? ""),
      });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    // A table: a pipe row followed by a divider. Checked together, because a paragraph containing a
    // pipe is not a table and turning one into a lopsided grid is worse than leaving it as prose.
    if (trimmed.startsWith("|") && isTableDivider(lines.at(i + 1) ?? "")) {
      flushParagraph();
      const head = cells(trimmed).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && (lines.at(i) ?? "").trim().startsWith("|")) {
        rows.push(cells(lines.at(i) ?? "").map(parseInline));
        i++;
      }
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      // Collected as TEXT and parsed once at the end, per item. A bullet in the changelog routinely
      // wraps across three lines with a `**bold**` run split down the middle — parsing each source
      // line on its own would leave the markers stranded and print them.
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines.at(i) ?? "";
        const start = /^\s*[-*]\s+(.*)$/.exec(item);
        if (start) {
          items.push(start[1] ?? "");
          i++;
          continue;
        }
        // A wrapped continuation line belongs to the item above it.
        const last = items.at(-1);
        if (item.startsWith("  ") && item.trim() !== "" && last !== undefined) {
          items.splice(items.length - 1, 1, `${last} ${item.trim()}`);
          i++;
          continue;
        }
        break;
      }
      i--;
      blocks.push({ kind: "list", items: items.map(parseInline) });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}
