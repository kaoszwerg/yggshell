import type { InputHTMLAttributes, Ref } from "react";

/** Single-line text input props — the native `type` and `title` are intentionally not exposed. */
export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "title"> & {
  /** Forwarded to the input — a search bar has to be able to take the caret on open. */
  ref?: Ref<HTMLInputElement>;
};

/**
 * Single-line text input in the HUD design system (ADR-APP-026). A raw `<input>` is banned outside
 * `src/components/ui`; every text field routes through this so the chamfered surface and the neon
 * focus ring (in place of the native focus outline) stay consistent. Pass an `aria-label` (or wire a
 * `<label>`) so the field has an accessible name.
 */
export function TextField({ ref, className = "", ...rest }: TextFieldProps) {
  return (
    <input
      ref={ref}
      type="text"
      // `placeholder:` styling is not decoration. A placeholder rendered at the same weight as a
      // value reads AS a value — the field looks configured when it is empty, and the user does not
      // fill in what they believe is already set. Dimmed and italic, so the difference is visible
      // without reading the text.
      className={`hud-clip-sm bg-elevated text-fg focus:ring-cyan/60 placeholder:text-dim/50 px-2 py-1 text-xs outline-none placeholder:italic focus:ring-1 ${className}`.trim()}
      {...rest}
    />
  );
}
