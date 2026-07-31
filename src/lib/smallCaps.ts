/** One run of the name: the text, and whether it is a full capital or a small one. */
export interface CapsRun {
  text: string;
  /** True for the letters that were already capitals in the name and stay full height. */
  full: boolean;
}

/**
 * Split a name into full capitals and small capitals, following the name's own casing.
 *
 * `YggShell` becomes `Y` + `GG` + `S` + `HELL`, with the two letters that were capitals rendered at
 * full height and the rest as smaller capitals. That is what small caps *are*, and it reads as the
 * product's name rather than as shouting.
 *
 * **Done by splitting rather than with `font-variant-caps`** because that property is a request, not a
 * guarantee: it needs the font to carry small-cap glyphs or the engine to synthesise them, and
 * Orbitron is a display face that may do neither. The layout above it also sets `text-transform:
 * uppercase`, which would flatten the casing this reads before the property ever saw it. Splitting is
 * deterministic in every font.
 *
 * **Driven by the name, never by hard-coded letters.** The app name has one source
 * (`app.identity.json`, ADR-APP-031) and a fork renames it — `Y` and `S` are where they are because
 * `YggShell` is spelled that way, not because anyone typed them here.
 */
export function smallCaps(name: string): CapsRun[] {
  const runs: CapsRun[] = [];
  for (const character of name) {
    // A character with no case at all (a digit, a space, a dash) joins whatever run it lands in
    // rather than starting one: `Ygg 2` should not put its space in a run of its own.
    const full = character === character.toUpperCase() && character !== character.toLowerCase();
    const last = runs.at(-1);
    const cased = character !== character.toUpperCase() || character !== character.toLowerCase();

    if (last !== undefined && (!cased || last.full === full)) {
      last.text += character.toUpperCase();
      continue;
    }
    runs.push({ text: character.toUpperCase(), full });
  }
  return runs;
}
