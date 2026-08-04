/**
 * Keyboard shortcuts: what the app can be asked to do, and which keys ask for it.
 *
 * **The constraint that shapes everything here: the terminal gets the keyboard first.** A shell owns
 * `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `Ctrl+R` and everything else in that range — binding one of them to
 * "new tab" would take `SIGINT` away from every program the user runs, and they would have no way to
 * get it back. So a binding is only accepted if it carries a modifier the shell cannot use:
 *
 *  - **macOS**: `⌘` (and `⌃` is left entirely to the shell);
 *  - **elsewhere**: `Ctrl+Shift`, which is the convention every Linux terminal already uses, for
 *    exactly this reason.
 *
 * This is enforced, not documented: `isReservedForShell` rejects the binding, and the editor says
 * why. It is the one rule a user cannot configure their way past, because the alternative is an
 * interface that silently eats the key their program needed.
 */

/** Everything a shortcut can do. Adding one is an entry here, a default, and one case in the runner. */
export const ACTIONS = [
  "newTab",
  "closeTab",
  "nextTab",
  "previousTab",
  "selectTab1",
  "selectTab2",
  "selectTab3",
  "selectTab4",
  "selectTab5",
  "selectTab6",
  "selectTab7",
  "selectTab8",
  "selectTab9",
  "find",
  "fontBigger",
  "fontSmaller",
  "fontReset",
  "clear",
  "openSettings",
  "openLogs",
  "toggleGitTool",
  "toggleFilesTool",
  "toggleActivityTool",
  "toggleDockerTool",
  "toggleAgentTool",
  "toggleTmuxTool",
  "toggleNotesTool",
] as const;

export type ActionId = (typeof ACTIONS)[number];

const KNOWN_ACTIONS = new Set<string>(ACTIONS);

export function isActionId(value: unknown): value is ActionId {
  return typeof value === "string" && KNOWN_ACTIONS.has(value);
}

