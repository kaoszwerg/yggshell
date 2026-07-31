import { useCallback, useEffect, useRef } from "react";
import { TerminalSquare } from "lucide-react";
import { api } from "../api/commands";
import { terminalApi, type SessionId } from "../api/terminal";
import { Button } from "../components/ui/Button";
import { ContextMenu } from "../components/ui/ContextMenu";
import { TerminalSurface, type TerminalHandle } from "../components/ui/TerminalSurface";
import { useTerminalStore } from "../store/terminal";

/** Written into the terminal itself when something goes wrong. A failure the user cannot see is a
 *  silent failure (rule:logging), and this is the one surface they are already looking at. */
const encoder = new TextEncoder();
const notice = (text: string) => encoder.encode(`\r\n\x1b[38;2;255;51;102m${text}\x1b[0m\r\n`);

/**
 * The terminal workspace. Every open pane stays mounted — only the active one is visible — so
 * switching tabs keeps scrollback, cursor position and the running process exactly where they were.
 *
 * Tabs themselves live in the title bar (ADR-PROJ-001): they cost no extra height there, and the
 * strip is driven by the same store this view renders from.
 */
export function TerminalView() {
  const panes = useTerminalStore((s) => s.panes);
  const activeKey = useTerminalStore((s) => s.activeKey);
  const openPane = useTerminalStore((s) => s.openPane);
  const bootstrap = useTerminalStore((s) => s.bootstrap);
  const closePane = useTerminalStore((s) => s.closePane);

  /** Backend session id per pane, learned once the PTY is actually open. */
  const sessions = useRef(new Map<string, SessionId>());

  const registerSession = useCallback((key: string, id: SessionId) => {
    sessions.current.set(key, id);
  }, []);

  // One terminal is waiting the first time this view is reached. See `bootstrap`.
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // One listener for the whole view rather than one per pane: a session that ends by itself closes
  // its tab, so `exit` behaves like clicking the ×.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void terminalApi
      .onExit((exit) => {
        for (const [key, id] of sessions.current) {
          if (id !== exit.id) continue;
          sessions.current.delete(key);
          closePane(key);
          return;
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [closePane]);

  if (panes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <TerminalSquare className="text-cyan/40" size={48} strokeWidth={1.25} aria-hidden />
        <p className="text-dim font-mono text-sm">No terminal open.</p>
        <Button accent="green" onClick={() => openPane()}>
          New terminal
        </Button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {panes.map((pane) => (
        <Pane
          key={pane.key}
          paneKey={pane.key}
          active={pane.key === activeKey}
          onSession={registerSession}
        />
      ))}
    </div>
  );
}

/** One terminal: its emulator, its backend session, and the wiring between them. */
function Pane({
  paneKey,
  active,
  onSession,
}: {
  paneKey: string;
  active: boolean;
  onSession: (key: string, id: SessionId) => void;
}) {
  const handle = useRef<TerminalHandle>(null);
  const sessionId = useRef<SessionId | null>(null);
  const opening = useRef(false);
  const setTitle = useTerminalStore((s) => s.setTitle);
  const closePane = useTerminalStore((s) => s.closePane);

  // The session is opened from the FIRST measurement, never before it: the shell must be told the
  // real geometry at spawn time, or its first prompt is drawn for a window that does not exist.
  const onResize = useCallback(
    (rows: number, cols: number) => {
      const id = sessionId.current;
      if (id !== null) {
        void terminalApi.resize(id, rows, cols);
        return;
      }
      if (opening.current) return;
      opening.current = true;

      void terminalApi
        .open({
          rows,
          cols,
          onOutput: (bytes) => handle.current?.write(bytes),
        })
        .then((id) => {
          sessionId.current = id;
          onSession(paneKey, id);
          setTitle(paneKey, `Terminal ${id + 1}`);
          handle.current?.focus();
        })
        .catch((error: unknown) => {
          // Surfaced where the user is looking, not just in the log. The pane stays open so the
          // message can be read (rule:logging — never swallowed, always surfaced).
          opening.current = false;
          handle.current?.write(notice(`could not start a terminal: ${String(error)}`));
        });
    },
    [onSession, paneKey, setTitle],
  );

  const onData = useCallback((data: string) => {
    const id = sessionId.current;
    if (id === null) return;
    void terminalApi.write(id, data);
  }, []);

  const onLink = useCallback((url: string) => {
    void api.openExternal(url);
  }, []);

  // Becoming visible changes the pane's size from 0×0, so it must re-measure — and take the caret,
  // because a terminal you switched to that does not accept typing is broken.
  useEffect(() => {
    if (!active) return;
    handle.current?.fit();
    handle.current?.focus();
  }, [active]);

  // Closing the tab ends the session. Without this the shell would keep running with nobody reading
  // it — and on the next launch the user would find a process they cannot see.
  useEffect(
    () => () => {
      const id = sessionId.current;
      if (id !== null) void terminalApi.close(id);
    },
    [],
  );

  return (
    <div
      className={active ? "absolute inset-0 p-2" : "hidden"}
      role="tabpanel"
      id={`terminal-panel-${paneKey}`}
      aria-label="Terminal"
    >
      <ContextMenu
        label="Terminal actions"
        items={[
          {
            id: "paste",
            label: "Paste",
            onSelect: () => {
              void navigator.clipboard.readText().then((text) => {
                const id = sessionId.current;
                if (id !== null && text) void terminalApi.write(id, text);
              });
            },
          },
          { separator: true },
          {
            id: "close",
            label: "Close terminal",
            accent: "danger",
            onSelect: () => closePane(paneKey),
          },
        ]}
      >
        <div className="h-full w-full">
          <TerminalSurface ref={handle} onData={onData} onResize={onResize} onLink={onLink} />
        </div>
      </ContextMenu>
    </div>
  );
}
