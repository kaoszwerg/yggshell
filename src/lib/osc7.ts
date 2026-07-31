// Reading OSC 7 — the sequence a shell uses to say where it is.
//
// `ESC ] 7 ; file://<host><path> ST`. This is what lets the Git tool follow a `cd` without querying
// process internals per platform. Its own module rather than living in the terminal component,
// because it is pure string handling and deserves to be tested as such.

/**
 * The path out of an OSC 7 payload, or `null` when it is not one we can use.
 *
 * The host is deliberately ignored: a shell on this machine may report any name for itself. A payload
 * whose path part does not start with `/` is rejected rather than guessed at — that is what a remote
 * shell over ssh produces, and its path does not exist here.
 */
export function parseOsc7(data: string): string | null {
  if (!data.startsWith("file://")) return null;
  const rest = data.slice("file://".length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const path = rest.slice(slash);
  try {
    // Shells percent-encode spaces and non-ASCII; a payload that is not valid encoding is not one to
    // hand to the filesystem.
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
