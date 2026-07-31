import { useId, useState } from "react";
import { TextField } from "./TextField";

export interface ColorFieldProps {
  /** Accessible name — what this colour is for. */
  label: string;
  /** Current colour as `#rrggbb`, or `null` when the theme does not define it. */
  value: string | null;
  /** The colour shown, and used as the starting point, while `value` is `null`. */
  fallback: string;
  /** Called with a valid `#rrggbb`, or `null` when the field is cleared back to the fallback. */
  onChange: (value: string | null) => void;
  className?: string;
}

/** `#rrggbb`. The swatch only ever emits this form; the text field is what a person types into. */
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A colour, as a HUD control.
 *
 * The swatch is a native `<input type="color">` **underneath**, which is legitimate here and nowhere
 * else (ADR-APP-026): the primitive layer may be built on a native element, and this one is used
 * purely as a mechanism — it is what opens the operating system's colour picker, which is the picker
 * a user already knows and expects for this. Its own appearance never ships: the input is invisible
 * and the chamfered swatch beside it is ours.
 *
 * The text field next to it is not decoration. A colour scheme is written in hex, people copy hex
 * between tools, and a picker alone would make pasting `#0a0a0f` impossible.
 *
 * **Empty means "not defined by this scheme"**, which is a real and useful state — it is what lets an
 * imported theme keep the HUD's colour for anything it never mentioned. Clearing the field reports
 * `null` rather than silently pinning the fallback.
 */
export function ColorField({ label, value, fallback, onChange, className = "" }: ColorFieldProps) {
  const id = useId();
  // The text being typed, which is briefly not a valid colour. `null` means "not editing" and the
  // field shows `value` — without this, typing the second character of `#a…` would fight the caret.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? "";
  const swatch = value ?? fallback;

  const commit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") {
      onChange(null);
      setDraft(null);
      return;
    }
    // Accept what a person actually pastes: with or without the `#`.
    const candidate = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (HEX.test(candidate)) {
      onChange(candidate.toLowerCase());
      setDraft(null);
    }
    // Anything else stays in the draft rather than being reported: a half-typed colour is not a
    // choice, and pushing it through would repaint the terminal on every keystroke.
  };

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <label className="relative h-5 w-5 shrink-0 cursor-pointer" htmlFor={id}>
        <span
          aria-hidden
          className="hud-clip-sm border-cyan/30 block h-full w-full border"
          style={{ backgroundColor: swatch }}
        />
        {/* The native picker is the mechanism and nothing else: invisible, sized to the swatch so
            the click lands on it, and never seen (ADR-APP-026). */}
        <input
          id={id}
          type="color"
          aria-label={label}
          value={swatch}
          onChange={(e) => {
            setDraft(null);
            onChange(e.target.value.toLowerCase());
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>

      <TextField
        aria-label={`${label} hex value`}
        value={shown}
        placeholder={fallback}
        className="w-24 font-mono text-xs"
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        onBlur={(e) => {
          commit(e.target.value);
          setDraft(null);
        }}
      />
    </div>
  );
}
