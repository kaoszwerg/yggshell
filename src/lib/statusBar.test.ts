import { describe, it, expect } from "vitest";
import {
  availableItems,
  defaultLayout,
  insertItem,
  isRepeatable,
  makeItem,
  moveItem,
  removeItem,
  sanitiseLayout,
} from "./statusBar";

const ids = (layout: { id: string }[]) => layout.map((i) => i.id);

describe("the status bar layout", () => {
  it("starts with something worth having", () => {
    expect(ids(defaultLayout())).toEqual([
      "version",
      "spacer",
      "command",
      "separator",
      "repository",
    ]);
  });

  it("gives every placed item its own identity", () => {
    // Two spacers are two elements. Keyed by id, a drag would move the wrong one.
    const two = [makeItem("spacer"), makeItem("spacer")];
    expect(two[0]?.key).not.toBe(two[1]?.key);
  });

  it("offers spacers and separators over and over, and the rest once", () => {
    expect(isRepeatable("spacer")).toBe(true);
    expect(isRepeatable("separator")).toBe(true);
    expect(isRepeatable("repository")).toBe(false);

    const placed = [makeItem("version"), makeItem("spacer")];
    const offered = availableItems(placed);
    expect(offered).toContain("spacer");
    expect(offered).not.toContain("version");
  });

  it("inserts where it is dropped", () => {
    const layout = [makeItem("version"), makeItem("repository")];
    expect(ids(insertItem(layout, "spacer", 1))).toEqual(["version", "spacer", "repository"]);
    expect(ids(insertItem(layout, "spacer", 0))).toEqual(["spacer", "version", "repository"]);
    expect(ids(insertItem(layout, "spacer", 99))).toEqual(["version", "repository", "spacer"]);
  });

  it("refuses a second copy of something that is one fact", () => {
    const layout = [makeItem("repository")];
    expect(ids(insertItem(layout, "repository", 0))).toEqual(["repository"]);
  });

  it("moves an item to where it was dropped, counting from the closed gap", () => {
    // The classic off-by-one: an index taken from the original list is one too far once the moved
    // item's own gap closes behind it.
    const layout = [makeItem("version"), makeItem("spacer"), makeItem("repository")];
    expect(ids(moveItem(layout, 0, 2))).toEqual(["spacer", "repository", "version"]);
    expect(ids(moveItem(layout, 2, 0))).toEqual(["repository", "version", "spacer"]);
    expect(ids(moveItem(layout, 1, 1))).toEqual(["version", "spacer", "repository"]);
  });

  it("survives a move that names nothing", () => {
    const layout = [makeItem("version")];
    expect(ids(moveItem(layout, 5, 0))).toEqual(["version"]);
  });

  it("removes by key, so one spacer goes and the other stays", () => {
    const layout = [makeItem("spacer"), makeItem("version"), makeItem("spacer")];
    const first = layout[0]?.key ?? "";
    expect(ids(removeItem(layout, first))).toEqual(["version", "spacer"]);
  });
});

describe("sanitiseLayout", () => {
  it("keeps a good payload, and the keys that are usable", () => {
    // Keys must SURVIVE: this runs on every edit, and a fresh key for each item hands React a list
    // it has never seen, which unmounts and remounts everything — losing focus mid-move.
    const stored = [
      { key: "one", id: "version" },
      { key: "two", id: "spacer" },
    ];
    const clean = sanitiseLayout(stored);
    expect(ids(clean)).toEqual(["version", "spacer"]);
    expect(clean.map((i) => i.key)).toEqual(["one", "two"]);
  });

  it("replaces a key that two entries claim, so they are not the same element", () => {
    const clean = sanitiseLayout([
      { key: "same", id: "version" },
      { key: "same", id: "spacer" },
    ]);
    expect(clean[0]?.key).not.toBe(clean[1]?.key);
  });

  it("issues a key to an entry that has none", () => {
    const clean = sanitiseLayout([{ id: "version" }]);
    expect(clean[0]?.key).toBeTypeOf("string");
    expect(clean[0]?.key).not.toBe("");
  });

  it("drops an id it does not know rather than rendering a blank", () => {
    // A payload from a newer build, or one somebody edited by hand.
    expect(ids(sanitiseLayout([{ id: "version" }, { id: "teleporter" }]))).toEqual(["version"]);
  });

  it("drops a duplicate of something unique rather than showing it twice", () => {
    expect(ids(sanitiseLayout([{ id: "repository" }, { id: "repository" }]))).toEqual([
      "repository",
    ]);
  });

  it("keeps an empty bar, because removing everything is a choice", () => {
    expect(sanitiseLayout([])).toEqual([]);
  });

  it("falls back to the defaults when nothing in the payload is usable", () => {
    expect(ids(sanitiseLayout([{ id: "nope" }, null, 42]))).toEqual(ids(defaultLayout()));
    expect(ids(sanitiseLayout("not a list"))).toEqual(ids(defaultLayout()));
    expect(ids(sanitiseLayout(undefined))).toEqual(ids(defaultLayout()));
  });
});
