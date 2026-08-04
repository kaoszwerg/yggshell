import { describe, it, expect } from "vitest";
import { appMenuSpec } from "./appMenu";
import { defaultBindings, type ActionId, type Binding } from "./shortcuts";
import { en } from "../i18n/en";
import type { MessageKey } from "../i18n";

/** The real catalogue, so a missing message is a missing message and not a stub. */
// Through a Map, not `en[key]`: a computed member read is an object-injection sink and the gate runs
// at --max-warnings 0 (the same reason `bindingFor` exists).
const catalogue = new Map<string, string>(Object.entries(en));

const t = (key: MessageKey, vars?: Record<string, string | number>): string => {
  let text = catalogue.get(key) ?? "";
  for (const [name, value] of Object.entries(vars ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
};

describe("appMenuSpec", () => {
  it("takes every key from the store, so the menu cannot disagree with the user", () => {
    // The defect this replaced: Tauri's default menu hard-codes ⌘W on "Close Window", and a menu key
    // equivalent is dispatched by AppKit BEFORE the webview sees the keystroke — so a menu that
    // disagrees with a binding does not lose that argument, it wins it, silently.
    const rebound: Record<ActionId, Binding> = {
      ...defaultBindings(true),
      newTab: { key: "y", meta: true, ctrl: false, alt: false, shift: true },
    };

    const spec = appMenuSpec(t, rebound);

    expect(spec.keys.newTab).toBe("Cmd+Shift+Y");
    expect(spec.keys.closeTab).toBe("Cmd+W");
  });

  it("gives every keyed item a key, and no item a key it does not have", () => {
    const spec = appMenuSpec(t, defaultBindings(true));

    // A sample of each submenu, so a whole section losing its keys is caught.
    const keys = new Map(Object.entries(spec.keys));
    for (const action of [
      "openSettings",
      "newTab",
      "find",
      "fontBigger",
      "toggleGitTool",
      "nextTab",
      "selectTab1",
    ]) {
      expect(keys.get(action), `${action} has no accelerator`).toMatch(/^Cmd\+/);
    }
    // Nothing that is not an action of ours: Quit, Copy and Full Screen carry the platform's own
    // keys, from the predefined items, and must not be offered here as if they were rebindable.
    expect(spec.keys.quit).toBeUndefined();
    expect(spec.keys.copy).toBeUndefined();
    expect(spec.keys.fullscreen).toBeUndefined();
  });

  it("fills every label from the catalogue, including all nine tabs", () => {
    // The spec is typed field by field precisely so a new item cannot ship without a translation.
    // What a type cannot catch is a label wired to the wrong message, or a list built one short.
    const spec = appMenuSpec(t, defaultBindings(true));

    expect(spec.labels.about).toBe("About YggShell");
    expect(spec.labels.shell).toBe("Shell");
    expect(spec.labels.selectTabs).toHaveLength(9);
    expect(spec.labels.selectTabs.at(-1)).toBe("Tab 9");
    expect(
      Object.values(spec.labels)
        .flat()
        .every((text) => text !== ""),
    ).toBe(true);
  });

  it("follows the language rather than carrying its own words", () => {
    const shouting = (key: MessageKey) => t(key).toUpperCase();
    const spec = appMenuSpec(shouting, defaultBindings(true));

    expect(spec.labels.about).toBe("ABOUT YGGSHELL");
  });
});
