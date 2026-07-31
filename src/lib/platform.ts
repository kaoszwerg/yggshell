// Which keyboard the user is on. One source, because every shortcut in the app has to ask
// (rule:reusability).
//
// Read from the user agent rather than from Tauri's OS plugin: the answer is only ever needed to pick
// between two key combinations, and that is not worth a dependency and an async call on a path that
// runs inside a keydown handler.

/** True on macOS, where the modifier is ⌘ rather than Ctrl+Shift. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // `navigator.platform` is deprecated but still the most reliable signal in a WebView; the user
  // agent is the documented fallback. Both are matched, so neither being absent decides it alone.
  const platform = navigator.platform || "";
  return /mac/i.test(platform) || /mac os x/i.test(navigator.userAgent);
}
