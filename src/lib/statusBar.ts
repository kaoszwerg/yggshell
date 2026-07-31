/**
 * What the status bar is made of, and how a layout for it is described.
 *
 * **Spacers do the aligning, not fixed regions.** A bar with a `left`/`centre`/`right` slot forces
 * every element into one of three buckets and makes "second from the right" impossible to express.
 * A flat list with flexible spacers is how a toolbar has worked since the NeXT days: the user drops a
 * spacer where they want the gap, and everything follows from that. It also means adding an element
 * later needs no decision about which bucket it belongs in.
 */

/** Everything that can go in the bar. A new element is one entry here and one renderer. */
export const STATUS_ITEMS = {
  version: {
    label: "Version",
    hint: "The version and build channel. Opens About when clicked.",
  },
  repository: {
    label: "Repository",
    hint: "Branch, ahead/behind and how many files have changed, for the tab in front.",
  },
  command: {
    label: "Running command",
    hint: "What the active terminal is running, and for how long.",
  },
  cwd: {
    label: "Directory",
    hint: "Where the active terminal is.",
  },
  tmux: {
    label: "tmux session",
    hint: "The tmux session the active tab is attached to, if any.",
  },
  spacer: {
    label: "Spacer",
    hint: "Flexible gap. Everything after it is pushed along — this is what does the aligning.",
  },
  separator: {
    label: "Separator",
    hint: "A thin dividing line.",
  },
} as const;

export type StatusItemId = keyof typeof STATUS_ITEMS;

/**
 * The same registry, for lookup.
 *
 * A `Map`, not `STATUS_ITEMS[id]`. The indexed form is type-safe here, but `security/detect-object-
 * injection` cannot see that and flags every call — and the honest options are then a suppression at
 * each site or a lookup with no injection path at all. This is the second one: a `Map` cannot reach
 * `__proto__` or `constructor`, so the rule stays armed everywhere else instead of being taught to
 * ignore a shape (rule:code-quality — never weaken a gate to make a finding go away).
 */
const ITEMS = new Map<StatusItemId, { label: string; hint: string }>(
  Object.entries(STATUS_ITEMS) as [StatusItemId, { label: string; hint: string }][],
);

/** What to call an item, and what to tell the user it does. */
export function statusItemInfo(id: StatusItemId): { label: string; hint: string } {
  // Every id is one of the keys above, so this cannot miss — but returning the id beats throwing in
  // a settings page if a future item is ever added to the type and not to the registry.
  return ITEMS.get(id) ?? { label: id, hint: "" };
}

/** One placed element. `key` is its identity in the list — spacers repeat, so ids cannot be it. */
export interface StatusItem {
  key: string;
  id: StatusItemId;
}

/**
 * The layout a fresh install starts with.
 *
 * Version on the left because that is where it has always been and it is the About link; a spacer;
 * then what the tab in front is doing, ending with the repository — the thing you glance at most and
 * the reason the bar earns its space at all.
 */
const DEFAULT_STATUS_LAYOUT: readonly StatusItemId[] = [
  "version",
  "spacer",
  "command",
  "separator",
  "repository",
];

/** Items that may appear more than once. Everything else is a single fact and repeats meaninglessly. */
const REPEATABLE: readonly StatusItemId[] = ["spacer", "separator"];

export const isRepeatable = (id: StatusItemId): boolean => REPEATABLE.includes(id);

/** Monotonic, so two spacers are never the same element to React or to a drag. */
let nextKey = 0;

export function makeItem(id: StatusItemId): StatusItem {
  nextKey += 1;
  return { key: `${id}-${nextKey}`, id };
}

export const defaultLayout = (): StatusItem[] => DEFAULT_STATUS_LAYOUT.map(makeItem);

/** Every id, in the order the palette offers them. */
const allStatusItems = (): StatusItemId[] => Object.keys(STATUS_ITEMS) as StatusItemId[];

/**
 * Which ids the palette should still offer, given what is already placed.
 *
 * A repeatable item is always offered; a unique one disappears once it is in the bar, because
 * offering something that cannot be added is a control that does nothing.
 */
export function availableItems(placed: readonly StatusItem[]): StatusItemId[] {
  const used = new Set(placed.map((item) => item.id));
  return allStatusItems().filter((id) => isRepeatable(id) || !used.has(id));
}

/** Insert `id` at `index`, refusing a duplicate of something unique. */
export function insertItem(
  layout: readonly StatusItem[],
  id: StatusItemId,
  index: number,
): StatusItem[] {
  if (!isRepeatable(id) && layout.some((item) => item.id === id)) return [...layout];
  const at = Math.max(0, Math.min(index, layout.length));
  return [...layout.slice(0, at), makeItem(id), ...layout.slice(at)];
}

/** Move the item at `from` so that it sits at `to`. */
export function moveItem(layout: readonly StatusItem[], from: number, to: number): StatusItem[] {
  const moving = layout.at(from);
  if (moving === undefined) return [...layout];
  const without = layout.filter((_, at) => at !== from);
  // Clamped against the list WITHOUT the moved item: an index computed from the original list is one
  // too far once the gap closes behind it.
  const at = Math.max(0, Math.min(to, without.length));
  return [...without.slice(0, at), moving, ...without.slice(at)];
}

export function removeItem(layout: readonly StatusItem[], key: string): StatusItem[] {
  return layout.filter((item) => item.key !== key);
}

/**
 * Make a stored layout safe to render.
 *
 * It comes from localStorage, which anything can edit, and from older builds that knew fewer items.
 * An unknown id is dropped rather than rendered as a blank, a duplicate of a unique item is dropped
 * rather than shown twice, and keys are reissued so a hand-written payload cannot make two elements
 * the same one.
 */
export function sanitiseLayout(stored: unknown): StatusItem[] {
  if (!Array.isArray(stored)) return defaultLayout();
  const known = new Set<string>(allStatusItems());
  const seen = new Set<string>();
  const keys = new Set<string>();
  const out: StatusItem[] = [];

  for (const entry of stored) {
    const record = entry as { id?: unknown; key?: unknown } | null;
    const id: unknown = record?.id;
    if (typeof id !== "string" || !known.has(id)) continue;
    const typed = id as StatusItemId;
    if (!isRepeatable(typed)) {
      if (seen.has(typed)) continue;
      seen.add(typed);
    }
    // A key that is already usable is KEPT. Reissuing every key here looked harmless and was not:
    // this runs on every edit, so a reorder handed React an entirely new list, which unmounted and
    // remounted the lot — losing focus mid-keyboard-move, and the drag with it. Only a key that is
    // missing or already taken is replaced, which is what a hand-edited payload needs.
    const key = record?.key;
    const usable = typeof key === "string" && key !== "" && !keys.has(key);
    const item = usable ? { key: key as string, id: typed } : makeItem(typed);
    keys.add(item.key);
    out.push(item);
  }
  // An empty bar is a legitimate choice — someone who removed everything meant it. Only a payload
  // with nothing usable in it falls back to the defaults.
  return stored.length > 0 && out.length === 0 ? defaultLayout() : out;
}
