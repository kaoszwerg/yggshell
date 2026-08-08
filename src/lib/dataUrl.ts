/**
 * Bytes that came over IPC, turned into something an `<img>` can show.
 *
 * **One place, because there were already two.** The notes view built this inline for a rendered
 * note and again for its viewer, character for character, and the file viewer would have been the
 * third. Both existing copies also wrote `data:image/*`, a wildcard type: browsers tolerate it in an
 * `<img>` and it says nothing, so a picture that failed to decode gave no clue why. The type is a
 * parameter here, and the one caller that genuinely does not know it says so by passing the wildcard
 * rather than by having it baked in (ADR-CORE-005).
 */

/**
 * How many bytes are converted per `String.fromCharCode` call.
 *
 * **Not one call for the whole array.** `fromCharCode(...bytes)` spreads every byte as an argument,
 * and a 32 MB picture is 32 million arguments — which is a stack overflow, not a slow path. Chunked,
 * the cost is linear and the stack never grows.
 */
const CHUNK = 8 * 1024;

/**
 * Turn IPC bytes into a `data:` URL.
 *
 * @param bytes  The file's contents, as the backend sent them.
 * @param mime   The media type the backend decided from the bytes themselves — never guessed from a
 *               file name here. Pass `image/*` only where the caller genuinely cannot know.
 */
export function toDataUrl(bytes: readonly number[] | Uint8Array, mime: string): string {
  const view = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let binary = "";
  for (let at = 0; at < view.length; at += CHUNK) {
    binary += String.fromCharCode(...view.subarray(at, at + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
