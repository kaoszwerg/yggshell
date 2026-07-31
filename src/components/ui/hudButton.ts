/** The five HUD accent colours (ADR-APP-020). One source for every interactive HUD primitive, so a
 * button, panel and popover that call themselves "cyan" mean the exact same token. */
export type HudAccent = "cyan" | "green" | "gold" | "purple" | "danger";

/** Visual surface of a HUD control: the chamfered neon `solid` button, or a borderless `ghost`
 * text/icon control that only shifts colour on hover. */
export interface HudButtonStyle {
  accent?: HudAccent;
  active?: boolean;
  variant?: "solid" | "ghost";
}

/** Hover/active colour of a `ghost` control, per accent. Spelled out rather than interpolated:
 * Tailwind scans the source for literal class names, so a built-up `text-${accent}` is generated for
 * nobody and silently ships as no colour at all. (The `hud-accent-*` classes below are plain CSS from
 * `globals.css` and are therefore safe to interpolate.) */
function ghostAccent(accent: HudAccent): { hover: string; on: string } {
  switch (accent) {
    case "green":
      return { hover: "hover:text-green", on: "text-green" };
    case "gold":
      return { hover: "hover:text-gold", on: "text-gold" };
    case "purple":
      return { hover: "hover:text-purple", on: "text-purple" };
    case "danger":
      return { hover: "hover:text-danger", on: "text-danger" };
    case "cyan":
      return { hover: "hover:text-cyan", on: "text-cyan" };
  }
}

/**
 * Tailwind class string for a HUD button surface (ADR-APP-020, ADR-APP-026). Centralised so `Button`,
 * `IconButton` and any future control render an identical surface instead of each re-deriving the
 * `.hud-btn` / `.hud-clip-sm` / accent combination.
 *
 * - `solid` (default): chamfered neon button; `active` locks it into the filled hover state.
 * - `ghost`: no chamfer or fill — a text/icon control that brightens to its accent on hover, for
 *   status strips and inline actions. Layout/colour-at-rest classes come from the caller's
 *   `className`. The accent matters here: a close `×` on a cyan-filled tab must not brighten *to*
 *   cyan, or it vanishes exactly when the pointer is on it.
 */
export function hudButtonClass({
  accent = "cyan",
  active = false,
  variant = "solid",
}: HudButtonStyle = {}): string {
  if (variant === "ghost") {
    const ghost = ghostAccent(accent);
    return `transition-colors ${ghost.hover}${active ? ` ${ghost.on}` : ""}`;
  }
  return `hud-clip-sm hud-btn hud-accent-${accent}${active ? " hud-btn-active" : ""}`;
}
