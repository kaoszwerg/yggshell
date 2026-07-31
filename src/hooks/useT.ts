import { useCallback, useEffect } from "react";
import { useSettings } from "./useSettings";
import { useUiStore } from "../store/ui";
import { isLocale, translate, type Locale, type MessageKey } from "../i18n";

/**
 * The language the interface is in.
 *
 * Read from the UI store, which is populated from `localStorage` synchronously — so the very first
 * frame is already in the right language, and a leaf component asking for a word does not need a
 * query client to get one. `useSyncLocale` keeps it equal to the durable setting.
 */
export function useLocale(): Locale {
  return useUiStore((s) => s.locale);
}

/**
 * Bring the mirrored language into line with the stored one. Mounted once, at the app root.
 *
 * The direction matters: `settings.json` wins. The store's copy exists so the first paint is right,
 * not so it can disagree — a settings file edited by hand, or written by another instance, is the
 * truth, and this is where that truth arrives.
 */
export function useSyncLocale(): void {
  const settings = useSettings();
  const stored = settings.data?.language;
  const setLocale = useUiStore((s) => s.setLocale);

  useEffect(() => {
    // Only a language this build actually has. An unknown one leaves the current choice alone rather
    // than replacing the interface with message keys.
    if (isLocale(stored)) setLocale(stored);
  }, [stored, setLocale]);
}

/**
 * `t("settings.font.label")` — the message, in the user's language.
 *
 * The key is typed: `t` accepts nothing that is not in the catalogue, so a typo is a compile error
 * rather than an identifier on screen, and a message that exists in English but not in German cannot
 * be written in the first place (`i18n/de.ts` is typed against `i18n/en.ts`).
 */
export function useT(): (key: MessageKey, params?: Record<string, string | number>) => string {
  const locale = useLocale();
  return useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );
}
