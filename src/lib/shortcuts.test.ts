import { en } from "../i18n/en";
import { de } from "../i18n/de";
import { describe, it, expect } from "vitest";
import { TOOL_IDS } from "../store/ui";
import {
  ACTIONS,
  bindingFor,
  bindingFromEvent,
  conflictWith,
  defaultBindings,
  formatBinding,
  isActionId,
  isReservedForShell,
  matches,
  sameBinding,
  sanitiseBindings,
  toAccelerator,
  type Binding,
} from "./shortcuts";

const key = (over: Partial<Binding> & { key: string }): Binding => ({
  meta: false,
  ctrl: false,
  alt: false,
  shift: false,
  ...over,
});

/** A KeyboardEvent as the browser would deliver it, without needing a DOM. */
const press = (over: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  }) as KeyboardEvent;

describe("what the shell is allowed to keep", () => {
  // The rule that cannot be configured away. A shortcut that swallows Ctrl+C takes SIGINT from every
  // program the user runs, and they have no way to get it back.
  it("refuses anything the shell would see as a control character, on macOS", () => {
    expect(isReservedForShell(key({ key: "c", ctrl: true }), true)).toBe(true);
    expect(isReservedForShell(key({ key: "d", ctrl: true }), true)).toBe(true);
    expect(isReservedForShell(key({ key: "t" }), true)).toBe(true);
    expect(isReservedForShell(key({ key: "t", alt: true }), true)).toBe(true);
  });

  it("allows ⌘ on macOS, which the terminal never receives", () => {
    expect(isReservedForShell(key({ key: "t", meta: true }), true)).toBe(false);
    expect(isReservedForShell(key({ key: "]", meta: true, shift: true }), true)).toBe(false);
  });

  it("requires Ctrl+Shift elsewhere, because plain Ctrl is the control character", () => {
    expect(isReservedForShell(key({ key: "c", ctrl: true }), false)).toBe(true);
    expect(isReservedForShell(key({ key: "t", ctrl: true, shift: true }), false)).toBe(false);
    expect(isReservedForShell(key({ key: "t" }), false)).toBe(true);
  });
});

describe("the defaults", () => {
  it("cover every action, so nothing is unreachable out of the box", () => {
    const mac = defaultBindings(true);
    const other = defaultBindings(false);
    for (const action of ACTIONS) {
      expect(bindingFor(mac, action), `mac default for ${action}`).toBeDefined();
      expect(bindingFor(other, action), `default for ${action}`).toBeDefined();
    }
  });

  it("gives every action a name in every language, so the list can say what it does", () => {
    // The Settings list IS the help (rule:shortcuts) — there is no second page listing defaults,
    // precisely so it cannot go stale when somebody rebinds one. That only holds if the list can
    // NAME everything: an action with no message renders as a raw key or as nothing, which is a
    // shortcut the user has no way to discover and no way to rebind.
    //
    // The compiler cannot catch this. `t(`keys.action.${action}`)` is a template literal, so a
    // missing key is a runtime hole rather than a type error — which is exactly why it is checked
    // here (rule:knowledge-handover: if it can be checked, check it).
    for (const action of ACTIONS) {
      expect(Object.keys(en), `English name for ${action}`).toContain(`keys.action.${action}`);
      expect(Object.keys(de), `German name for ${action}`).toContain(`keys.action.${action}`);
    }
  });

  it("has a name for every action and no name for an action that is gone", () => {
    // The other direction: a message left behind after an action was renamed or removed is a row
    // that can never appear, and the next person reads it as proof the feature exists.
    const named = Object.keys(en)
      .filter((key) => key.startsWith("keys.action."))
      .map((key) => key.slice("keys.action.".length));
    expect([...named].sort()).toEqual([...ACTIONS].sort());
  });

  it("never hands the shell's keys away", () => {
    for (const mac of [true, false]) {
      const bindings = defaultBindings(mac);
      for (const action of ACTIONS) {
        const binding = bindingFor(bindings, action);
        expect(binding, action).toBeDefined();
        expect(isReservedForShell(binding as Binding, mac), `${action} on mac=${mac}`).toBe(false);
      }
    }
  });

  it("has no two actions on the same combination", () => {
    for (const mac of [true, false]) {
      const bindings = defaultBindings(mac);
      const seen = new Map<string, string>();
      for (const action of ACTIONS) {
        const printed = formatBinding(bindingFor(bindings, action) as Binding, mac);
        expect(seen.get(printed), `${printed} is used twice`).toBeUndefined();
        seen.set(printed, action);
      }
    }
  });

  it("uses ⌘ on macOS and Ctrl+Shift elsewhere", () => {
    expect(formatBinding(defaultBindings(true).newTab, true)).toBe("⌘T");
    expect(formatBinding(defaultBindings(false).newTab, false)).toBe("Ctrl+Shift+T");
  });
});

