import type { MessageKey } from "../i18n";

/**
 * Inserting markdown at the caret — the logic behind the editor's toolbar, with no DOM in it.
 *
 * **Kept out of the component on purpose.** What a button does to a piece of text is exactly the part
 * worth pinning: where the caret lands, whether a selection survives, what happens on the second
 * press. Held inside a click handler none of that is reachable by a test, and every one of those
 * answers is a decision somebody will change later (rule:testing, ADR-CORE-005).
 *
 * **No placeholder words anywhere.** An inserted `**text**` has to be selected and deleted before the
 * user can type, and it is a word in *some* language, which makes it either wrong or a catalogue
 * entry for content nobody reads. Empty markers with the caret in the right place cost the user
 * nothing: `**|**`, and they type.
 */

/** What a toolbar button does to the text. */
export type Construct = {
  id: ConstructId;
  /** The catalogue key for its tooltip — `notes.insert.<id>`, checked by a test. */
  label: MessageKey;
} & Behaviour;

export type ConstructId =
  | "heading"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "fence"
  | "table"
  | "rule"
  | "link"
  | "image";

type Behaviour =
  /** Markers either side of the selection: `**bold**`, `` `code` ``. */
  | { kind: "wrap"; before: string; after: string }
  /**
   * A marker at the start of every line the selection touches: `- `, `> `, `## `.
   *
   * `prefix` takes the line's index within the selection, which is what lets an ordered list count
   * instead of writing `1.` three times.
   */
  | { kind: "line"; prefix: (index: number) => string }
  /**
   * A construct that owns its own lines: a fence, a table, a rule.
   *
   * `build` receives whatever was selected — a fence wraps it, a table ignores it — and returns the
   * text plus where the caret goes inside it.
   */
  | { kind: "block"; build: (selection: string) => { text: string; caret: number } };

/** The result of pressing a button: the new text, and the selection to restore. */
export type Insertion = { value: string; start: number; end: number };

/**
 * Every element the renderer can draw, grouped the way a writer thinks about them.
 *
 * **Grouped by what the thing IS, not by how the parser sees it.** The first cut ordered these
 * inline-first then block, which is a fact about `parseMarkdown` and not about writing — it put
 * inline code four places away from a code fence, and that was reported within a minute of it being
 * on screen. The order inside a group runs from the one reached for most often to the least.
 *
 * The toolbar draws a divider between groups, so the grouping is visible rather than merely intended.
 *
 * **`html` is deliberately absent.** `parseMarkdown` carries an `html` block, but that is its escape
 * hatch for markup it will not interpret — not an element anyone means to insert, and a button for it
 * would offer the one construct this app cannot render meaningfully.
 */
export const GROUPS: Construct[][] = [
  // Text: the heading that structures a note, and the marks that emphasise a word inside it.
  //
  // `##`, not `#`, because the note's own title already IS the `#` — a note is created as
  // `# <topic>` (`NotesTool`), so a heading written into the body sits a level below it.
  [
    { id: "heading", label: "notes.insert.heading", kind: "line", prefix: () => "## " },
    { id: "bold", label: "notes.insert.bold", kind: "wrap", before: "**", after: "**" },
    { id: "italic", label: "notes.insert.italic", kind: "wrap", before: "*", after: "*" },
    { id: "strike", label: "notes.insert.strike", kind: "wrap", before: "~~", after: "~~" },
  ],
  // Lists — the three that share a gesture: a marker per line.
  [
    { id: "bullet", label: "notes.insert.bullet", kind: "line", prefix: () => "- " },
    {
      id: "ordered",
      label: "notes.insert.ordered",
      kind: "line",
      prefix: (index) => `${String(index + 1)}. `,
    },
    { id: "task", label: "notes.insert.task", kind: "line", prefix: () => "- [ ] " },
  ],
  // Code, both sizes of it, side by side. This pair is why the grouping exists.
  [
    { id: "code", label: "notes.insert.code", kind: "wrap", before: "`", after: "`" },
    {
      id: "fence",
      label: "notes.insert.fence",
      kind: "block",
      // The caret lands on the empty line between the fences, where the code goes. A selection
      // becomes the contents rather than being pushed aside.
      build: (selection) => ({ text: "```\n" + selection + "\n```", caret: 4 + selection.length }),
    },
  ],
  // Things that point elsewhere.
  [
    { id: "link", label: "notes.insert.link", kind: "wrap", before: "[", after: "]()" },
    { id: "image", label: "notes.insert.image", kind: "wrap", before: "![", after: "]()" },
  ],
  // The larger structures, which reshape a page rather than a line.
  [
    { id: "quote", label: "notes.insert.quote", kind: "line", prefix: () => "> " },
    {
      id: "table",
      label: "notes.insert.table",
      kind: "block",
      // Empty cells, not placeholder words — but the separator row is not optional: without it this
      // is three lines of pipes and the renderer draws no table at all.
      build: () => ({ text: "|  |  |\n| --- | --- |\n|  |  |\n", caret: 2 }),
    },
    {
      id: "rule",
      label: "notes.insert.rule",
      kind: "block",
      build: () => ({ text: "---\n", caret: 4 }),
    },
  ],
];

