import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { hudButtonClass, type HudAccent } from "./hudButton";
import { Tooltip } from "./Tooltip";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  /** HUD accent colour (ADR-APP-020). Defaults to cyan. */
  accent?: HudAccent;
  /** Locks the button into its filled state (e.g. the selected item in a toggle group). */
  active?: boolean;
  /** `solid` (default) is the chamfered neon button; `ghost` is a borderless text control. */
  variant?: "solid" | "ghost";
  /** Custom HUD tooltip (ADR-APP-026 — never the native `title`). Omit for none. */
  tooltip?: ReactNode;
  /** The underlying button, for the callers that must move focus to it (a picker opening, say). */
  ref?: Ref<HTMLButtonElement>;
}

/** What every HUD button needs and no caller should have to remember.
 *
 * Padding is part of the primitive, not the call site. Without it the label sits flush against the
 * chamfer, which cuts into the glyphs — a button visibly broken by its own text. That is what the
 * fatal screen looked like, because it was the one caller that did not pass its own padding.
 *
 * `whitespace-nowrap` is the other half of the same promise: a HUD button is a fixed shape with a
 * clip-path, so a label that wraps does not make it taller, it makes it *cropped*. A label too long
 * for the space is a layout decision for the caller, never something the button does silently. */
const BASE = "inline-flex items-center justify-center whitespace-nowrap px-3 py-1 text-xs";

/**
 * Text/label button in the HUD design system (ADR-APP-020, ADR-APP-026). Every clickable control routes
 * through this primitive — a raw, unstyled `<button>` is banned outside `src/components/ui` — so the
 * chamfer, neon fill, hover and active states stay identical everywhere. `type` defaults to
 * `"button"` so a button in a form never submits by accident.
 */
export function Button({
  accent,
  active,
  variant,
  tooltip,
  className = "",
  type,
  ref,
  children,
  ...rest
}: ButtonProps) {
  const btn = (
    <button
      ref={ref}
      type={type ?? "button"}
      className={`${hudButtonClass({ accent, active, variant })} ${BASE} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
  return tooltip == null ? btn : <Tooltip content={tooltip}>{btn}</Tooltip>;
}
