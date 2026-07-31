import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { isLinux, isMac } from "../../lib/platform";
import { readPrimarySelection, setPrimarySelection } from "../../lib/primarySelection";
import { PALETTE } from "../../styles/palette";

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
  className = "",
}: TerminalSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);

  // The callbacks are read through refs so a parent re-render never tears down the emulator: xterm
  // owns a canvas, a WebGL context and the scrollback, and re-creating it would wipe the session's
  // history on every keystroke that changed a title somewhere.
  const handlers = useRef({ onData, onResize, onLink, onTitle, onSelectionChange });
  // Updated in an effect, not during render: a ref written while rendering is a React Compiler
  // violation, and it is declared before the mount effect below so the first callbacks xterm can
  // possibly fire already see the current values.
  useEffect(() => {
    handlers.current = { onData, onResize, onLink, onTitle, onSelectionChange };
  }, [onData, onResize, onLink, onTitle, onSelectionChange]);

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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      allowProposedApi: true, // required by the unicode11 addon
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 10_000,
      // Ctrl+C must stay SIGINT, so copy is never bound to it. The selection is still cleared on
      // input, which is what makes select-then-type behave like every other terminal.
      theme: {
        background: PALETTE.deep,
        foreground: PALETTE.fg,
        cursor: PALETTE.cyan,
        cursorAccent: PALETTE.deep,
        selectionBackground: `${PALETTE.cyan}40`,
        // xterm draws its own scrollbar; these are the only way to colour it, and
        // globals.css only gets to say how wide the slider paints.
        scrollbarSliderBackground: `${PALETTE.cyan}4d`,
        scrollbarSliderHoverBackground: `${PALETTE.cyan}99`,
        scrollbarSliderActiveBackground: PALETTE.cyan,
        black: PALETTE.deep,
        red: PALETTE.danger,
        green: PALETTE.green,
        yellow: PALETTE.gold,
        blue: PALETTE.cyan,
        magenta: PALETTE.purple,
        cyan: PALETTE.cyan,
        white: PALETTE.fg,
        brightBlack: PALETTE.dim,
        brightRed: PALETTE.danger,
        brightGreen: PALETTE.green,
        brightYellow: PALETTE.gold,
        brightBlue: PALETTE.cyan,
        brightMagenta: PALETTE.purple,
        brightCyan: PALETTE.cyan,
        brightWhite: "#ffffff",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = "11";
    const search = new SearchAddon();
    term.loadAddon(search);
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
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
    const titleSub = term.onTitleChange((title) => {
      if (title.trim() !== "") handlers.current.onTitle?.(title);
    });
    const dataSub = term.onData((data) => handlers.current.onData(data));

    // Middle-click pastes the primary selection, the way it does in every terminal on X11.
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
      const text = readPrimarySelection();
      if (text === "") return;
      event.preventDefault();
      event.stopPropagation();
      term.paste(text);
    };
    if (!isLinux()) host.addEventListener("mousedown", onMiddleDown, true);

    // Copy and paste on NON-macOS only.
    //
    // On macOS the WebView already handles ⌘C/⌘V natively — Tauri's default Edit menu supplies the
    // key equivalents, and xterm listens for the resulting `copy`/`paste` DOM events. Intercepting
    // them here pasted everything TWICE, because `return false` stops xterm's own key handling but
    // not the browser default that produces the paste event. So on macOS we stay out of the way.
    //
    // Ctrl+Shift+C / Ctrl+Shift+V are not browser shortcuts, so on Windows and Linux nothing happens
    // unless we do it — and the bare Ctrl+C a terminal owes to SIGINT can never be used for copy.
    if (!isMac()) {
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        if (!(event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey)) return true;

        switch (event.key.toLowerCase()) {
          case "c": {
            const selection = term.getSelection();
            // Nothing selected: let it through rather than becoming a key that silently does nothing.
            if (selection === "") return true;
            void navigator.clipboard.writeText(selection);
            return false;
          }
          case "v": {
            void navigator.clipboard.readText().then((text) => {
              if (text !== "") term.paste(text);
            });
            return false;
          }
          default:
            return true;
        }
      });
    }

    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();

    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    return () => {
      observer.disconnect();
      host.removeEventListener("mousedown", onMiddleDown, true);
      selectionSub.dispose();
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
