import { describe, it, expect } from "vitest";
import { CONSTRUCTS, GROUPS, applyConstruct, type ConstructId } from "./markdownInsert";

/** Apply by id, so a test reads like the button the user pressed. */
function press(id: ConstructId, value: string, start: number, end = start) {
  const construct = CONSTRUCTS.find((c) => c.id === id);
  if (construct === undefined) throw new Error(`no construct ${id}`);
  return applyConstruct(value, start, end, construct);
}

/** The text with `|` where the caret is, or `[…]` around the selection — easier to read than indices. */
function shown(result: { value: string; start: number; end: number }) {
  const { value, start, end } = result;
  return start === end
    ? `${value.slice(0, start)}|${value.slice(start)}`
    : `${value.slice(0, start)}[${value.slice(start, end)}]${value.slice(end)}`;
}

describe("applyConstruct — wrapping constructs", () => {
  it("wraps the selection and keeps it selected, so a second format can follow", () => {
    const out = press("bold", "make this loud", 5, 9);

    expect(out.value).toBe("make **this** loud");
    expect(shown(out)).toBe("make **[this]** loud");
  });

  it("puts the caret BETWEEN the markers when nothing is selected", () => {
    // The point of no placeholder text: there is nothing to delete before typing.
    expect(shown(press("bold", "", 0))).toBe("**|**");
    expect(shown(press("italic", "", 0))).toBe("*|*");
    expect(shown(press("strike", "", 0))).toBe("~~|~~");
    expect(shown(press("code", "", 0))).toBe("`|`");
  });

  it("keeps the rest of the line untouched", () => {
    const out = press("code", "run npm test now", 4, 12);
    expect(out.value).toBe("run `npm test` now");
  });
});

describe("applyConstruct — line prefixes", () => {
  it("prefixes the line the caret is on, not the caret position", () => {
    // Pressing "list" in the middle of a word must still produce a list item.
    const out = press("bullet", "shopping", 4);
    expect(out.value).toBe("- shopping");
  });

  it("prefixes EVERY line the selection touches", () => {
    const out = press("bullet", "milk\nbread\neggs", 0, 15);

    expect(out.value).toBe("- milk\n- bread\n- eggs");
  });

  it("numbers an ordered list rather than repeating 1.", () => {
    const out = press("ordered", "first\nsecond\nthird", 0, 18);

    expect(out.value).toBe("1. first\n2. second\n3. third");
  });

  it("leaves a blank line inside a selection alone", () => {
    // Prefixing an empty line produces a stray bullet with nothing in it.
    const out = press("bullet", "milk\n\neggs", 0, 10);

    expect(out.value).toBe("- milk\n\n- eggs");
  });

  it("moves the caret past the prefix it just added", () => {
    expect(shown(press("task", "", 0))).toBe("- [ ] |");
    expect(shown(press("heading", "", 0))).toBe("## |");
    expect(shown(press("quote", "", 0))).toBe("> |");
  });

  it("does not double a prefix that is already there", () => {
    // Pressing the same button twice is a thing people do; "- - milk" is not a list.
    const once = press("bullet", "milk", 0);
    const twice = press("bullet", once.value, once.start);

    expect(twice.value).toBe("- milk");
  });
});

describe("applyConstruct — whole blocks", () => {
  it("opens a fence on its own lines with the caret inside", () => {
    expect(shown(press("fence", "", 0))).toBe("```\n|\n```");
  });

  it("puts a block on a fresh line when the caret sits in text", () => {
    // Appending "---" to the end of a sentence is not a rule, it is a strange sentence.
    const out = press("rule", "the end", 7);

    expect(out.value).toBe("the end\n\n---\n");
  });

  it("does not add a blank line when the line is already empty", () => {
    const out = press("rule", "", 0);

    expect(out.value).toBe("---\n");
  });

  it("builds a table that actually renders, with the caret in the first cell", () => {
    const out = press("table", "", 0);

    // The separator row is what makes it a table rather than three lines of pipes.
    expect(out.value).toBe("|  |  |\n| --- | --- |\n|  |  |\n");
    expect(out.start).toBe(2);
  });

  it("wraps a selection as the fence's contents", () => {
    const out = press("fence", "npm run build", 0, 13);

    expect(out.value).toBe("```\nnpm run build\n```");
  });
});

describe("applyConstruct — link and image", () => {
  it("makes the selection the link text and points the caret at the url", () => {
    const out = press("link", "see the docs", 8, 12);

    expect(out.value).toBe("see the [docs]()");
    expect(shown(out)).toBe("see the [docs](|)");
  });

  it("puts the caret in the label when there is no selection", () => {
    expect(shown(press("link", "", 0))).toBe("[|]()");
    expect(shown(press("image", "", 0))).toBe("![|]()");
  });
});

describe("CONSTRUCTS", () => {
  it("offers every element this app renders, and nothing it does not", () => {
    // The toolbar's promise is "every markdown element YggShell supports". `html` is deliberately
    // absent: it is the parser's escape hatch, not something you insert.
    expect(CONSTRUCTS.map((c) => c.id)).toEqual([
      "heading",
      "bold",
      "italic",
      "strike",
      "bullet",
      "ordered",
      "task",
      "code",
      "fence",
      "link",
      "image",
      "quote",
      "table",
      "rule",
    ]);
  });

  it("groups by what the thing IS, not by how it is implemented", () => {
    // The first cut ordered them inline-first then block, which is a fact about the parser and not
    // about writing: it put inline code four places away from a code fence. Reported.
    expect(GROUPS.map((group) => group.map((c) => c.id))).toEqual([
      ["heading", "bold", "italic", "strike"],
      ["bullet", "ordered", "task"],
      ["code", "fence"],
      ["link", "image"],
      ["quote", "table", "rule"],
    ]);
  });

  it("keeps the flat list and the groups in step", () => {
    // `CONSTRUCTS` is derived from `GROUPS`, so a construct cannot exist in one and not the other —
    // which is what would happen if the toolbar rendered groups and a test checked a hand-kept list.
    expect(CONSTRUCTS).toEqual(GROUPS.flat());
  });

  it("gives every construct a message key, so none can ship untranslated", () => {
    for (const construct of CONSTRUCTS) {
      expect(construct.label).toBe(`notes.insert.${construct.id}`);
    }
  });
});
