import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The emulator is mocked, deliberately and narrowly.
 *
 * xterm renders into a canvas/DOM tree jsdom cannot lay out, so a real one proves nothing here.
 * What these tests are for is the WIRING — the class of defect that passes every other test: a
 * handler that is correct and simply never registered. `dragDropEnabled` was exactly that, green
 * suite and a dead feature, and it is why this file exists.
 */
const handlers: {
  key?: (event: KeyboardEvent) => boolean;
} = {};

const term = {
  options: {} as Record<string, unknown>,
  rows: 24,
  cols: 80,
  unicode: { activeVersion: "6" },
  parser: { registerOscHandler: vi.fn() },
  loadAddon: vi.fn(),
  open: vi.fn(),
  focus: vi.fn(),
  write: vi.fn(),
  paste: vi.fn(),
  dispose: vi.fn(),
  clearTextureAtlas: vi.fn(),
  getSelection: vi.fn(() => ""),
  hasSelection: vi.fn(() => false),
  onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
  onBell: vi.fn(() => ({ dispose: vi.fn() })),
  onTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
  onData: vi.fn(() => ({ dispose: vi.fn() })),
  attachCustomKeyEventHandler: vi.fn((fn: (event: KeyboardEvent) => boolean) => {
    handlers.key = fn;
  }),
};

/** The options each `new Terminal(…)` was given — the only place a construction-time flag is visible. */
const constructed: Record<string, unknown>[] = [];

// Classes, not `vi.fn(() => …)`: every one of these is called with `new`, and an arrow function is
// not a constructor. A constructor returning an object hands that object back instead of `this`.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor(options: Record<string, unknown>) {
      constructed.push(options);
      return term;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../../lib/fonts", () => ({
  fontStack: () => "monospace",
  waitForFont: () => Promise.resolve(),
}));
// The helper is covered by its own tests; what is unproven here is whether this surface ever REACHES
// it — which is exactly the class of defect this file exists for.
vi.mock("../../lib/clipboard", () => ({ copyText: vi.fn() }));

const { TerminalSurface } = await import("./TerminalSurface");
const { copyText } = await import("../../lib/clipboard");

/** A keydown as xterm hands it over. */
function keydown(over: Partial<KeyboardEvent> = {}) {
  return {
    type: "keydown",
    key: "Enter",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    ...over,
  } as unknown as KeyboardEvent;
}

