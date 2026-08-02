import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { fontStack, waitForFont } from "../../lib/fonts";
import { parseOsc7 } from "../../lib/osc7";
import { parseOsc133, type Activity } from "../../lib/osc133";
import { isLinux, isMac } from "../../lib/platform";
import { setPrimarySelection } from "../../lib/primarySelection";
import { encodeKey } from "../../lib/terminalKeys";
import { resolveTheme } from "../../lib/terminalTheme";
import { copyText } from "../../lib/clipboard";
import type { TerminalTheme } from "../../bindings/TerminalTheme";

/** Which way a search step runs. */
export type SearchDirection = "next" | "previous";

/** The imperative surface of a terminal — the parts a caller must drive rather than describe. */
export interface TerminalHandle {
  /** Render output from the backend. Bytes, not text: the emulator decodes UTF-8 itself. */
  write: (bytes: Uint8Array) => void;
  /** Put the caret in this terminal. */
  focus: () => void;
  /** Re-measure and report the new geometry. Call after this surface becomes visible. */
  fit: () => void;
  /**
   * Paste text as *input*, through the emulator rather than straight down the wire — that is what
   * wraps it in bracketed-paste markers, so a shell knows it was pasted and does not execute a
   * multi-line paste line by line.
   */
  paste: (text: string) => void;
  /** Step to the next/previous match. Returns whether one was found. */
  find: (query: string, direction: SearchDirection) => boolean;
  /** Drop the highlights. */
  clearSearch: () => void;
}

export interface TerminalSurfaceProps {
  ref?: Ref<TerminalHandle>;
  /** User input — keystrokes, pastes, control sequences — on its way to the PTY. */
  onData: (data: string) => void;
  /** Measured geometry, in character cells. Fires on mount and on every resize. */
  onResize: (rows: number, cols: number) => void;
  /** A link the user clicked. Routed by the caller, never opened by the webview itself. */
  onLink: (url: string) => void;
  /** The title the shell set (OSC 0/2). Never fires unless the shell actually sets one. */
  onTitle?: (title: string) => void;
  /** Whether anything is selected right now — so a caller can disable "Copy" honestly. */
  onSelectionChange?: (hasSelection: boolean) => void;
  /**
   * Text size in the emulator, in CSS pixels — already divided by the UI scale by the caller.
   *
   * Applied to the live terminal rather than by rebuilding it: recreating the emulator would throw
   * away the scrollback and the running process every time the slider moved.
   */
  fontSize: number;
  /**
   * The colour scheme, or `null`/absent for the built-in HUD palette.
   *
   * Applied to the live terminal like `fontSize`, and for the same reason: rebuilding the emulator to
   * repaint it would take the scrollback and the running process with it.
   */
  theme?: TerminalTheme | null;
  /**
   * Copy to the clipboard the moment something is selected.
   *
   * Off unless the user asks for it: it replaces whatever they had copied, silently, which is only
   * welcome when it was expected.
   */
  copyOnSelect?: boolean;
  /**
   * The font family the emulator renders in, or empty for the app's default stack.
   *
   * Applied to the live terminal like the size and the theme: rebuilding the emulator to change a
   * typeface would take the scrollback and the running process with it.
   */
  fontFamily?: string;
  /** The shell's current working directory, as it reports it (OSC 7). Never fires for a shell that
   *  does not emit the sequence — see the backend's shell integration. */
  onCwd?: (path: string) => void;
  /** What the shell says it is doing (OSC 133). Never fires for a shell without the hook. */
  onActivity?: (activity: Activity) => void;
  /**
   * A program rang the terminal bell (`\a`).
   *
   * Deliberately plain: the bell carries no information beyond "something happened here", and it is
   * rung by plenty of things that are not asking for attention — zsh on an ambiguous completion,
   * `less` at the end of a search. The caller decides what it is worth; this only reports it.
   *
   * **It is also the one signal that survives tmux.** Measured: tmux registers a bell
   * (`window_bell_flag`) and forwards it with `bell-action any`, while it swallows OSC sequences
   * entirely — the same finding as OSC 7.
   */
  onBell?: () => void;
  /**
   * Read the clipboard, for `Ctrl+Shift+V`.
   *
   * A PROP rather than a call: this is a primitive, and a primitive that does IPC behaves differently
   * depending on where you put it (rule:frontend-architecture). It also cannot use the webview's own
   * clipboard read — that is permission-gated here and fails in a way that looks like the app
   * hanging — so the caller supplies the one that works.
   */
  onReadClipboard?: () => Promise<string>;
  className?: string;
}

