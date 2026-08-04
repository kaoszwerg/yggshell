import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  type UIEvent,
} from "react";
import { TextArea } from "./TextArea";
import { tokenize, type SyntaxScheme, type Token } from "../../lib/highlight";

/**
 * A plain-text editor that shows its markdown coloured.
 *
 * **How it works, and why it is not a fancier control.** A `<textarea>` cannot colour its own
 * contents — no browser lets you style a range inside one. The standard answer, and the one here, is
 * two elements laid exactly on top of each other: a `<pre>` holding the coloured copy, and the real
 * textarea above it with **transparent text and a visible caret**. The user types into the textarea
 * and reads the `<pre>`.
 *
 * That trick has one hard requirement: **the two must lay out identically to the pixel.** Same font,
 * same size, same line height, same padding, same wrapping. Any difference and the caret drifts away
 * from the letters it is supposed to sit between — the further down the document, the worse. Every
 * metric below is therefore set on the pair, never on one of them.
 *
 * **The text is never invisible, not even for a frame.** Colouring is asynchronous (the grammar is
 * loaded on demand), so the `<pre>` renders the *current* value uncoloured whenever the tokens it has
 * belong to an older one. Waiting for tokens before drawing anything would mean a keystroke that
 * blanks the line it was typed into.
 *
 * **A CodeMirror or Monaco would do this and more** — and would be several hundred kilobytes, its own
 * theming system and its own keyboard handling to reconcile with this app's. The editor here is a
 * notes field: it needs colour, a caret and the shortcuts the platform already gives a textarea.
 */
export function MarkdownEditor({
  value,
  onChange,
  onKeyDown,
  onPaste,
  onKeyUp,
  onClick,
  onScroll,
  scheme,
  fontSize,
  label,
  className = "",
  ref,
  onMirror,
}: {
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Both of these exist for one reason: the caret may have moved without the text changing. */
  onKeyUp?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onClick?: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Called after the mirror has been kept in step — a follow mode hangs its own work off this. */
  onScroll?: (event: UIEvent<HTMLTextAreaElement>) => void;
  /** The colour scheme to highlight in; `null` draws the HUD's own. */
  scheme: SyntaxScheme | null;
  fontSize: number;
  label: string;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
  /**
   * Handed the coloured mirror as it attaches, for a caller that needs to measure where a line sits.
   *
   * A callback rather than a ref to write into: a component may not assign to a ref it was **given**
   * (the compiler's immutability rule, and it is right — the owner of a ref is the only one who
   * knows when it is safe to change). The caller stores it in its own.
   *
   * Handed out rather than measured here: the mirror lays out identically to the textarea by
   * construction, so its per-line elements are the only pixel-accurate source position in the app —
   * but what to do with that belongs to whoever is syncing something to it (`lib/followScroll`).
   */
  onMirror?: (node: HTMLPreElement | null) => void;
}) {
  /** The coloured copy, and the text it was made from — so a stale colouring is never drawn. */
  const [coloured, setColoured] = useState<{ source: string; lines: Token[][] }>({
    source: "",
    lines: [],
  });
  const mirror = useRef<HTMLPreElement>(null);

  // Kept here AND handed to the caller: this component needs it to keep the two layers scrolled
  // together, and a follow mode needs it to measure where a line sits. One node, two readers.
  const attachMirror = (node: HTMLPreElement | null) => {
    mirror.current = node;
    onMirror?.(node);
  };

  useEffect(() => {
    let dropped = false;
    void tokenize(value, "markdown", scheme).then((lines) => {
      // The value may have moved on while the grammar was loading; the newer effect owns the result.
      if (!dropped) setColoured({ source: value, lines });
    });
    return () => {
      dropped = true;
    };
  }, [value, scheme]);

  // Identical metrics for both layers. Held in one object rather than repeated in two class lists,
  // because the failure mode of them drifting apart is a caret that no longer matches the text.
  const metrics = {
    fontSize: `${String(fontSize)}px`,
    lineHeight: 1.625,
    padding: "0.5rem 2.5rem 0.5rem 0.75rem",
  } as const;

  const fresh = coloured.source === value;

  return (
    <div className={`relative min-h-0 flex-1 ${className}`.trim()}>
      {/* The coloured copy. `aria-hidden`, because the textarea above it is the real control and a
          screen reader reading both would read the note twice. */}
      <pre
        ref={attachMirror}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden font-mono break-words whitespace-pre-wrap"
        style={{ ...metrics, color: "var(--scheme-fg)" }}
      >
        {/* **One marked element per source line, in BOTH branches.** The mirror lays out identically
            to the textarea, so a line's element is that line's pixel position — the measurement a
            follow mode is built on (`lib/followScroll`). The uncoloured branch used to render the
            raw value as a single text node, which made every anchor vanish for a frame on every
            keystroke: precisely while typing, which is the one moment the sync is watched. */}
        {fresh
          ? coloured.lines.map((line, at) => (
              <span key={at} data-md-line={at}>
                {line.map((token, tokenAt) => (
                  <span
                    key={tokenAt}
                    style={token.color === undefined ? undefined : { color: token.color }}
                  >
                    {token.content}
                  </span>
                ))}
                {"\n"}
              </span>
            ))
          : value.split("\n").map((line, at) => (
              <span key={at} data-md-line={at}>
                {line}
                {"\n"}
              </span>
            ))}
        {/* A trailing newline is not rendered by `pre`, so a document ending in one would scroll a
            line short of the textarea and the last line would sit off by one. */}
        {"\n"}
      </pre>

      <TextArea
        ref={ref}
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onClick={onClick}
        onPaste={onPaste}
        // The two layers scroll as one. Without this the coloured copy stays at the top while the
        // text moves, which looks like the colouring belongs to different text entirely.
        onScroll={(event) => {
          const pre = mirror.current;
          if (pre !== null) {
            pre.scrollTop = event.currentTarget.scrollTop;
            pre.scrollLeft = event.currentTarget.scrollLeft;
          }
          // After the mirror, never before: a caller measuring line positions from here must see the
          // two layers already in step, or it reads a position that is one scroll event out of date.
          onScroll?.(event);
        }}
        style={{
          ...metrics,
          // **Transparent text, visible caret** — the whole mechanism in two properties. Inline
          // rather than as classes because `TextArea` sets its own background and colour from the
          // design system, and two Tailwind utilities for one property are resolved by the generated
          // sheet's order rather than by the caller's (rule:theming).
          background: "transparent",
          color: "transparent",
          caretColor: "var(--scheme-fg)",
        }}
        className="absolute inset-0 h-full w-full resize-none rounded-none border-0 font-mono break-words whitespace-pre-wrap"
      />
    </div>
  );
}