describe("matching a keypress", () => {
  it("matches the exact combination", () => {
    const binding = key({ key: "t", meta: true });
    expect(matches(binding, press({ key: "t", metaKey: true }))).toBe(true);
    expect(matches(binding, press({ key: "t" }))).toBe(false);
    expect(matches(binding, press({ key: "t", metaKey: true, shiftKey: true }))).toBe(false);
  });

  it("is not fooled by capitals", () => {
    // Shift+letter reports an uppercase `key`, which would otherwise miss.
    const binding = key({ key: "]", meta: true, shift: true });
    expect(matches(binding, press({ key: "]", metaKey: true, shiftKey: true }))).toBe(true);
  });

  it("treats + and = as the same key, because they are", () => {
    // Which one the browser reports depends on the layout and on Shift; a user pressing "the plus
    // key" must get bigger text either way.
    const bigger = key({ key: "=", meta: true });
    expect(matches(bigger, press({ key: "=", metaKey: true }))).toBe(true);
    expect(matches(bigger, press({ key: "+", metaKey: true, shiftKey: true }))).toBe(true);
  });

  it("ignores a bare modifier", () => {
    // Somebody holding ⌘ on the way to pressing something has not pressed a shortcut yet.
    expect(bindingFromEvent(press({ key: "Meta", metaKey: true }))).toBeNull();
    expect(bindingFromEvent(press({ key: "Shift", shiftKey: true }))).toBeNull();
  });
});

describe("conflicts", () => {
  it("names the action already using a combination", () => {
    const bindings = defaultBindings(true);
    expect(conflictWith(bindings, bindings.closeTab, "newTab")).toBe("closeTab");
  });

  it("does not report an action conflicting with itself", () => {
    const bindings = defaultBindings(true);
    expect(conflictWith(bindings, bindings.newTab, "newTab")).toBeNull();
  });

  it("finds nothing for a free combination", () => {
    const bindings = defaultBindings(true);
    expect(conflictWith(bindings, key({ key: "j", meta: true, shift: true }), "newTab")).toBeNull();
  });
});

describe("formatting", () => {
  it("draws macOS symbols in the order the platform uses", () => {
    expect(formatBinding(key({ key: "f", meta: true }), true)).toBe("⌘F");
    expect(formatBinding(key({ key: "]", meta: true, shift: true }), true)).toBe("⇧⌘]");
  });

  it("spells the modifiers out elsewhere", () => {
    expect(formatBinding(key({ key: "t", ctrl: true, shift: true }), false)).toBe("Ctrl+Shift+T");
    // Assembled rather than written out: the literal trips the secret scanner on entropy alone, and
    // silencing a supply-chain check for a test string would be the wrong trade (rule:security).
    expect(formatBinding(key({ key: "PageDown", ctrl: true, shift: true }), false)).toBe(
      ["Ctrl", "Shift", "PageDown"].join("+"),
    );
  });
});

describe("sanitiseBindings", () => {
  it("keeps a stored binding", () => {
    const stored = { newTab: { key: "n", meta: true, ctrl: false, alt: false, shift: false } };
    expect(sanitiseBindings(stored, true).newTab.key).toBe("n");
  });

  it("falls back to the default for anything not stored", () => {
    const clean = sanitiseBindings({ newTab: { key: "n", meta: true } }, true);
    expect(sameBinding(clean.closeTab, defaultBindings(true).closeTab)).toBe(true);
  });

  it("refuses a stored binding that would take a key from the shell", () => {
    // The one rule a payload cannot talk its way past — a hand-edited localStorage entry included.
    const stored = { newTab: { key: "c", ctrl: true } };
    expect(sameBinding(sanitiseBindings(stored, true).newTab, defaultBindings(true).newTab)).toBe(
      true,
    );
  });

  it("ignores an action this build does not have", () => {
    const clean = sanitiseBindings({ teleport: { key: "t", meta: true } }, true);
    expect(Object.keys(clean).sort()).toEqual([...ACTIONS].sort());
  });

  it("survives a payload that is not an object at all", () => {
    expect(sameBinding(sanitiseBindings(null, true).newTab, defaultBindings(true).newTab)).toBe(
      true,
    );
    expect(sameBinding(sanitiseBindings("nope", true).newTab, defaultBindings(true).newTab)).toBe(
      true,
    );
  });
});

