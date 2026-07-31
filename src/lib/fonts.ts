/**
 * Which monospace fonts this machine actually has.
 *
 * **A WebView cannot enumerate system fonts.** `queryLocalFonts()` is Chromium-only and permission-
 * gated, and WKWebView does not have it at all — so there is no list to ask for. What *is* possible is
 * asking whether a *named* font exists, by rendering the same text in it and in a known fallback and
 * comparing the widths: if the font is missing the browser substitutes the fallback and the two match
 * exactly.
 *
 * That turns the problem around, and for this purpose it turns out better: a terminal wants a
 * monospace font that carries Powerline and Nerd Font glyphs, and a list of every font on the machine
 * would bury those under two hundred that cannot render a prompt. So the candidates are curated, and
 * anything not on the list can still be typed in by hand.
 */

/** Text wide enough that a substitution shows up, and made of characters every font has. */
const PROBE = "MMMMMMMMMMlllllllliiiiiiii0123456789";

/** Fonts whose metrics differ from each other, so a match against ALL of them means substitution. */
const FALLBACKS = ["monospace", "serif", "sans-serif"] as const;

/**
 * The fonts offered in the picker, in the order they appear.
 *
 * Nerd Font variants first: they are what a Powerline prompt needs, and the reason someone opens this
 * setting at all. Then the plain monospace families that are worth having, then the ones macOS,
 * Windows and Linux ship by default so the list is never empty on a fresh machine.
 */
export const FONT_CANDIDATES = [
  // Bundled with the app, so these are always present.
  "MesloLGS NF",
  "JetBrainsMono Nerd Font",
  // Commonly installed Nerd Font patches.
  "FiraCode Nerd Font",
  "Hack Nerd Font",
  "SauceCodePro Nerd Font",
  "UbuntuMono Nerd Font",
  "CaskaydiaCove Nerd Font",
  "Iosevka Nerd Font",
  // Plain monospace families.
  "JetBrains Mono",
  "Fira Code",
  "Hack",
  "Source Code Pro",
  "IBM Plex Mono",
  "Cascadia Code",
  "Iosevka",
  "Victor Mono",
  // Shipped by the operating systems.
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "Courier New",
  "DejaVu Sans Mono",
  "Liberation Mono",
  "Ubuntu Mono",
] as const;

/** Measure `text` at a large size in `family`, falling back to `fallback`. */
function widthOf(context: CanvasRenderingContext2D, family: string, fallback: string): number {
  // A large size magnifies the difference between two fonts, so a near-identical pair still separates.
  context.font = `72px ${JSON.stringify(family)}, ${fallback}`;
  return context.measureText(PROBE).width;
}

/**
 * Whether this machine has `family`.
 *
 * Measured against **three** fallbacks rather than one: a font whose metrics happen to match
 * `monospace` would otherwise read as missing, and monospace look-alikes are exactly what this list is
 * full of. A font that differs from *any* fallback is present; matching all three means the browser
 * substituted every time.
 */
export function hasFont(family: string, context?: CanvasRenderingContext2D | null): boolean {
  const ctx = context ?? document.createElement("canvas").getContext("2d");
  // No canvas — an old WebView, a locked-down context. Claiming every font is missing would empty the
  // picker; claiming they are all present is the friendlier failure, and the text field still works.
  if (!ctx) return true;

  return FALLBACKS.some(
    (fallback) => widthOf(ctx, family, fallback) !== widthOf(ctx, fallback, fallback),
  );
}

/**
 * The candidates this machine can actually render, in the order above.
 *
 * One canvas for the whole sweep rather than one per font: creating twenty-four of them to ask
 * twenty-four questions is work nobody sees and everybody pays for.
 */
export function availableFonts(candidates: readonly string[] = FONT_CANDIDATES): string[] {
  const ctx = document.createElement("canvas").getContext("2d");
  return candidates.filter((family) => hasFont(family, ctx));
}

/**
 * The font stack the emulator is given.
 *
 * Always ends in the generic families: a stored name can be a font that has since been uninstalled,
 * and a terminal that renders in the browser's last-resort face because of a settings string is a much
 * worse outcome than one that quietly falls back to the system monospace.
 */
export function fontStack(family: string): string {
  const chosen = family.trim();
  const base = '"JetBrains Mono", ui-monospace, monospace';
  return chosen === "" ? base : `${JSON.stringify(chosen)}, ${base}`;
}
