import type { Ref, TextareaHTMLAttributes } from "react";

/** Multi-line text input props — the native `title` is intentionally not exposed. */
export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "title"> & {
  ref?: Ref<HTMLTextAreaElement>;
};

/**
 * Multi-line text input in the HUD design system (ADR-APP-026).
 *
 * A raw `<textarea>` is banned outside `src/components/ui` for the same reason a raw `<input>` is:
 * it arrives wearing the platform's own look — its border, its focus ring, its resize grip — and a
 * surface the user meets that nobody brought into line with the HUD is the defect that rule exists
 * to prevent. `resize-none` is part of that: the grip is native chrome, and every caller here sizes
 * the field itself.
 *
 * Pass an `aria-label` (or wire a `<label>`) so the field has an accessible name.
 */
export function TextArea({ ref, className = "", ...rest }: TextAreaProps) {
  return (
    <textarea
      ref={ref}
      // Same surface as TextField, so a one-line field and a growing one are visibly the same
      // control — see the note there about why the placeholder is dimmed and italic.
      className={`hud-clip-sm bg-elevated text-fg focus:ring-cyan/60 placeholder:text-dim/50 resize-none px-2 py-1 text-xs outline-none placeholder:italic focus:ring-1 ${className}`.trim()}
      {...rest}
    />
  );
}
