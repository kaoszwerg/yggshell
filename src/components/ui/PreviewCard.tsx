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
 * showing the thing it is previewing at the very moment it is chosen, so selection is drawn as a
 * ring around it instead.
 */
export function PreviewCard({
  label,
  selected,
  background,
  onChoose,
  children,
  className = "",
}: {
  /** The accessible name — the card's contents are a picture, not a description. */
  label: string;
  selected: boolean;
  /** The card's own background. This is the point of the component. */
  background: string;
  onChoose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onChoose}
      className={`hud-clip-sm flex shrink-0 cursor-pointer flex-col gap-1.5 p-2 text-left transition-shadow ${
        selected ? "ring-cyan ring-2" : "ring-cyan/20 hover:ring-cyan/60 ring-1"
      } ${className}`.trim()}
      style={{ backgroundColor: background }}
    >
      {children}
    </button>
  );
}
