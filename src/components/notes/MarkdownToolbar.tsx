import {
  Bold,
  Code,
  Heading2,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Table,
} from "lucide-react";
import { Fragment } from "react";
import { IconButton } from "../ui/IconButton";
import { useT } from "../../hooks/useT";
import { GROUPS, type Construct, type ConstructId } from "../../lib/markdownInsert";

/** One icon per construct. Separate from `CONSTRUCTS` so the insert logic stays free of the DOM. */
const ICONS: Record<ConstructId, typeof Bold> = {
  heading: Heading2,
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  code: Code,
  bullet: List,
  ordered: ListOrdered,
  task: ListChecks,
  quote: Quote,
  fence: SquareCode,
  table: Table,
  rule: Minus,
  link: Link,
  image: Image,
};

/**
 * The markdown palette that floats beside the editor while a note is being written.
 *
 * **It inserts, it does not reformat.** Every control puts its construct in at the caret — an empty
 * one, with the caret placed where typing continues (`lib/markdownInsert`). There is no "make this
 * line a heading, press again for the next level": that is a *transform* of the line under the
 * cursor, and this toolbar was asked for as an insert.
 *
 * **`hud-popover` with a position of its own**, never `hud-panel`: that class pins `position:
 * relative` and would silently beat the `absolute` below (a lint rule refuses it). And the position
 * is not optional for the popover either — its opaque interior is an `::before` at `inset: 1px`, so
 * with no positioned ancestor of its own it spreads across whatever *is* positioned above it. That
 * is the defect the toast shipped with in 0.47.1.
 *
 * **Nothing here takes focus.** `preventDefault` on `mousedown` is what keeps the caret in the
 * textarea; without it the first click moves focus to the button and the insert point is gone
 * before the click handler ever runs.
 */
export function MarkdownToolbar({ onPick }: { onPick: (construct: Construct) => void }) {
  const t = useT();

  return (
    <div
      className="hud-popover hud-clip-sm hud-accent-cyan absolute top-2 right-2 z-20 flex flex-col gap-0.5 p-1"
      // The editor beneath owns the keyboard; this is a mouse affordance sitting on top of it.
      role="toolbar"
      aria-label={t("notes.insert.toolbar")}
    >
      {GROUPS.map((group, at) => (
        // A Fragment, not a wrapper div: the buttons stay direct children of the toolbar, so the
        // flex column lays them out without a `display: contents` escape hatch — and nothing extra
        // appears in the accessibility tree between the toolbar and its controls.
        <Fragment key={group[0]?.id ?? at}>
          {at === 0 ? null : (
            // The divider is what makes the grouping visible rather than merely intended. Presentation
            // only — a separator a screen reader announces between two buttons is noise, since the
            // group is not a thing you can act on.
            <span aria-hidden className="bg-cyan/20 mx-1 my-0.5 h-px shrink-0" />
          )}
          {group.map((construct) => {
            const Icon = ICONS[construct.id];
            return (
              <IconButton
                key={construct.id}
                label={t(construct.label)}
                variant="ghost"
                className="h-6 w-6"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  onPick(construct);
                }}
              >
                <Icon size={12} aria-hidden />
              </IconButton>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
