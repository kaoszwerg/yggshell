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

/**
 * `a` laid over `b` at `alpha` — the same arithmetic `color-mix(in srgb, a X%, b)` performs.
 *
 * Needed because a pairing can be formed by CSS rather than by a palette: a diff tints a changed row
 * with `color-mix`, and the colour a token is actually read against is the *result*, which exists
 * nowhere in the scheme.
 */
export function blend(a: string, b: string, alpha: number): string | null {
  const x = channels(a);
  const y = channels(b);
  if (x === null || y === null) return null;
  // Destructured rather than indexed: `security/detect-object-injection` flags the subscript, and it
  // is right to — three named channels say what this is anyway.
  const [xr, xg, xb] = x;
  const [yr, yg, yb] = y;
  const hex = (over: number, under: number) =>
    Math.round(over * alpha + under * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(xr, yr)}${hex(xg, yg)}${hex(xb, yb)}`;
}

/**
 * The floor for a colour that carries *text a person reads continuously*, but which should stay
 * dimmer than body text.
 *
 * **Deliberately WCAG's large-text threshold rather than `AA`.** A comment must read as subordinate,
 * and several bundled schemes give their own foreground only ~4.4 — demanding 4.5 of a comment would
 * make comments the brightest thing on screen, which is the opposite defect.
 */
export const READABLE_DIM = 3;

/**
 * Lift a dim colour toward `towards` until it clears `minRatio` on **every** background it can meet.
 *
 * **The defect this was measured against.** A comment is drawn in the scheme's `brightBlack`, and a
 * diff paints a 14 % tint of green or red underneath it. In Alien Blood that is **2.00 : 1** on the
 * plain surface, **1.77** on an added line and **1.71** on a removed one — against a body text of
 * 4.43. Reported as *"der Kommentartext ist zu hell für seinen Hintergrund"* and *"bei diffs ist es
 * auch schlecht zu lesen"*.
 *
 * It is **not that scheme's fault**, which is why the correction belongs here and not in its file:
 * `brightBlack` is a terminal slot one rarely reads, and a highlighter promotes it to *every comment
 * in the file*. Any scheme whose bright black sits near its green or red in luminance has the same
 * problem, and there are fifteen bundled.
 *
 * This is the same policy as `mostReadableOn` above — **the app supplies its own half of a pairing it
 * formed, and never rewrites somebody's palette.** A scheme that already reads is returned untouched.
 *
 * @param towards the scheme's foreground. Blending toward *that* rather than toward white keeps the
 *   scheme's hue: a light scheme's comment gets darker, a dark scheme's lighter, neither turns grey.
 *   If even the foreground cannot clear the floor, that is the author's choice of background and not
 *   this function's to overrule — it stops there.
 */
export function readable(
  colour: string,
  towards: string,
  on: readonly string[],
  minRatio: number = READABLE_DIM,
): string {
  const worst = (c: string) => {
    let lowest = Infinity;
    for (const bg of on) {
      const ratio = contrast(c, bg);
      // Unmeasurable is not "fine": skipping it would let an unreadable pairing through, which is
      // the failure this module opens by refusing.
      if (ratio === null) return -Infinity;
      lowest = Math.min(lowest, ratio);
    }
    return lowest;
  };

  if (on.length === 0 || worst(colour) >= minRatio) return colour;

  // Twenty steps: fine enough to keep the scheme's hue, coarse enough to stay a loop rather than a
  // solver.
  for (let step = 1; step <= 20; step++) {
    const lifted = blend(towards, colour, step / 20);
    if (lifted !== null && worst(lifted) >= minRatio) return lifted;
  }
  return towards;
}
