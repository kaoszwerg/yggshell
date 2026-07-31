import { describe, it, expect } from "vitest";
import { LOCALES, isLocale, translate, type Locale } from "./index";
import { en } from "./en";
import { STATUS_ITEM_IDS } from "../lib/statusBar";
import { de } from "./de";

describe("the message catalogues", () => {
  it("offers exactly the languages that exist", () => {
    expect(LOCALES.map((l) => l.id)).toEqual(["en", "de"]);
  });

  it("says the same things in both", () => {
    // The type system already enforces this — `de` is typed against `en`'s keys — but a cast or a
    // widened type would slip past it silently, and a missing key means a raw identifier on screen.
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty message in either", () => {
    for (const [locale, catalogue] of [
      ["en", en],
      ["de", de],
    ] as const) {
      for (const [key, value] of Object.entries(catalogue)) {
        expect(value, `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("keeps every placeholder a message uses in both languages", () => {
    // A translation that drops `{name}` renders a sentence with a hole in it, and one that invents a
    // placeholder renders the literal braces. Neither fails a type check.
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const german = new Map<string, string>(Object.entries(de));
    for (const [key, english] of Object.entries(en)) {
      expect(holes(german.get(key) ?? ""), `placeholders in ${key}`).toEqual(holes(english));
    }
  });

  it("keeps the German translations actually German", () => {
    // A key copied across untranslated is the failure this catches: it type-checks, it renders, and
    // nobody notices until a German speaker reads it. A handful of terms are deliberately identical
    // in both (tmux, Git, YggShell), so only a broad match counts.
    const german = new Map<string, string>(Object.entries(de));
    const identical = Object.entries(en)
      .filter(([k, english]) => german.get(k) === english && english.split(/\s+/).length > 2)
      .map(([k]) => k);
    expect(identical, "long messages left untranslated").toEqual([]);
  });
});

describe("translate", () => {
  it("returns the message for the locale", () => {
    expect(translate("en", "settings.tab.appearance")).toBe(en["settings.tab.appearance"]);
    expect(translate("de", "settings.tab.appearance")).toBe(de["settings.tab.appearance"]);
  });

  it("fills placeholders", () => {
    expect(translate("en", "statusbar.editor.add", { item: "Spacer" })).toContain("Spacer");
  });

  it("leaves an unfilled placeholder visible rather than printing 'undefined'", () => {
    // Loud beats plausible: `Add undefined` reads like a real label and ships; `Add {item}` does not.
    expect(translate("en", "statusbar.editor.add", {})).toContain("{item}");
  });

  it("falls back to English for a message a locale somehow lacks", () => {
    // Cannot happen through the type system — but a hand-edited settings file can name a locale, and
    // an identifier on screen is worse than the English sentence.
    const catalogue = new Map<string, string>(Object.entries(de));
    catalogue.delete("settings.tab.appearance");
    const catalogues = new Map([["de" as const, catalogue]]);
    expect(translate("de", "settings.tab.appearance", undefined, catalogues)).toBe(
      en["settings.tab.appearance"],
    );
  });
});

describe("isLocale", () => {
  it("accepts what we ship and refuses the rest", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("narrows, so a caller can use the result directly", () => {
    const raw: unknown = "de";
    if (isLocale(raw)) {
      const locale: Locale = raw;
      expect(locale).toBe("de");
    }
  });
});

describe("messages that a data structure demands", () => {
  it("names every status-bar element, and explains it", () => {
    // The registry is ids only; the words live here. Nothing in the type system connects the two, so
    // adding an element and forgetting its messages would render the raw key in the palette.
    for (const id of STATUS_ITEM_IDS) {
      expect(en, `label for ${id}`).toHaveProperty(`statusbar.item.${id}`);
      expect(en, `hint for ${id}`).toHaveProperty(`statusbar.item.${id}.hint`);
    }
  });

  it("has no message for an element that no longer exists", () => {
    // The other direction: a removed element leaving its wording behind, which then has to be
    // translated forever by whoever adds the next language.
    const named = Object.keys(en)
      .filter((k) => k.startsWith("statusbar.item.") && !k.endsWith(".hint"))
      .map((k) => k.slice("statusbar.item.".length));
    expect(named.sort()).toEqual([...STATUS_ITEM_IDS].sort());
  });
});