/** One key combination. `key` is `KeyboardEvent.key`, lower-cased for letters. */
export interface Binding {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/** Whether this build is running on macOS, for the default bindings and how they are drawn. */
export function isMacPlatform(platform: string = navigator.platform): boolean {
  return /mac/i.test(platform);
}

/**
 * The defaults, per platform.
 *
 * macOS uses `⌘` because that is what every Mac terminal uses and `⌃` belongs to the shell.
 * Elsewhere it is `Ctrl+Shift`, for the same reason: plain `Ctrl` is the shell's.
 */
export function defaultBindings(mac: boolean = isMacPlatform()): Record<ActionId, Binding> {
  const mod = (key: string, shift = false): Binding =>
    mac
      ? { key, meta: true, ctrl: false, alt: false, shift }
      : { key, meta: false, ctrl: true, alt: false, shift: true };

  return {
    newTab: mod("t"),
    closeTab: mod("w"),
    // Brackets on macOS are the system-wide convention for "previous/next thing"; elsewhere the
    // page keys, because Ctrl+Shift+[ is awkward on most non-US layouts.
    nextTab: mac
      ? { key: "]", meta: true, ctrl: false, alt: false, shift: true }
      : { key: "PageDown", meta: false, ctrl: true, alt: false, shift: true },
    previousTab: mac
      ? { key: "[", meta: true, ctrl: false, alt: false, shift: true }
      : { key: "PageUp", meta: false, ctrl: true, alt: false, shift: true },
    selectTab1: mod("1"),
    selectTab2: mod("2"),
    selectTab3: mod("3"),
    selectTab4: mod("4"),
    selectTab5: mod("5"),
    selectTab6: mod("6"),
    selectTab7: mod("7"),
    selectTab8: mod("8"),
    selectTab9: mod("9"),
    find: mod("f"),
    // `+` is where `=` is on most layouts, and typing it needs Shift on some — both are accepted by
    // the runner so the key people actually press works.
    fontBigger: mod("="),
    fontSmaller: mod("-"),
    fontReset: mod("0"),
    clear: mod("k"),
    openSettings: mod(","),
    openLogs: mod("l"),
    toggleGitTool: mod("g"),
    // One per tool, because Git having one and the rest not is an inconsistency a user has to
    // discover. Letters chosen to be free of the shell's own set and of the bindings above:
    // E for the file tree, J for activity, D for Docker, I for the agent.
    toggleFilesTool: mod("e"),
    toggleActivityTool: mod("j"),
    toggleDockerTool: mod("d"),
    toggleAgentTool: mod("i"),
    // U for tmux, and the letter is arbitrary because the good ones are gone: T is a new tab, M is
    // the system's Minimize, S/P/R/A/Z/C/V belong to the webview's own editing and reload. What is
    // NOT arbitrary is that it exists at all — the tmux tool shipped reachable only by mouse, which
    // made it the one tool with no keyboard route while the other five had one.
    toggleTmuxTool: mod("u"),
    // N for notes. Free in this app, and the view is reached FROM the tool rather than by a second
    // near-identical combination nobody would remember which of.
    toggleNotesTool: mod("n"),
  };
}

/**
 * Whether a combination belongs to the shell and must not be taken.
 *
 * The test is deliberately about **modifiers, not keys**: which letters a program cares about is not
 * knowable, but "this reaches the shell as a control character" is. On macOS that is anything without
 * `⌘`; elsewhere anything that is not `Ctrl+Shift` (plain `Ctrl+letter` is the control character
 * itself).
 */
export function isReservedForShell(binding: Binding, mac: boolean = isMacPlatform()): boolean {
  if (mac) {
    // ⌘ is not a control character on macOS, so anything carrying it is ours. Everything else —
    // bare keys, ⌃, ⌥ — is the terminal's.
    return !binding.meta;
  }
  // Ctrl+Shift is the convention; plain Ctrl is the control character, and ⌘ does not exist.
  return !(binding.ctrl && binding.shift);
}

/** Two bindings are the same combination. */
export function sameBinding(a: Binding, b: Binding): boolean {
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    a.meta === b.meta &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}

/** The action already using this combination, if any — so the editor can refuse a silent overwrite. */
export function conflictWith(
  bindings: Record<ActionId, Binding>,
  binding: Binding,
  except: ActionId,
): ActionId | null {
  // Iterated as entries rather than indexed by id: an index written from a variable is an
  // object-injection sink as far as the lint is concerned, and entries have no such path — so the
  // rule stays armed everywhere else instead of being suppressed here (rule:code-quality).
  for (const [action, existing] of Object.entries(bindings)) {
    if (action === except || !isActionId(action)) continue;
    if (sameBinding(existing, binding)) return action;
  }
  return null;
}

/** Look one binding up without indexing by a variable. */
export function bindingFor(
  bindings: Record<ActionId, Binding>,
  action: ActionId,
): Binding | undefined {
  return new Map(Object.entries(bindings)).get(action);
}

/** What a key looks like on screen: `⌘⇧F`, `Ctrl+Shift+F`. */
export function formatBinding(binding: Binding, mac: boolean = isMacPlatform()): string {
  const key = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  if (mac) {
    return `${binding.ctrl ? "⌃" : ""}${binding.alt ? "⌥" : ""}${binding.shift ? "⇧" : ""}${
      binding.meta ? "⌘" : ""
    }${key}`;
  }
  const parts = [
    ...(binding.ctrl ? ["Ctrl"] : []),
    ...(binding.alt ? ["Alt"] : []),
    ...(binding.shift ? ["Shift"] : []),
    ...(binding.meta ? ["Super"] : []),
    key,
  ];
  return parts.join("+");
}

/**
 * The same binding, spelled the way the **native menu** wants it — `Cmd+T`, or `Ctrl` and `Shift`
 * joined to a named key with `+`.
 *
 * **Not `formatBinding`, and the difference is load-bearing.** That one produces what a human reads
 * (`⌘T`); this one produces what `muda` parses into a real key equivalent. Handing the pretty form to
 * the menu gets it rejected, and a rejected accelerator does not fail loudly — the item simply appears
 * without a key, which looks like a menu somebody forgot to finish.
 *
 * `Cmd`/`Ctrl` explicitly rather than `CmdOrCtrl`: our defaults already differ per platform
 * (`defaultBindings`), so the platform decision has been made by the time a binding exists, and
 * asking the accelerator parser to make it a second time could only disagree.
 *
 * A single character is passed through as it is typed — `parse_key` falls back to a character key for
 * anything that is not a named code, so `,`, `]` and `=` all arrive intact.
 */
export function toAccelerator(binding: Binding): string {
  const parts = [
    ...(binding.meta ? ["Cmd"] : []),
    ...(binding.ctrl ? ["Ctrl"] : []),
    ...(binding.alt ? ["Alt"] : []),
    ...(binding.shift ? ["Shift"] : []),
    binding.key.length === 1 ? binding.key.toUpperCase() : binding.key,
  ];
  return parts.join("+");
}

/**
 * A binding from a keyboard event, or `null` when the event is not a combination at all.
 *
 * A bare modifier is not a shortcut — somebody holding `⌘` on the way to pressing something must not
 * have `⌘` recorded as their binding.
 */
export function bindingFromEvent(event: KeyboardEvent): Binding | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
  return {
    key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}

/** Whether an event is this binding. */
export function matches(binding: Binding, event: KeyboardEvent): boolean {
  const pressed = bindingFromEvent(event);
  if (pressed === null) return false;
  if (sameBinding(binding, pressed)) return true;
  // `⌘+` and `⌘=` are the same key on most layouts, and which one the browser reports depends on
  // whether Shift was involved. Accepting both is what makes "bigger" work with the key people press.
  const equivalent = new Map([
    ["=", "+"],
    ["+", "="],
    ["-", "_"],
    ["_", "-"],
  ]);
  const alias = equivalent.get(binding.key);
  if (alias === undefined) return false;
  return sameBinding({ ...binding, key: alias, shift: pressed.shift }, pressed);
}

/**
 * Make stored bindings safe to use.
 *
 * They come from `localStorage`, which anything can edit, and from builds that knew fewer actions.
 * An unknown action is dropped, a missing one falls back to its default, and **a binding that would
 * take a key from the shell is refused** — that last one is why this cannot merely be a type cast.
 */
export function sanitiseBindings(
  stored: unknown,
  mac: boolean = isMacPlatform(),
): Record<ActionId, Binding> {
  const defaults = defaultBindings(mac);
  if (typeof stored !== "object" || stored === null) return defaults;

  const source = new Map<string, unknown>(Object.entries(stored as Record<string, unknown>));
  // Built in a Map and converted at the end: writing through a variable index is an
  // object-injection sink to the lint, and there is a shape here with no such path.
  const out = new Map<string, Binding>(Object.entries(defaults));

  for (const action of ACTIONS) {
    const raw = source.get(action);
    if (typeof raw !== "object" || raw === null) continue;
    const candidate = raw as Partial<Binding>;
    if (typeof candidate.key !== "string" || candidate.key === "") continue;
    const binding: Binding = {
      key: candidate.key.length === 1 ? candidate.key.toLowerCase() : candidate.key,
      meta: candidate.meta === true,
      ctrl: candidate.ctrl === true,
      alt: candidate.alt === true,
      shift: candidate.shift === true,
    };
    if (isReservedForShell(binding, mac)) continue;
    out.set(action, binding);
  }
  return Object.fromEntries(out) as Record<ActionId, Binding>;
}
