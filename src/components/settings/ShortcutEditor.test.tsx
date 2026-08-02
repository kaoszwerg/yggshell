import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { MouseReference, ShortcutEditor } from "./ShortcutEditor";
import { useUiStore } from "../../store/ui";
import { defaultBindings, formatBinding } from "../../lib/shortcuts";

/** Press a key at the window, in the capture phase the editor listens on. */
function press(key: string, mods: Partial<KeyboardEvent> = {}) {
  // In `act`, because the handler is on the window rather than on a node: React does not flush the
  // resulting state on its own, and the assertion would run against the frame before the keypress.
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        metaKey: mods.metaKey ?? false,
        ctrlKey: mods.ctrlKey ?? false,
        altKey: mods.altKey ?? false,
        shiftKey: mods.shiftKey ?? false,
        cancelable: true,
        bubbles: true,
      }),
    );
  });
}

const bindings = () => useUiStore.getState().shortcuts;

describe("ShortcutEditor", () => {
  beforeEach(() => {
    useUiStore.setState({ shortcuts: defaultBindings(true), locale: "en" });
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  });

  it("lists every action with the key that is bound right now", () => {
    render(<ShortcutEditor />);
    const list = screen.getByRole("list", { name: "Keyboard" });
    const rows = within(list).getAllByRole("listitem");

    expect(rows.length).toBeGreaterThan(15);
    expect(within(list).getByText("New terminal")).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /New terminal — ⌘T/ })).toBeInTheDocument();
  });

  it("shows a rebinding rather than the default", () => {
    // The reason this doubles as the help: a printed list of defaults is wrong the moment somebody
    // changes one, and then it is worse than no list at all.
    useUiStore.setState({
      shortcuts: {
        ...defaultBindings(true),
        newTab: { key: "n", meta: true, ctrl: false, alt: false, shift: false },
      },
    });
    render(<ShortcutEditor />);

    expect(screen.getByRole("button", { name: /New terminal — ⌘N/ })).toBeInTheDocument();
  });

  it("records a new binding", () => {
    // ⌘Y, not ⌘N: N belongs to the Notes tool now, and the editor correctly refuses a combination
    // that is already taken. The test wanted "any free key" and named one that stopped being free —
    // which is the editor's conflict check working, not a regression.
    render(<ShortcutEditor />);
    fireEvent.click(screen.getByRole("button", { name: /New terminal/ }));
    expect(screen.getByText("Press a key…")).toBeInTheDocument();

    press("y", { metaKey: true });

    expect(bindings().newTab.key).toBe("y");
    expect(screen.queryByText("Press a key…")).toBeNull();
  });

  it("refuses a combination the shell needs, and says which one to use", () => {
    // The rule that is not the user's to override: Ctrl+C is SIGINT for every program they run.
    render(<ShortcutEditor />);
    fireEvent.click(screen.getByRole("button", { name: /New terminal/ }));

    press("c", { ctrlKey: true });

    // The message says which modifier to use instead — refusing without saying what WOULD work is
    // how a user concludes the feature is broken.
    expect(screen.getByText("That combination belongs to the shell. Use ⌘.")).toBeInTheDocument();
    expect(bindings().newTab.key).toBe("t");
  });

  it("refuses a combination another action already has, and names it", () => {
    // Stealing it silently would leave the user with a key that stopped working and no idea why.
    render(<ShortcutEditor />);
    fireEvent.click(screen.getByRole("button", { name: /New terminal/ }));

    press("w", { metaKey: true });

    // Naming the other action matters: "already used" alone leaves the user hunting for it.
    expect(screen.getByText("Already used by “Close terminal”.")).toBeInTheDocument();
    expect(bindings().newTab.key).toBe("t");
  });

  it("lets an action keep its own key", () => {
    render(<ShortcutEditor />);
    fireEvent.click(screen.getByRole("button", { name: /New terminal/ }));

    press("t", { metaKey: true });

    expect(screen.queryByText(/Already used by/)).toBeNull();
    expect(bindings().newTab.key).toBe("t");
  });

  it("ignores a bare modifier while recording", () => {
    // Somebody holding ⌘ on the way to a letter has not chosen anything yet.
    render(<ShortcutEditor />);
    fireEvent.click(screen.getByRole("button", { name: /New terminal/ }));

    press("Meta", { metaKey: true });

    expect(screen.getByText("Press a key…")).toBeInTheDocument();
  });

  it("gives up on Escape without changing anything", () => {
    render(<ShortcutEditor />);
    fireEvent.click(screen.getByRole("button", { name: /New terminal/ }));

    press("Escape");

    expect(screen.queryByText("Press a key…")).toBeNull();
    expect(bindings().newTab.key).toBe("t");
  });

  it("captures the key instead of letting it act", () => {
    // Binding ⌘W must not close the tab on the way to being bound.
    render(<ShortcutEditor />);
    fireEvent.click(screen.getByRole("button", { name: /Close terminal/ }));

    const event = new KeyboardEvent("keydown", {
      key: "n",
      metaKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("puts every default back", () => {
    useUiStore.setState({
      shortcuts: {
        ...defaultBindings(true),
        newTab: { key: "n", meta: true, ctrl: false, alt: false, shift: false },
      },
    });
    render(<ShortcutEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Reset all shortcuts" }));

    expect(formatBinding(bindings().newTab, true)).toBe("⌘T");
  });
});

describe("MouseReference", () => {
  beforeEach(() => {
    useUiStore.setState({ locale: "en" });
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  });

  it("states what the mouse does, since none of it is discoverable", () => {
    render(<MouseReference />);
    const list = screen.getByRole("list", { name: "Mouse" });

    expect(within(list).getByText("Open a link in the browser")).toBeInTheDocument();
    expect(within(list).getByText("⌘-click")).toBeInTheDocument();
    expect(within(list).getByText("Middle click")).toBeInTheDocument();
  });
});
