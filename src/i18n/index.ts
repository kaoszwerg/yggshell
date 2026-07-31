/**
 * Two languages, and the machinery to keep them honest.
 *
 * **Why not a library.** `react-i18next` and friends solve problems this app does not have —
 * namespaces, lazy-loaded bundles, ICU plurals across a dozen locales, a backend that serves
 * translations. What it *would* cost is a dependency whose types cannot tell you that a key is
 * missing (rule:dependencies: justify it, prefer the smaller thing). Here, `de` is typed against
 * `en`, so **a new English message that nobody translated is a compile error** — the strongest form
 * the handover can take (rule:knowledge-handover §1), and precisely what a runtime lookup with a
 * string key cannot give you.
 *
 * **English is the source.** `en.ts` is where a message is written and where it is edited; every
 * other catalogue is typed against it and follows.
 */
import { en } from "./en";
import { de } from "./de";

/** A message key. Every one of them exists in every language, by construction. */
export type MessageKey = keyof typeof en;

/** What `en.ts` defines and every other catalogue must match exactly. */
export type Translations = Record<MessageKey, string>;

export type Locale = "en" | "de";

/**
 * The languages on offer, in the order the picker shows them.
 *
 * Each is named in **its own** language: someone who has landed in a language they cannot read needs
 * to find their way out, and "German" is no help to a reader who only reads German.
 */
export const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "de", label: "Deutsch" },
];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * The catalogues, as maps.
 *
 * A `Map` rather than `CATALOGUES[locale][key]`: an index written from a variable is an
 * object-injection sink as far as the lint is concerned, and the honest alternatives are a
 * suppression at each site or a lookup that genuinely has no such path. A `Map` cannot reach
 * `__proto__` or `constructor`, so the rule stays armed everywhere else (rule:code-quality).
 */
const CATALOGUES = new Map<Locale, Map<string, string>>([
  ["en", new Map(Object.entries(en))],
  ["de", new Map(Object.entries(de))],
]);

const ENGLISH = new Map<string, string>(Object.entries(en));

/** Whether a stored or user-supplied value names a language this build actually has. */
export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "de";
}

/**
 * The message for `key` in `locale`, with `{placeholder}`s filled from `params`.
 *
 * A placeholder with no value is **left as it is written** rather than replaced with `undefined`:
 * `Add {item}` is visibly unfinished and gets fixed, while `Add undefined` reads like a real label
 * and ships.
 *
 * `catalogues` exists for the tests, which need to construct a catalogue that is missing something —
 * a state the type system otherwise makes unreachable.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
  catalogues: Map<Locale, Map<string, string>> = CATALOGUES,
): string {
  // English is the fallback, not the key: a hand-edited settings file can name anything, and a
  // sentence in the wrong language beats `settings.tab.appearance` on screen.
  const message = catalogues.get(locale)?.get(key) ?? ENGLISH.get(key) ?? key;
  if (params === undefined) return message;
  const values = new Map<string, string | number>(Object.entries(params));
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values.get(name);
    return value === undefined ? whole : String(value);
  });
}

/**
 * The interface language, read without a hook and without ever throwing.
 *
 * **For the last-resort screens only** (`FatalScreen`, the crash handlers). Those run when React has
 * already failed, possibly because of the very store a hook would subscribe to — so this reads the
 * value defensively and falls back to English rather than adding a second failure on top of the
 * first. A crash screen that crashes tells the user nothing at all (rule:crash-handling).
 *
 * Everywhere else, use `useT`: it is reactive, and switching language should redraw the interface.
 */
export function localeOutsideReact(read: () => unknown): Locale {
  try {
    const value = read();
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