/**
 * The terminal emulator, and the **only** file in this app permitted to import `@xterm/*`
 * (ADR-PROJ-001 §1, enforced by the `ui-boundary.json` lint gate).
 *
 * Under ADR-APP-026 the emulator is a *mechanism*, not a control wearing its own look: everything the
 * user sees — palette, font, cursor, selection — is driven from the HUD theme below, which is the
 * feature rather than a compromise. The chrome around it (tab strip, context menu, search bar) is
 * built from HUD primitives and never comes from here.
 *
 * Geometry is measured, never assumed: the fit addon converts the container's pixels into rows and
 * columns, and a `ResizeObserver` re-measures whenever the layout moves. The caller forwards the
 * result to the backend so the child gets its `SIGWINCH`.
 */
export function TerminalSurface({
  ref,
  onData,
  onResize,
  onLink,
  onTitle,
  onSelectionChange,
  onCwd,
  onActivity,
  onBell,
  onReadClipboard,
  fontSize,
  theme,
  copyOnSelect,
  fontFamily,
  className = "",
}: TerminalSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /** The font stack last loaded and handed to the emulator. `null` until the first one lands. */
  const appliedFont = useRef<string | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);

  // The callbacks are read through refs so a parent re-render never tears down the emulator: xterm
  // owns a canvas, a WebGL context and the scrollback, and re-creating it would wipe the session's
  // history on every keystroke that changed a title somewhere.
  const handlers = useRef({
    onData,
    onResize,
    onLink,
    onTitle,
    onSelectionChange,
    onCwd,
    onActivity,
    onBell,
    onReadClipboard,
    fontSize,
    theme,
    copyOnSelect,
    fontFamily,
  });
  // Updated in an effect, not during render: a ref written while rendering is a React Compiler
  // violation, and it is declared before the mount effect below so the first callbacks xterm can
  // possibly fire already see the current values.
  useEffect(() => {
    handlers.current = {
      onData,
      onResize,
      onLink,
      onTitle,
      onSelectionChange,
      onCwd,
      onActivity,
      onBell,
      onReadClipboard,
      fontSize,
      theme,
      copyOnSelect,
      fontFamily,
    };
  }, [
    onData,
    onResize,
    onLink,
    onTitle,
    onSelectionChange,
    onCwd,
    onActivity,
    onBell,
    onReadClipboard,
    fontSize,
    theme,
    copyOnSelect,
    fontFamily,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      write: (bytes: Uint8Array) => termRef.current?.write(bytes),
      focus: () => termRef.current?.focus(),
      fit: () => fitRef.current?.fit(),
      paste: (text: string) => termRef.current?.paste(text),
      find: (query, direction) => {
        const search = searchRef.current;
        if (!search || query === "") return false;
        return direction === "next" ? search.findNext(query) : search.findPrevious(query);
      },
      clearSearch: () => searchRef.current?.clearDecorations(),
    }),
    [],
  );

  // A colour scheme reaches the LIVE terminal too, and for the same reason: rebuilding the emulator
  // to repaint it would throw away the scrollback and the running process with it.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = resolveTheme(theme);
  }, [theme]);

  // A font change reaches the LIVE terminal — after the font is actually loaded, and with the glyph
  // cache thrown away.
  //
  // Both halves are load-bearing, and skipping either produces the same symptom: a Powerline prompt
  // rendered as empty boxes that only comes right if you switch the font away and back.
  //
  //  - `@font-face` fonts load lazily. The terminal measures and paints immediately, so without the
  //    wait it measures the FALLBACK and draws in it.
  //  - xterm's WebGL renderer caches rendered glyphs in a texture atlas. Once the fallback's boxes
  //    are in there, the real font arriving changes nothing until the atlas is cleared — which is
  //    precisely what switching the font away and back was doing by accident.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const stack = fontStack(fontFamily ?? "");
    // Compared against what was last *loaded and applied*, not against the terminal's current option:
    // the emulator is constructed with the stack already set, so comparing there would skip the very
    // first run — which is exactly the case that matters, a freshly started app whose bundled font has
    // not been fetched yet.
    if (appliedFont.current === stack) return;
    appliedFont.current = stack;

    let cancelled = false;
    void waitForFont(fontFamily ?? "").then((ready) => {
      // The pane may have been closed, or the font changed again, while we waited.
      if (cancelled || termRef.current !== term) return;
      if (!ready) {
        console.warn(`terminal: ${fontFamily} is not available — falling back`);
      }
      term.options.fontFamily = stack;
      term.clearTextureAtlas();
      fitRef.current?.fit();
      handlers.current.onResize(term.rows, term.cols);
    });

    return () => {
      cancelled = true;
    };
  }, [fontFamily]);

  // Size changes reach the LIVE terminal. The mount effect below deliberately does not depend on
  // `fontSize`, or every step would dispose the emulator and take the scrollback with it.
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    // The cell grid changed, so the geometry did too: refit and let the backend hear about it.
    fitRef.current?.fit();
    handlers.current.onResize(term.rows, term.cols);
  }, [fontSize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      allowProposedApi: true, // required by the unicode11 addon
      cursorBlink: true,
      cursorStyle: "bar",
      // Read through the ref like `fontSize`, so a change repaints rather than rebuilds.
      fontFamily: fontStack(handlers.current.fontFamily ?? ""),
      // Read through the ref so the mount effect below does not depend on the prop: depending on it
      // would rebuild the emulator on every size step and take the scrollback with it.
      fontSize: handlers.current.fontSize,
      lineHeight: 1.25,
      scrollback: 10_000,
      // Ctrl+C must stay SIGINT, so copy is never bound to it. The selection is still cleared on
      // input, which is what makes select-then-type behave like every other terminal.
      // Read through the ref for the same reason as `fontSize`: depending on the prop here would
      // rebuild the emulator whenever the scheme changed.
      theme: resolveTheme(handlers.current.theme),
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = "11";
    const search = new SearchAddon();
    term.loadAddon(search);
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        // ⌘-click on macOS, Ctrl-click elsewhere — the convention every editor and terminal shares.
        // A plain click in a terminal is a selection or a cursor move, and opening a browser because
        // somebody clicked a line of log output is exactly the surprise this modifier prevents.
        // (Ctrl-click is a right-click on macOS, hence the split.)
        const wanted = isMac() ? event.metaKey : event.ctrlKey;
        if (!wanted) return;
        handlers.current.onLink(uri);
      }),
    );

    term.open(host);

    // WebGL is an optimisation, never a requirement: WebKitGTK on Linux is the weakest target
    // (rule:cross-platform) and may refuse the context. Failing to get it must cost frames, not the
    // terminal — xterm's built-in DOM renderer takes over, which is why no canvas addon is needed.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch (error) {
      console.warn("terminal: WebGL renderer unavailable, falling back to the DOM renderer", error);
    }

    // Last geometry actually reported. Dragging the tool column's splitter fires the observer every
    // frame, but rows and columns only change every whole cell — reporting each frame would be a
    // hundred IPC calls and a hundred SIGWINCHs for a terminal that did not change size.
    let reported = { rows: 0, cols: 0 };
    const measure = () => {
      // A hidden pane measures 0×0. Fitting it would tell the backend the window has no screen, and
      // the child would reformat its output for one.
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      fit.fit();
      if (term.rows === reported.rows && term.cols === reported.cols) return;
      reported = { rows: term.rows, cols: term.cols };
      handlers.current.onResize(term.rows, term.cols);
    };

    // Selecting IS the copy, as on X11 — this is what a middle-click then pastes.
    const selectionSub = term.onSelectionChange(() => {
      setPrimarySelection(term.getSelection());
      handlers.current.onSelectionChange?.(term.hasSelection());
    });

    // …and, when asked for, the real clipboard too. Bound to the END of a selection rather than to
    // every change: `onSelectionChange` fires for every cell the pointer crosses, and writing the
    // clipboard a hundred times during one drag is both wasteful and, on a slow write, wrong — the
    // last value to land would not be the last one selected.
    const copySelection = () => {
      if (handlers.current.copyOnSelect !== true) return;
      const selection = term.getSelection();
      if (selection === "") return;
      // The clipboard can refuse — permissions, a webview without focus. `copyText` says so on
      // screen rather than to a console the user does not have open, which is what this setting
      // needs most: copy-on-select gives no other sign that it happened.
      copyText(selection, "clipboard.selection");
    };
    host.addEventListener("mouseup", copySelection);
    // Shift+arrows select without the mouse ever being involved.
    host.addEventListener("keyup", copySelection);
    const bellSub = term.onBell(() => handlers.current.onBell?.());
    const titleSub = term.onTitleChange((title) => {
      if (title.trim() !== "") handlers.current.onTitle?.(title);
    });
    const dataSub = term.onData((data) => handlers.current.onData(data));

    // OSC 7 — the shell announcing where it is: `ESC ] 7 ; file://<host><path> ST`. This is what lets
    // the Git tool follow a `cd` without querying process internals per platform. Returning `true`
    // marks the sequence handled so it is not echoed as text.
    term.parser.registerOscHandler(7, (data) => {
      const path = parseOsc7(data);
      if (path !== null) handlers.current.onCwd?.(path);
      return true;
    });

    // OSC 133 — the shell saying that a command started or finished, and how. Same vocabulary iTerm2
    // uses, and the thing that drives the activity line. Measured to reach us from a plain shell and
    // to be swallowed entirely by tmux, where it is polled from `#{pane_current_command}` instead.
    term.parser.registerOscHandler(133, (data) => {
      const activity = parseOsc133(data);
      if (activity !== null) handlers.current.onActivity?.(activity);
      return true;
    });

    // Middle-click pastes the CLIPBOARD.
    //
    // It used to paste an app-scoped stand-in for the X11 PRIMARY selection, and that was the wrong
    // call in a way worth writing down: the handler is skipped on Linux (below), because there the
    // real PRIMARY works and the WebView does it properly. So the emulation ran on exactly the two
    // platforms whose users have never had a PRIMARY selection and do not expect one — a macOS user
    // middle-clicking means "paste what I copied", which is what iTerm2 does, and got what they had
    // last selected instead.
    //
    // The stand-in is redundant here anyway: `copy_on_select` already puts a selection in the
    // clipboard for anyone who wants selecting to be copying. With it off, the clipboard is what was
    // deliberately copied, which is the whole point of the gesture.
    //
    // Two things this went wrong on before:
    //
    // 1. It listened for `auxclick`. xterm's SelectionService calls preventDefault on `mousedown`,
    //    and WebKit then never dispatches the auxclick — so the handler simply never ran. Listening
    //    on `mousedown` in the CAPTURE phase runs before any descendant listener, so nothing xterm
    //    does can swallow it.
    // 2. It ran on Linux too. There, xterm already moves the textarea under the cursor on auxclick
    //    so the WebView performs a NATIVE paste of the real X11 PRIMARY — text selected in any other
    //    application included. Ours is an app-scoped stand-in and strictly worse, so on Linux we stay
    //    out of the way and let the desktop do it properly.
    //
    // Deliberately unconditional otherwise: a program that has taken over the mouse (tmux, vim) would
    // receive the click instead in some terminals, but losing the paste is the more surprising break.
    const onMiddleDown = (event: globalThis.MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      // Through the caller's reader, not `navigator.clipboard`: that one is permission-gated in this
      // webview and produces a native confirmation nobody sees — it pasted nothing, and looked like
      // the app had hung (0.39.6). This was the third such call site and the one I missed then.
      void handlers.current.onReadClipboard?.().then((text) => {
        if (text !== "") term.paste(text);
      });
    };
    if (!isLinux()) host.addEventListener("mousedown", onMiddleDown, true);

    // ONE key handler for the whole surface. xterm keeps only the last custom key-event handler it
    // was given, so a second registration anywhere would silently replace this one — everything
    // that inspects a keystroke has to live in here.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;

      // Keys the classic encoding cannot express — Shift+Enter, which the harness needs constantly
      // (lib/terminalKeys). Sent as INPUT, exactly as if the user had typed those bytes; the webview
      // never decides what runs (ADR-PROJ-001 §5).
      const encoded = encodeKey(event);
      if (encoded !== null) {
        // `preventDefault` FIRST, and it is not optional. Returning `false` stops xterm's own
        // handling — its source reads `if (handler(e) === false) return false` — and xterm never
        // gets as far as the `preventDefault` it would otherwise call. The browser default then
        // runs: Enter puts a newline into the hidden textarea, which xterm forwards as input. The
        // program received ESC CR *and* a bare newline, and the newline is what submits. That is
        // exactly why Shift+Enter appeared to do nothing but send.
        event.preventDefault();
        handlers.current.onData(encoded);
        return false;
      }

      // Copy and paste on NON-macOS only.
      //
      // On macOS the WebView already handles ⌘C/⌘V natively — Tauri's default Edit menu supplies the
      // key equivalents, and xterm listens for the resulting `copy`/`paste` DOM events. Intercepting
      // them here pasted everything TWICE, because `return false` stops xterm's own key handling but
      // not the browser default that produces the paste event. So on macOS we stay out of the way.
      //
      // Ctrl+Shift+C / Ctrl+Shift+V are not browser shortcuts, so on Windows and Linux nothing
      // happens unless we do it — and the bare Ctrl+C a terminal owes to SIGINT can never be copy.
      if (isMac()) return true;
      if (!(event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey)) return true;

      switch (event.key.toLowerCase()) {
        case "c": {
          const selection = term.getSelection();
          // Nothing selected: let it through rather than becoming a key that silently does nothing.
          if (selection === "") return true;
          copyText(selection, "clipboard.selection");
          return false;
        }
        case "v": {
          // From the backend, for the same reason the context menu reads it there: the webview's own
          // clipboard read is permission-gated and fails in a way that looks like the app hanging.
          void handlers.current.onReadClipboard?.().then((text) => {
            if (text !== "") term.paste(text);
          });
          return false;
        }
        default:
          return true;
      }
    });

    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();

    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    return () => {
      observer.disconnect();
      host.removeEventListener("mouseup", copySelection);
      host.removeEventListener("keyup", copySelection);
      host.removeEventListener("mousedown", onMiddleDown, true);
      selectionSub.dispose();
      bellSub.dispose();
      titleSub.dispose();
      dataSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className={`h-full w-full ${className}`.trim()} />;
}
