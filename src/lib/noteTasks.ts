import { parseMarkdown } from "./markdown";

/** One task in a note, as the tool shows it: one line, never a body. */
export type Task = {
  title: string;
  done: boolean;
  priority: 0 | 1 | 2;
  /** Byte range of the whole item, body included — what a delete removes and a tick rewrites into. */
  offset: number;
  end: number;
};

/**
 * The task items in a note, flattened to one line each.
 *
 * Parsed with the same parser the view renders with, rather than by matching `- [ ]` here: two
 * readers of one format drift, and the offset this returns is what the backend rewrites — it has to
 * be the parser's, not a guess (ADR-CORE-005).
 */
export function taskItems(text: string): Task[] {
  const out: Task[] = [];
  for (const block of parseMarkdown(text)) {
    if (block.kind !== "list") continue;
    for (const item of block.items) {
      if (item.done === null) continue;
      const first = item.blocks.find((b) => b.kind === "paragraph");
      const title =
        first === undefined
          ? ""
          : (first.content
              .map((run) => ("text" in run ? run.text : ""))
              .join("")
              .split("\n")[0]
              ?.trim() ?? "");
      const priority = title.startsWith("!!") ? 2 : title.startsWith("!") ? 1 : 0;
      out.push({
        title: title.replace(/^!+\s*/, ""),
        done: item.done,
        priority,
        offset: item.at.start,
        end: item.at.end,
      });
    }
  }
  // Priority first, then the order they were written in — a sort order, never a schedule.
  return out.sort((a, b) => b.priority - a.priority);
}
