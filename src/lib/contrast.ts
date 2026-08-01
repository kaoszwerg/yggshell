/**
 * Contrast, measured rather than judged by eye.
 *
 * **Why the app needs this at all.** A colour scheme is data, and most of the bundled ones come from
 * somewhere else — they are other people's palettes, chosen for how they look rather than for what
 * they score. Measuring the fifteen showed real, inherited problems: in Alien Blood the selection
 * background against the foreground is **2.57**, so selected text is barely readable, and that value
 * is exactly what the upstream VS Code theme specifies. Recolouring somebody's theme to fix it would
 * make it no longer their theme.
 *
 * So the app fixes its own half instead: where a *pairing* it forms would be unreadable, it supplies
 * the missing side. Every scheme keeps its colours; none of them gets to produce text nobody can
 * read.
 *
 * The formula is WCAG 2.1 relative luminance. 4.5:1 is the AA threshold for body text, and terminal
 * text is small text.
 */

/** WCAG AA for normal-size text. Terminal and diff text is normal size. */
export const AA = 4.5;

/** Parse `#rgb` or `#rrggbb` (with an optional alpha suffix, which is ignored) into 0–255 triples. */
function channels(colour: string): [number, number, number] | null {
  const hex = colour.trim().replace(/^#/, "");
  const full =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = Number.parseInt(full, 16);
  // The standard way to split a packed colour; the alternative is three substring parses of the
  // same string.
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG relative luminance. */
function luminance(colour: string): number | null {
  const rgb = channels(colour);
  if (rgb === null) return null;
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The contrast ratio between two colours, from 1 (identical) to 21 (black on white).
 *
 * Returns `null` for anything unparseable rather than a number: a made-up ratio would silently
 * decide that an unreadable pairing is fine, which is the one outcome worth avoiding here.
 */
export function contrast(a: string, b: string): number | null {
  const [x, y] = [luminance(a), luminance(b)];
  if (x === null || y === null) return null;
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Whichever candidate reads best on `background`.
 *
 * Used where the app has to supply a colour a scheme did not think about — most importantly the text
 * drawn on a selection, which several schemes leave to chance.
 */
export function mostReadableOn(background: string, candidates: readonly string[]): string | null {
  let best: { colour: string; ratio: number } | null = null;
  for (const colour of candidates) {
    const ratio = contrast(colour, background);
    if (ratio === null) continue;
    if (best === null || ratio > best.ratio) best = { colour, ratio };
  }
  return best?.colour ?? null;
}
