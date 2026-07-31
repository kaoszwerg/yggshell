import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { PALETTE } from "../../styles/palette";

/** The imperative surface of a terminal — the parts a caller must drive rather than describe. */
export interface TerminalHandle {
  /** Render output from the backend. Bytes, not text: the emulator decodes UTF-8 itself. */
  write: (bytes: Uint8Array) => void;
  /** Put the caret in this terminal. */
  focus: () => void;
  /** Re-measure and report the new geometry. Call after this surface becomes visible. */
  fit: () => void;
}

export interface TerminalSurfaceProps {
  ref?: Ref<TerminalHandle>;
  /** User input — keystrokes, pastes, control sequences — on its way to the PTY. */
  onData: (data: string) => void;
  /** Measured geometry, in character cells. Fires on mount and on every resize. */
  onResize: (rows: number, cols: number) => void;
  /** A link the user clicked. Routed by the caller, never opened by the webview itself. */
  onLink: (url: string) => void;
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
  className = "",
}: TerminalSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // The callbacks are read through refs so a parent re-render never tears down the emulator: xterm
  // owns a canvas, a WebGL context and the scrollback, and re-creating it would wipe the session's
  // history on every keystroke that changed a title somewhere.
  const handlers = useRef({ onData, onResize, onLink });
  // Updated in an effect, not during render: a ref written while rendering is a React Compiler
  // violation, and it is declared before the mount effect below so the first callbacks xterm can
  // possibly fire already see the current values.
  useEffect(() => {
    handlers.current = { onData, onResize, onLink };
  }, [onData, onResize, onLink]);

  useImperativeHandle(
    ref,
    () => ({
      write: (bytes: Uint8Array) => termRef.current?.write(bytes),
      focus: () => termRef.current?.focus(),
      fit: () => fitRef.current?.fit(),
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
      // The HUD palette (rule:theming). These are the JS mirrors of the `--saga-*` variables; xterm
      // cannot resolve a CSS `var()`, which is exactly what palette.ts exists for.
      theme: {
        background: PALETTE.deep,
        foreground: PALETTE.fg,
        cursor: PALETTE.cyan,
        cursorAccent: PALETTE.deep,
        selectionBackground: `${PALETTE.cyan}40`,
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

    const measure = () => {
      // A hidden pane measures 0×0. Fitting it would tell the backend the window has no screen, and
      // the child would reformat its output for one.
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      fit.fit();
      handlers.current.onResize(term.rows, term.cols);
    };

    const dataSub = term.onData((data) => handlers.current.onData(data));
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();

    termRef.current = term;
    fitRef.current = fit;

    return () => {
      observer.disconnect();
      dataSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className={`h-full w-full ${className}`.trim()} />;
}
