import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, TerminalSquare, X } from "lucide-react";
import { api } from "../api/commands";
import { terminalApi, type SessionId } from "../api/terminal";
import { Button } from "../components/ui/Button";
import { ContextMenu } from "../components/ui/ContextMenu";
import { IconButton } from "../components/ui/IconButton";
import { TextField } from "../components/ui/TextField";
import {
  TerminalSurface,
  type SearchDirection,
  type TerminalHandle,
} from "../components/ui/TerminalSurface";
import { isMac } from "../lib/platform";
import { readPrimarySelection } from "../lib/primarySelection";
import { useTerminalStore } from "../store/terminal";

/** Written into the terminal itself when something goes wrong. A failure the user cannot see is a
 *  silent failure (rule:logging), and this is the one surface they are already looking at. */
const encoder = new TextEncoder();
const notice = (text: string) => encoder.encode(`\r\n\x1b[38;2;255;51;102m${text}\x1b[0m\r\n`);

/** Shown in the menu so the shortcut is discoverable rather than folklore. */
const KEYS = {
  copy: isMac() ? "⌘C" : "Ctrl+Shift+C",
  paste: isMac() ? "⌘V" : "Ctrl+Shift+V",
  find: isMac() ? "⌘F" : "Ctrl+Shift+F",
};

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
  const [hasSelection, setHasSelection] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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

  // The shell's own title (OSC 0/2) names the tab once it sets one — `cargo watch` is worth far more
  // on a tab than `Terminal 2`. Shells that never set a title keep the fallback.
  const onTitle = useCallback(
    (title: string) => {
      setTitle(paneKey, title);
    },
    [paneKey, setTitle],
  );

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    handle.current?.clearSearch();
    handle.current?.focus();
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
            id: "copy",
            label: "Copy",
            shortcut: KEYS.copy,
            disabled: !hasSelection,
            onSelect: () => {
              void navigator.clipboard.writeText(readPrimarySelection());
            },
          },
          {
            id: "paste",
            label: "Paste",
            shortcut: KEYS.paste,
            onSelect: () => {
              void navigator.clipboard.readText().then((text) => {
                // Through the emulator, so it is bracketed: a multi-line paste must not run line by
                // line the moment it arrives.
                if (text !== "") handle.current?.paste(text);
              });
            },
          },
          { separator: true },
          { id: "find", label: "Search…", shortcut: KEYS.find, onSelect: openSearch },
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
          <TerminalSurface
            ref={handle}
            onData={onData}
            onResize={onResize}
            onLink={onLink}
            onTitle={onTitle}
            onFind={openSearch}
            onSelectionChange={setHasSelection}
          />
        </div>
      </ContextMenu>

      {searchOpen ? <SearchBar handle={handle} onClose={closeSearch} /> : null}
    </div>
  );
}

/**
 * Search over the scrollback. The addon finds and highlights; everything the user touches here is a
 * HUD primitive (ADR-APP-026) — the bar itself is ours.
 */
function SearchBar({
  handle,
  onClose,
}: {
  handle: React.RefObject<TerminalHandle | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [missed, setMissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const step = useCallback(
    (direction: SearchDirection) => {
      if (query === "") return;
      // "Not found" is shown, never swallowed: a search that silently does nothing reads as a broken
      // search bar rather than as an empty result.
      setMissed(!(handle.current?.find(query, direction) ?? false));
    },
    [handle, query],
  );

  return (
    <div
      role="search"
      aria-label="Search the terminal"
      className="hud-popover hud-clip-sm hud-accent-cyan absolute top-4 right-6 z-20 flex items-center gap-1 p-1"
    >
      <TextField
        ref={inputRef}
        value={query}
        aria-label="Search the terminal"
        placeholder="Find…"
        className={`w-48 font-mono ${missed ? "text-danger" : ""}`.trim()}
        onChange={(e) => {
          setQuery(e.target.value);
          setMissed(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? "previous" : "next");
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <IconButton label="Previous match" variant="ghost" onClick={() => step("previous")}>
        <ChevronUp size={14} strokeWidth={2.5} />
      </IconButton>
      <IconButton label="Next match" variant="ghost" onClick={() => step("next")}>
        <ChevronDown size={14} strokeWidth={2.5} />
      </IconButton>
      <IconButton label="Close search" variant="ghost" accent="danger" onClick={onClose}>
        <X size={14} strokeWidth={2.5} />
      </IconButton>
    </div>
  );
}