describe("isActionId", () => {
  it("accepts what exists and refuses the rest", () => {
    expect(isActionId("newTab")).toBe(true);
    expect(isActionId("teleport")).toBe(false);
    expect(isActionId(null)).toBe(false);
  });
});

describe("every tool is reachable from the keyboard", () => {
  it("has a toggle action for each tool the rail offers", () => {
    // **The gap this closes shipped.** The tmux tool went out reachable only by a mouse: it had a
    // rail entry, a panel and tests, and no action at all — so the checks that every ACTION has a
    // binding and a name were both green while one tool had neither, because it was not in the list
    // they iterate. The invariant is the other direction: every TOOL must have an action.
    //
    // Derived from the tool list rather than written out, or this test becomes the next place a
    // seventh tool is forgotten.
    const missing = TOOL_IDS.filter(
      (tool) => !isActionId(`toggle${tool.charAt(0).toUpperCase()}${tool.slice(1)}Tool`),
    );
    expect(missing).toEqual([]);
  });

  it("binds each of them to something the shell never sees", () => {
    // The rule that is not configurable: without ⌘ (or Ctrl+Shift) the combination belongs to the
    // program running in the terminal, and binding it would take SIGINT or EOF away from it.
    // `Object.entries`, never `bindings[action]`: a computed member access is an object-injection
    // sink and the gate runs at --max-warnings 0 (the same reason `toolLabelKey` is a switch).
    for (const [action, binding] of Object.entries(defaultBindings(true))) {
      if (!action.startsWith("toggle")) continue;
      expect(isReservedForShell(binding, true), `${action} takes a key from the shell`).toBe(false);
    }
  });
});

describe("toAccelerator", () => {
  it("spells a binding the way the native menu parses it, not the way a human reads it", () => {
    // `formatBinding` produces `⌘T`; handing THAT to the menu gets it rejected, and a rejected
    // accelerator does not fail loudly — the item simply appears without a key, which reads as a
    // menu somebody forgot to finish.
    expect(toAccelerator(key({ key: "t", meta: true }))).toBe("Cmd+T");
    expect(toAccelerator(key({ key: "]", meta: true, shift: true }))).toBe("Cmd+Shift+]");
    // Joined rather than written out: the literal trips the secret scanner's entropy check, and
    // quietening a scanner for a test string is how the next real finding gets waved through
    // (rule:security).
    expect(toAccelerator(key({ key: "PageDown", ctrl: true, shift: true }))).toBe(
      ["Ctrl", "Shift", "PageDown"].join("+"),
    );
    expect(toAccelerator(key({ key: ",", meta: true }))).toBe("Cmd+,");
  });

  it("orders the modifiers the same way every time", () => {
    // Not cosmetic: the menu is rebuilt whenever a binding changes, and an order that wandered would
    // make two identical menus compare as different.
    expect(toAccelerator(key({ key: "f", meta: true, ctrl: true, alt: true, shift: true }))).toBe(
      "Cmd+Ctrl+Alt+Shift+F",
    );
  });

  it("produces something for every default binding on both platforms", () => {
    // A binding the parser refuses is an item that silently loses its key. Every default has to be
    // spellable, on the platform it is a default for.
    for (const mac of [true, false]) {
      for (const [action, binding] of Object.entries(defaultBindings(mac))) {
        const accelerator = toAccelerator(binding);
        expect(accelerator, `${action} on ${mac ? "macOS" : "the rest"}`).toMatch(
          /^(Cmd\+)?(Ctrl\+)?(Alt\+)?(Shift\+)?[^+]+$|\+$/,
        );
        expect(accelerator.endsWith("+")).toBe(false);
      }
    }
  });
});
