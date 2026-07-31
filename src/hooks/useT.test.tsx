import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLocale, useSyncLocale, useT } from "./useT";
import { useSettings } from "./useSettings";
import { useUiStore } from "../store/ui";
import { en } from "../i18n/en";
import { de } from "../i18n/de";

vi.mock("./useSettings", () => ({ useSettings: vi.fn() }));

/** What the settings query would answer. `undefined` is "still loading". */
function storedLanguage(language: string | undefined) {
  vi.mocked(useSettings).mockReturnValue({
    data: language === undefined ? undefined : { language },
  } as unknown as ReturnType<typeof useSettings>);
}

describe("useLocale", () => {
  beforeEach(() => {
    vi.mocked(useSettings).mockReset();
    useUiStore.setState({ locale: "en" });
  });

  it("is the mirrored choice, available without a query client", () => {
    // The point of the mirror: a leaf component asking for a word must not need an IPC provider, and
    // the first frame must already be in the right language rather than switching after a round trip.
    useUiStore.setState({ locale: "de" });
    expect(renderHook(() => useLocale()).result.current).toBe("de");
  });

  it("is English until something says otherwise", () => {
    expect(renderHook(() => useLocale()).result.current).toBe("en");
  });
});

describe("useSyncLocale", () => {
  beforeEach(() => {
    vi.mocked(useSettings).mockReset();
    useUiStore.setState({ locale: "en" });
  });

  it("brings the stored language into the mirror", async () => {
    // settings.json is the durable truth; the mirror exists for the first paint, not to disagree.
    storedLanguage("de");
    renderHook(() => useSyncLocale());
    await waitFor(() => expect(useUiStore.getState().locale).toBe("de"));
  });

  it("leaves the mirror alone while the settings are still loading", async () => {
    useUiStore.setState({ locale: "de" });
    storedLanguage(undefined);
    renderHook(() => useSyncLocale());
    await waitFor(() => expect(useUiStore.getState().locale).toBe("de"));
  });

  it("ignores a language this build does not have", async () => {
    // A downgrade, or a hand-edited settings file. Replacing the interface with raw message keys is
    // worse than keeping the language the user is already reading.
    useUiStore.setState({ locale: "de" });
    storedLanguage("fr");
    renderHook(() => useSyncLocale());
    await waitFor(() => expect(useUiStore.getState().locale).toBe("de"));
  });

  it("ignores an empty setting, which is what an untouched install has", async () => {
    useUiStore.setState({ locale: "de" });
    storedLanguage("");
    renderHook(() => useSyncLocale());
    await waitFor(() => expect(useUiStore.getState().locale).toBe("de"));
  });
});

describe("useT", () => {
  beforeEach(() => {
    vi.mocked(useSettings).mockReset();
    useUiStore.setState({ locale: "en" });
  });

  it("translates into the chosen language", () => {
    useUiStore.setState({ locale: "de" });
    const { result } = renderHook(() => useT());
    expect(result.current("settings.tab.appearance")).toBe(de["settings.tab.appearance"]);
  });

  it("translates into English by default", () => {
    const { result } = renderHook(() => useT());
    expect(result.current("settings.tab.appearance")).toBe(en["settings.tab.appearance"]);
  });

  it("fills placeholders", () => {
    useUiStore.setState({ locale: "de" });
    const { result } = renderHook(() => useT());
    expect(result.current("statusbar.editor.add", { item: "Trennlinie" })).toContain("Trennlinie");
  });

  it("returns a stable function while the language does not change", () => {
    // It ends up in dependency arrays all over the app; a new identity on every render would
    // re-subscribe effects and rebuild callbacks continuously.
    const { result, rerender } = renderHook(() => useT());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
