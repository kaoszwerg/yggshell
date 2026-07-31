import { useEffect, useMemo, useRef, useState } from "react";
import { TextField } from "./TextField";

interface SelectOption {
  /** The value stored when this option is chosen. */
  value: string;
  /** What the user reads. */
  label: string;
  /** Inline style for the option's own row — used to preview a font in the font itself. */
  preview?: React.CSSProperties;
}

export interface SearchableSelectProps {
  label: string;
  /** The current value, which need not be one of the options — a hand-typed name is valid. */
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown under the list when nothing matches. */
  emptyHint?: string;
  className?: string;
}

/**
 * A list you can type into (ADR-APP-026 — a native `<select>` is OS chrome and banned outside this
 * layer).
 *
 * Two things it does that a plain select cannot, and both are why it exists:
 *
 *  - **it filters as you type**, because a list of twenty fonts is a list you scan, not a list you
 *    read;
 *  - **it lets each row style itself**, so a font can be previewed *in that font*. Choosing a
 *    typeface from a list of names set in some other typeface is choosing blind.
 *
 * The text is also the value. Anything can be typed, whether or not it is in the list — the list is
 * what this machine happens to have, and refusing a name that is not on it would refuse fonts we
 * simply could not detect (see `lib/fonts`: a WebView cannot enumerate them).
 */
export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  emptyHint,
  className = "",
}: SearchableSelectProps) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // `null` means "not typing", and the field shows the current value. Without the distinction, opening
  // the list would filter it down to the one option already chosen.
  const text = query ?? value;

  const matches = useMemo(() => {
    const needle = (query ?? "").trim().toLowerCase();
    if (needle === "") return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      setQuery(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (next: string) => {
    onChange(next);
    setQuery(null);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className={`relative ${className}`.trim()}>
      <TextField
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={text}
        placeholder={placeholder}
        className="w-full font-mono"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          // Reported as it is typed: a name that is not in the list is still a valid choice, and
          // waiting for a selection that will never come would lose it.
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const first = matches.at(0);
            if (first) choose(first.value);
          }
        }}
      />

      {open ? (
        <div
          role="listbox"
          aria-label={label}
          className="hud-popover hud-clip-sm hud-accent-cyan absolute z-30 mt-1 flex max-h-64 w-full flex-col overflow-y-auto p-1"
        >
          {matches.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => choose(option.value)}
              className={`hover:bg-elevated flex items-baseline justify-between gap-2 px-2 py-1 text-left text-xs ${
                option.value === value ? "bg-cyan/10" : ""
              }`}
            >
              {/* The preview and the name are separate so the name stays readable even when the
                  font being previewed is not. */}
              <span style={option.preview} className="truncate">
                {option.label}
              </span>
              <span className="text-dim/60 shrink-0 font-mono text-[0.6rem]">Aa —→ ✓</span>
            </button>
          ))}
          {matches.length === 0 ? (
            <span className="text-dim px-2 py-1 font-mono text-xs">
              {emptyHint ?? "Nothing matches."}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
