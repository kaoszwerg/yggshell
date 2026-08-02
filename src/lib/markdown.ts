import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import type { Nodes, PhrasingContent, RootContent } from "mdast";

/**
 * Markdown for this application — full GFM, parsed to data, rendered by our own components.
 *
 * **Never to HTML.** GFM permits raw HTML, and the tree therefore contains `html` nodes; they render
 * as **literal text**, never as markup. That is what keeps the property this file has always
 * documented — no HTML output means no sanitiser to get wrong — and it matters more now than it did
 * for two documents shipped inside the binary, because a note is content that arrives by paste from
 * anywhere (ADR-PROJ-004).
 *
 * **Why a parser now, when a hand-written one was right before.** The old one handled exactly enough
 * for our own two files, deliberately and correctly. The notes tool needs three things it did not
 * have: task items, fenced code blocks, and — decisively — **source positions**. Ticking a checkbox is
 * not editing; it rewrites `- [ ]` to `- [x]` in the file, which is a question about *which bytes*.
 * Clicking a block to edit it asks the same question again. Growing our own parser to GFM
 * completeness to answer those would have been a far worse bargain than the dependency, which was
 * measured before it was chosen: 55 transitive packages, 4.4 MB, every one MIT.
 *
 * **What is deliberately still ours**: the rendering. Nothing here produces markup, and
 * `components/ui/Markdown.tsx` is the one component that draws it.
 */

/**
 * Where a node came from in the source, in bytes. The reason this parser was chosen.
 *
 * Not exported yet: it is reachable structurally through {@link Block}, and the unused-export check
 * is part of the gate. It becomes an export when the notes view takes it by name.
 */
type Range = { start: number; end: number };

/** A run of inline content. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "emphasis"; text: string }
  | { kind: "strike"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "image"; alt: string; src: string };

/** A block-level element. */
export type Block =
  | { kind: "heading"; level: number; content: Inline[]; at: Range }
  | { kind: "paragraph"; content: Inline[]; at: Range }
  | { kind: "list"; ordered: boolean; items: ListItem[]; at: Range }
  | { kind: "fence"; lang: string; code: string; at: Range }
  | { kind: "quote"; blocks: Block[]; at: Range }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][]; at: Range }
  | { kind: "html"; text: string; at: Range }
  | { kind: "rule"; at: Range };

/** One entry in a list. `done` is `null` unless it is a GFM task item. */
type ListItem = {
  done: boolean | null;
  blocks: Block[];
  at: Range;
};

function range(node: Nodes): Range {
  return {
    start: node.position?.start.offset ?? 0,
    end: node.position?.end.offset ?? 0,
  };
}

/**
 * The text of a subtree with no marks — for the inside of a link, a heading or an emphasis.
 *
 * Also what {@link inline} falls back to for anything it does not model: an unrecognised construct
 * becomes its text rather than disappearing. A renderer that silently drops what it does not
 * understand turns a licence notice into a shorter licence notice, and nobody notices until the
 * missing line is the one that mattered.
 */
function plain(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "inlineCode" || node.type === "html") {
        return node.value;
      }
      if ("children" in node) return plain(node.children);
      if (node.type === "image") return node.alt ?? "";
      return "";
    })
    .join("");
}

/**
 * Flatten phrasing content into runs.
 *
 * Nested emphasis collapses to its text rather than nesting: `**bold _and_ italic**` is vanishingly
 * rare in a note or a licence table, and a recursive inline tree would double the renderer for it.
 * What must NOT collapse is a link's or an image's target, which is why those two carry their own
 * fields.
 */
function inline(nodes: readonly PhrasingContent[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push({ kind: "text", text: node.value });
        break;
      case "inlineCode":
        out.push({ kind: "code", text: node.value });
        break;
      case "strong":
        out.push({ kind: "strong", text: plain(node.children) });
        break;
      case "emphasis":
        out.push({ kind: "emphasis", text: plain(node.children) });
        break;
      case "delete":
        out.push({ kind: "strike", text: plain(node.children) });
        break;
      case "link":
        out.push({ kind: "link", text: plain(node.children), href: node.url });
        break;
      case "image":
        out.push({ kind: "image", alt: node.alt ?? "", src: node.url });
        break;
      case "break":
        out.push({ kind: "text", text: "\n" });
        break;
      case "html":
        // Literal, never markup. See the note at the top of this file.
        out.push({ kind: "text", text: node.value });
        break;
      default:
        out.push({ kind: "text", text: plain([node]) });
    }
  }
  return out;
}

function blocks(nodes: readonly RootContent[]): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    const at = range(node);
    switch (node.type) {
      case "heading":
        out.push({ kind: "heading", level: node.depth, content: inline(node.children), at });
        break;
      case "paragraph":
        out.push({ kind: "paragraph", content: inline(node.children), at });
        break;
      case "code":
        out.push({ kind: "fence", lang: node.lang ?? "", code: node.value, at });
        break;
      case "thematicBreak":
        out.push({ kind: "rule", at });
        break;
      case "blockquote":
        out.push({ kind: "quote", blocks: blocks(node.children), at });
        break;
      case "html":
        out.push({ kind: "html", text: node.value, at });
        break;
      case "list":
        out.push({
          kind: "list",
          ordered: node.ordered === true,
          items: node.children.map((item) => ({
            // `checked` is `null` on an ordinary bullet and a boolean on a GFM task item — which is
            // exactly the distinction the notes tool ticks.
            done: item.checked ?? null,
            blocks: blocks(item.children),
            at: range(item),
          })),
          at,
        });
        break;
      case "table": {
        const [head, ...rest] = node.children;
        out.push({
          kind: "table",
          head: (head?.children ?? []).map((cell) => inline(cell.children)),
          rows: rest.map((row) => row.children.map((cell) => inline(cell.children))),
          at,
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Parse markdown into blocks that know where they came from. */
export function parseMarkdown(source: string): Block[] {
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  return blocks(tree.children);
}
