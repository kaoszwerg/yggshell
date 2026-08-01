/**
 * Colour per `ps` state letter.
 *
 * Spelled out rather than looked up: a computed member access is an object-injection sink and the
 * gate runs at zero warnings. A zombie is called out in red because it is the one state that means
 * something is wrong rather than merely quiet.
 */
export function stateColour(state: string): string {
  switch (state.slice(0, 1)) {
    case "R":
      return "text-green";
    case "Z":
      return "text-danger";
    case "T":
      return "text-gold";
    default:
      return "text-dim";
  }
}
