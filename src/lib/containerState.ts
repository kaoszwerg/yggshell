/**
 * Colour per container state.
 *
 * `exited` is gold rather than red: a container that has finished its job is not a failure, and
 * colouring it as one would train the eye to ignore the colour.
 */
export function stateColour(state: string): string {
  switch (state) {
    case "running":
      return "text-green";
    case "paused":
      return "text-cyan";
    case "exited":
      return "text-gold";
    case "dead":
      return "text-danger";
    default:
      return "text-dim";
  }
}
