/**
 * Formatting for the status bar's items.
 *
 * Here rather than beside the components, because they are pure functions of their input and a file
 * that exports both components and helpers breaks React Fast Refresh — the module can no longer be
 * swapped in without remounting, so editing a formatter would blow away the terminals.
 */

/**
 * `0:07`, `4:31`, `1:02:44`.
 *
 * Minutes first because that is the scale a command lives on; hours only appear once there are any,
 * so the common case stays short enough to read at a glance in a 10px strip.
 *
 * A negative span reads `0:00`. That is not defensive padding: the caller's clock ticks once a
 * second, so a command that started between two ticks is legitimately "not measured yet" — and a
 * suspend or a corrected system clock must not print `-1:-3`.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}

/**
 * A path as a person would say it: `~/git-projects/yggshell`, and only the tail of a deep one.
 *
 * The bar has a few dozen pixels, so a full path would either push everything else out or be
 * ellipsised by the browser in the middle of the one segment that identifies it.
 */
export function shortPath(path: string, home?: string): string {
  const withHome = home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  const parts = withHome.split(/[/\\]/).filter((p) => p !== "");
  if (parts.length <= 2) return withHome;
  return `…/${parts.slice(-2).join("/")}`;
}
