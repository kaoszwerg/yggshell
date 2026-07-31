import { useEffect, useState } from "react";
import { waitForFont } from "../lib/fonts";

/**
 * Re-render once a font has finished loading (or failed to).
 *
 * **Why anything has to wait at all.** A bundled `@font-face` is fetched lazily — the browser draws
 * the fallback until the file arrives. For ordinary text that is invisible; for a Powerline sample it
 * is a row of empty boxes, and the user reads that as "this font has no glyphs" rather than "this
 * font has not loaded yet". It is the same failure the terminal had, where the WebGL atlas made it
 * permanent (`lib/fonts`, `waitForFont`); in the DOM it is transient, but it lands exactly on the
 * frame somebody is looking at while choosing a font.
 *
 * Returns whether the *attempt* has settled — not whether the font exists. A font this machine does
 * not have must still render, in the fallback: seeing the fallback IS the answer to "do I have this
 * one".
 */
export function useFontSettled(family: string): boolean {
  // The family that has settled, not a boolean. A boolean would need resetting to `false` the moment
  // the family changes — a synchronous setState inside the effect, which is a cascading render and is
  // rejected by `react-hooks/set-state-in-effect`. Comparing names derives the same answer from what
  // is already known, with no second render at all.
  const [settledFor, setSettledFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void waitForFont(family).finally(() => {
      if (!cancelled) setSettledFor(family);
    });
    return () => {
      cancelled = true;
    };
  }, [family]);

  return settledFor === family;
}