/** Every construct in toolbar order — derived, so it cannot drift from the groups. */
export const CONSTRUCTS: Construct[] = GROUPS.flat();

/** Where the line under `at` begins. */
function lineStart(value: string, at: number): number {
  return value.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
}

/** Where the line under `at` ends (the index of its newline, or the end of the text). */
function lineEnd(value: string, at: number): number {
  const next = value.indexOf("\n", at);
  return next === -1 ? value.length : next;
}

/**
 * Apply a construct to `value` at the given selection.
 *
 * Returns the new text and the selection to restore — the caller writes both, because a controlled
 * `<textarea>` loses the caret on every re-render otherwise.
 */
export function applyConstruct(
  value: string,
  start: number,
  end: number,
  construct: Construct,
): Insertion {
  if (construct.kind === "wrap") return wrap(value, start, end, construct);
  if (construct.kind === "line") return line(value, start, end, construct);
  return block(value, start, end, construct);
}

function wrap(
  value: string,
  start: number,
  end: number,
  { before, after }: { before: string; after: string },
): Insertion {
  const selected = value.slice(start, end);
  const text = before + selected + after;
  const value_ = value.slice(0, start) + text + value.slice(end);

  // Nothing selected: the caret goes between the markers, ready to type.
  if (selected === "") {
    const caret = start + before.length;
    return { value: value_, start: caret, end: caret };
  }
  // A link keeps its selection as the label but the useful place to be is the URL — the one thing
  // the user certainly does not have yet. Detected by the closing marker carrying the parens rather
  // than by the id, so a future construct shaped like this behaves the same way.
  if (after.endsWith("()")) {
    const caret = start + before.length + selected.length + after.length - 1;
    return { value: value_, start: caret, end: caret };
  }
  // Otherwise the selection survives, so a second format can be applied straight after.
  return {
    value: value_,
    start: start + before.length,
    end: start + before.length + selected.length,
  };
}

function line(
  value: string,
  start: number,
  end: number,
  { prefix }: { prefix: (index: number) => string },
): Insertion {
  const from = lineStart(value, start);
  const to = lineEnd(value, end);
  const lines = value.slice(from, to).split("\n");

  let counted = 0;
  const prefixed = lines.map((text) => {
    // A blank line inside a MULTI-line selection stays blank: a bullet with nothing after it is not
    // an item, and it is what makes "select the paragraph, press list" leave stray markers between
    // the paragraphs. On a single line it is the opposite — an empty line the caret is sitting on is
    // precisely where somebody means to start a list.
    if (lines.length > 1 && text.trim() === "") return text;
    const mark = prefix(counted);
    counted += 1;
    // Pressing the same button twice is something people do, and "- - milk" is not a list.
    return text.startsWith(mark) ? text : mark + text;
  });

  const replaced = prefixed.join("\n");
  const value_ = value.slice(0, from) + replaced + value.slice(to);
  // The caret follows the text it was in: with nothing selected it lands after the marker it just
  // gained, which is where typing continues.
  const grew = replaced.length - (to - from);
  return { value: value_, start: start + grew, end: end + grew };
}

function block(
  value: string,
  start: number,
  end: number,
  { build }: { build: (selection: string) => { text: string; caret: number } },
): Insertion {
  const selected = value.slice(start, end);
  const { text, caret } = build(selected);

  // A block owns its line. Dropping "---" onto the end of a sentence gives a strange sentence, not a
  // rule — so it starts on a fresh line, with a blank one between it and whatever came before.
  const before = value.slice(0, start);
  const lead =
    before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const value_ = before + lead + text + value.slice(end);
  const at = start + lead.length + caret;
  return { value: value_, start: at, end: at };
}
