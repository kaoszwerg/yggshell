import { Check } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A selectable card that shows *itself* rather than describing itself.
 *
 * Built for choosing a colour scheme, where a name is not a preview: "Ayu Mirage" and "Catppuccin
 * Mocha" tell somebody choosing between eleven of them almost nothing, and a list of names makes
 * them try each one in turn to find out what it looks like.
 *
 * **Why it is a primitive and not a native button in the view.** Every control the user touches comes
 * from this layer (ADR-APP-026) — and this one has a requirement the HUD button cannot meet: its own
 * background must survive being selected. A card that adopted the HUD's active fill would stop
 * showing the thing it is previewing at the very moment it is chosen.
 *
 * **How "chosen" is shown, and why it is three things at once.** A ring alone was not enough: it is
 * cyan, on a wall of cards that are themselves often dark and often cyan-ish, and picking one ring
 * out of eleven at a glance is exactly the work this component was supposed to remove. So the chosen
 * card also carries a **tick in its corner** — a shape, not a colour, which survives any palette
 * behind it — and says so in its accessible name. The ring stays, because it is what makes the
 * choice findable while scanning rather than only once you are looking at the right card.
 */
export function PreviewCard({
  label,
  selected,
  background,
  onChoose,
  selectedLabel,
  children,
  className = "",
}: {
  /** The accessible name — the card's contents are a picture, not a description. */
  label: string;
  selected: boolean;
  /** The card's own background. This is the point of the component. */
  background: string;
  onChoose: () => void;
  /** What "chosen" is called, for the accessible name. User text, so the caller supplies it. */
  selectedLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={selected ? `${label} — ${selectedLabel}` : label}
      aria-pressed={selected}
      onClick={onChoose}
      className={`hud-clip-sm relative flex shrink-0 cursor-pointer flex-col gap-1.5 p-2 text-left transition-shadow ${
        selected ? "ring-cyan ring-2" : "ring-cyan/20 hover:ring-cyan/60 ring-1"
      } ${className}`.trim()}
      style={{ backgroundColor: background }}
    >
      {selected ? (
        // On its own solid chip rather than drawn straight onto the card: the card's background is
        // the previewed colour, and a tick tinted by it would be exactly as hard to find as the ring.
        <span
          aria-hidden
          className="bg-cyan absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full text-base"
        >
          <Check size={11} strokeWidth={3} />
        </span>
      ) : null}
      {children}
    </button>
  );
}