describe("TerminalSurface key handling", () => {
  const onData = vi.fn();

  beforeEach(() => {
    onData.mockClear();
    delete handlers.key;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    render(
      <TerminalSurface
        onData={onData}
        onResize={vi.fn()}
        onLink={vi.fn()}
        fontSize={13}
        theme={null}
      />,
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("registers a key handler at all — on every platform, macOS included", () => {
    // It used to be installed only on non-macOS, inside the copy/paste branch. Anything else that
    // needs a keystroke would have been dead on the maintainer's own machine.
    expect(handlers.key).toBeTypeOf("function");
  });

  it("sends Shift+Enter as ESC CR and keeps it from the emulator", () => {
    const handled = handlers.key?.(keydown({ shiftKey: true }));

    expect(onData).toHaveBeenCalledWith("\x1b\r");
    // `false` tells xterm not to encode the key itself — otherwise the program gets both.
    expect(handled).toBe(false);
  });

  it("also stops the BROWSER default, which is what made it fail in a real build", () => {
    // The defect: returning `false` stops xterm (`if (handler(e) === false) return false` in its
    // source) but xterm therefore never reaches the `preventDefault` it would have called. The
    // browser then puts a newline into the hidden textarea, xterm forwards it as input, and the
    // program gets ESC CR *and* a bare newline — the newline being the one that submits.
    //
    // Invisible in jsdom, which has no such default. Hence this test asserts the CALL.
    const event = keydown({ shiftKey: true });
    handlers.key?.(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("does not stop the default for a key it is passing through", () => {
    // Calling it unconditionally would break every key the terminal does not rewrite.
    const event = keydown();
    handlers.key?.(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves plain Enter entirely alone", () => {
    const handled = handlers.key?.(keydown());

    expect(onData).not.toHaveBeenCalled();
    expect(handled).toBe(true);
  });

  it("does not fire on key-up, or the program would receive it twice", () => {
    const handled = handlers.key?.(keydown({ type: "keyup", shiftKey: true }));

    expect(onData).not.toHaveBeenCalled();
    expect(handled).toBe(true);
  });
});

/**
 * Copy-on-select — the setting whose whole job is to be invisible, and which therefore had no test.
 *
 * It reached a release doing nothing at all: the copy ran through `navigator.clipboard.writeText()`,
 * which WebKit gates on a user gesture, and there is none left by the `mouseup` that copies (xterm
 * calls `preventDefault()` on `mousedown`). WebKit refused it without settling the promise, so
 * nothing was copied and not even the failure toast appeared. Copying from a note went on working,
 * because a button click IS a gesture — which is what made it look like a terminal defect.
 *
 * jsdom has no such gating, so these tests pin the half that CAN be pinned here: that the gesture is
 * wired to the copy at all, and that it respects the setting. The webview API being out of the path
 * is pinned in `lib/clipboard.test.ts`.
 */
describe("TerminalSurface copy-on-select", () => {
  /** The element xterm was mounted into — the one the listeners are attached to. */
  function host() {
    const mounted = term.open.mock.calls.at(-1)?.[0] as HTMLElement | undefined;
    if (mounted === undefined) throw new Error("the emulator was never opened");
    return mounted;
  }

  function mount(copyOnSelect: boolean, selection: string) {
    term.getSelection.mockReturnValue(selection);
    render(
      <TerminalSurface
        onData={vi.fn()}
        onResize={vi.fn()}
        onLink={vi.fn()}
        fontSize={13}
        theme={null}
        copyOnSelect={copyOnSelect}
      />,
    );
  }

  beforeEach(() => {
    vi.mocked(copyText).mockClear();
    term.open.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    term.getSelection.mockReturnValue("");
  });

  it("copies the selection when the mouse comes up", () => {
    mount(true, "a selected line");

    host().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(copyText).toHaveBeenCalledWith("a selected line", "clipboard.selection");
  });

  it("copies a selection made with the keyboard too", () => {
    // Shift+arrows select without the mouse ever being involved.
    mount(true, "shift-selected");

    host().dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

    expect(copyText).toHaveBeenCalledWith("shift-selected", "clipboard.selection");
  });

  it("does nothing while the setting is off", () => {
    mount(false, "a selected line");

    host().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(copyText).not.toHaveBeenCalled();
  });

  it("does not copy an empty selection, which every click would otherwise produce", () => {
    mount(true, "");

    host().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(copyText).not.toHaveBeenCalled();
  });
});

/**
 * Selecting with the mouse while a program owns it — the option without which macOS cannot select
 * at all.
 *
 * tmux with `set -g mouse on` turns on mouse reporting, and this app starts tmux by default. xterm
 * then hands the drag to the program: `SelectionService.handleMouseDown` returns early unless
 * `shouldForceSelection` agrees, and that reads `isMac ? altKey && macOptionClickForcesSelection :
 * shiftKey`. Windows and Linux get Shift for free; macOS gets nothing unless the option below is on.
 *
 * Measured against a built bundle before the fix: `getSelection()` was `""` on every mouseup inside
 * tmux and 30 characters outside it — same build, same gesture. Copy-on-select and Ctrl+Shift+C were
 * both unreachable on the platform this is developed on.
 */
describe("TerminalSurface selection while a program owns the mouse", () => {
  it("lets Option+drag force a selection, which is macOS' only way in", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    render(
      <TerminalSurface
        onData={vi.fn()}
        onResize={vi.fn()}
        onLink={vi.fn()}
        fontSize={13}
        theme={null}
      />,
    );

    expect(constructed.at(-1)?.macOptionClickForcesSelection).toBe(true);
    vi.unstubAllGlobals();
  });
});
