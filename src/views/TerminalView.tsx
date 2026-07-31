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
import { registerPasteTarget } from "../lib/terminalHandles";
import { useSettings, useTerminalProfiles, useTerminalThemes } from "../hooks/useSettings";
import { themeById } from "../lib/terminalTheme";
import { useTerminalStore } from "../store/terminal";

/**
 * A call to a session that may already be gone.
 *
 * Sessions end underneath pending calls all the time: the user typed `exit`, tmux detached, the shell
 * died, the tab was closed a keystroke ago. The backend answers `no terminal session N`, and an
 * unhandled rejection from that reaches the app's global handler — which turns an ordinary race into
 * a FATAL SCREEN over the whole interface. It did exactly that on a tmux detach.
 *
 * So every one of these is caught here and reported where it belongs: in the console, not across the
 * user's work. The pane is already being torn down by the exit event on its own.
 */
function survivable(what: string): (error: unknown) => void {
  return (error) => {
    console.warn(`terminal: ${what} failed —`, error);
  };
}

/** Written into the terminal itself when something goes wrong. A failure the user cannot see is a
 *  silent failure (rule:logging), and this is the one surface they are already looking at. */
const encoder = new TextEncoder();
const notice = (text: string) => encoder.encode(`\r\n\x1b[38;2;255;51;102m${text}\x1b[0m\r\n`);

/** How often the backend is asked where a tmux session is. Only the visible tab polls, and only
 *  inside tmux does the call do any work — outside it the answer is `null` and OSC 7 has already
 *  delivered the truth without waiting for a tick. */
const CWD_POLL_MS = 2000;

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

  // A session ends when its TAB goes away — never when its component unmounts.
  //
  // This used to hang off the pane's unmount cleanup, which sounds equivalent and is not: a component
  // unmounts for reasons that have nothing to do with the user closing anything. Navigating to
  // Settings unmounted this whole view and took every running shell with it — a build, an agent, an
  // ssh session, gone because somebody looked at a preferences page. React's StrictMode double-mount
  // is the same shape of hazard, waiting for the session to exist a moment earlier.
  //
  // The session belongs to the tab, so the tab list is what decides. Every route out — the ×, the
  // context menu, a shell that exited — removes the pane, and that is what closes the PTY.
  useEffect(() => {
    const alive = new Set(panes.map((pane) => pane.key));
    for (const [key, id] of sessions.current) {
      if (alive.has(key)) continue;
      sessions.current.delete(key);
      terminalApi.close(id).catch(survivable("close"));
    }
  }, [panes]);

  // One listener for the whole view rather than one per pane: a session that ends by itself closes
  // its tab, so `exit` behaves like clicking the ×.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    terminalApi
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
      })
      .catch(survivable("subscribe to session exits"));

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
          profileId={pane.profileId}
          themeId={pane.themeId}
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
  profileId,
  themeId,
  active,
  onSession,
}: {
  paneKey: string;
  /** Fixed for this pane's life — it decided which shell is running (see the store). */
  profileId: string | null;
  /** This tab's own colour scheme, if the user gave it one. Changeable at any time. */
  themeId: string | null;
  active: boolean;
  onSession: (key: string, id: SessionId) => void;
}) {
  const handle = useRef<TerminalHandle>(null);
  const sessionId = useRef<SessionId | null>(null);
  const opening = useRef(false);
  /** Geometry measured while the open call was still in flight. Applied the moment it lands. */
  const pending = useRef<{ rows: number; cols: number } | null>(null);
  const settings = useSettings();
  // UI scale and text size are separate questions: how big the chrome is, and how much output fits.
  // The WebView zoom multiplies EVERYTHING, so the emulator is handed a size divided by that zoom —
  // after which the two really are independent, which is the point of having both.
  const uiScale = settings.data?.ui_scale ?? 1;
  const fontSize = (settings.data?.terminal_font_size ?? 13) / (uiScale > 0 ? uiScale : 1);
  // A scheme the settings name but that no longer exists resolves to `null`, which is the HUD
  // palette — a deleted theme must not leave a terminal unstyled.
  const themes = useTerminalThemes();
  const profiles = useTerminalProfiles();
  // Most specific wins: this tab's own choice, then its profile's, then the Settings default.
  const profile = profiles.data?.find((p) => p.id === profileId);
  const theme = themeById(
    themes.data,
    themeId ?? profile?.theme ?? settings.data?.terminal_theme ?? "",
  );
  const [hasSelection, setHasSelection] = useState(false);
  // Flipped once the PTY exists. The working-directory poll below waits for it: mounting starts that
  // effect immediately, when `sessionId` is still null, so without this its first ask does nothing and
  // the Git tool sits blank for a whole tick before the first real answer.
  const [sessionOpen, setSessionOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [schemeOpen, setSchemeOpen] = useState(false);
  const setTitle = useTerminalStore((s) => s.setTitle);
  const setCwd = useTerminalStore((s) => s.setCwd);
  const closePane = useTerminalStore((s) => s.closePane);

  // The session is opened from the FIRST measurement, never before it: the shell must be told the
  // real geometry at spawn time, or its first prompt is drawn for a window that does not exist.
  //
  // A measurement that lands DURING the open must not be dropped either, and it does land: the
  // settings query resolves a moment after the terminal mounts, the font size changes with it, and
  // the pane re-measures. Losing that left the shell believing the window was wider than it is —
  // whereupon zsh's end-of-line mark, which is drawn as `%` + (COLUMNS-1) spaces + CR + erase-line,
  // wrapped onto a second line and the erase cleared the wrong one. The stray `%` on the first line
  // of a fresh terminal was that, and nothing to do with the shell integration.
  const onResize = useCallback(
    (rows: number, cols: number) => {
      const id = sessionId.current;
      if (id !== null) {
        terminalApi.resize(id, rows, cols).catch(survivable("resize"));
        return;
      }
      if (opening.current) {
        pending.current = { rows, cols };
        return;
      }
      opening.current = true;
      const spawnedAt = { rows, cols };

      terminalApi
        .open({
          rows,
          cols,
          profile: profileId,
          onOutput: (bytes) => handle.current?.write(bytes),
        })
        .then((id) => {
          sessionId.current = id;
          setSessionOpen(true);
          onSession(paneKey, id);
          setTitle(paneKey, `Terminal ${id + 1}`);
          handle.current?.focus();

          const latest = pending.current;
          pending.current = null;
          if (!latest || (latest.rows === spawnedAt.rows && latest.cols === spawnedAt.cols)) return;
          terminalApi.resize(id, latest.rows, latest.cols).catch(survivable("resize"));
        })
        .catch((error: unknown) => {
          // Surfaced where the user is looking, not just in the log. The pane stays open so the
          // message can be read (rule:logging — never swallowed, always surfaced).
          opening.current = false;
          pending.current = null;
          handle.current?.write(notice(`could not start a terminal: ${String(error)}`));
        });
    },
    [onSession, paneKey, profileId, setTitle],
  );

  const onData = useCallback((data: string) => {
    const id = sessionId.current;
    if (id === null) return;
    terminalApi.write(id, data).catch(survivable("write"));
  }, []);

  const onLink = useCallback((url: string) => {
    // A refused or malformed URL is the backend's to reject; it must not become a fatal screen.
    api.openExternal(url).catch(survivable("open link"));
  }, []);

  // The shell's own title (OSC 0/2) names the tab once it sets one — `cargo watch` is worth far more
  // on a tab than `Terminal 2`. Shells that never set a title keep the fallback.
  const onTitle = useCallback(
    (title: string) => {
      setTitle(paneKey, title);
    },
    [paneKey, setTitle],
  );

  // Where the shell says it is (OSC 7). The Git tool reads this, which is how it follows a `cd`.
  const onCwd = useCallback(
    (path: string) => {
      setCwd(paneKey, path);
    },
    [paneKey, setCwd],
  );

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    handle.current?.clearSearch();
    handle.current?.focus();
  }, []);

  // Inside tmux the shell never reports where it is — tmux eats OSC 7 — so the backend is asked
  // instead, and only for the tab in front. It answers `null` for an ordinary shell, where the hook
  // has already said so instantly and this poll costs nothing but the call.
  useEffect(() => {
    if (!active || !sessionOpen) return;
    let stopped = false;
    const ask = () => {
      const id = sessionId.current;
      if (id === null) return;
      terminalApi
        .cwd(id)
        .then((path) => {
          if (!stopped && path !== null) setCwd(paneKey, path);
        })
        .catch(survivable("read the working directory"));
    };
    ask();
    const timer = setInterval(ask, CWD_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, sessionOpen, paneKey, setCwd]);

  // ⌘F / Ctrl+Shift+F on the WINDOW, not on the emulator: xterm's key handler only fires while the
  // terminal holds focus, so binding it there made the search unreachable the moment the caret was
  // anywhere else. Only the visible pane listens, so several open terminals do not fight over it.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const modified = isMac()
        ? e.metaKey && !e.ctrlKey && !e.altKey
        : e.ctrlKey && e.shiftKey && !e.altKey;
      if (!modified || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  // The title bar pastes into a terminal it does not render — a middle-click on a tab lands here.
  // Registered as a paste TARGET rather than exposing the whole handle: nobody outside needs the
  // rest of it.
  useEffect(() => {
    registerPasteTarget(paneKey, {
      paste: (text: string) => handle.current?.paste(text),
    });
    return () => registerPasteTarget(paneKey, undefined);
  }, [paneKey]);

  // Becoming visible changes the pane's size from 0×0, so it must re-measure — and take the caret,
  // because a terminal you switched to that does not accept typing is broken.
  useEffect(() => {
    if (!active) return;
    handle.current?.fit();
    handle.current?.focus();
  }, [active]);

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
              // The clipboard can refuse — permissions, an empty selection, a webview without focus.
              navigator.clipboard.writeText(readPrimarySelection()).catch(survivable("copy"));
            },
          },
          {
            id: "paste",
            label: "Paste",
            shortcut: KEYS.paste,
            onSelect: () => {
              navigator.clipboard
                .readText()
                .then((text) => {
                  // Through the emulator, so it is bracketed: a multi-line paste must not run line by
                  // line the moment it arrives.
                  if (text !== "") handle.current?.paste(text);
                })
                .catch(survivable("paste"));
            },
          },
          { separator: true },
          { id: "find", label: "Search…", shortcut: KEYS.find, onSelect: openSearch },
          {
            id: "scheme",
            label: "Colour scheme…",
            // A picker rather than a submenu of every scheme: the list grows with each import, and a
            // context menu forty entries long is a list you scroll past, not a menu.
            onSelect: () => setSchemeOpen(true),
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
          <TerminalSurface
            ref={handle}
            onData={onData}
            onResize={onResize}
            onLink={onLink}
            onTitle={onTitle}
            onSelectionChange={setHasSelection}
            onCwd={onCwd}
            fontSize={fontSize}
            theme={theme}
          />
        </div>
      </ContextMenu>

      {searchOpen ? <SearchBar handle={handle} onClose={closeSearch} /> : null}
      {schemeOpen ? (
        <SchemePicker
          paneKey={paneKey}
          current={themeId}
          onClose={() => {
            setSchemeOpen(false);
            handle.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Choosing a colour scheme for one tab.
 *
 * This exists because a scheme is not like a shell. A shell is decided once, when the process starts,
 * and a tab cannot change its mind about it afterwards. A scheme is decided every frame — the
 * emulator is repainted live — so freezing it into the tab's profile made "give this tab a different
 * scheme" mean "open a different tab", which is not the same request.
 */
function SchemePicker({
  paneKey,
  current,
  onClose,
}: {
  paneKey: string;
  current: string | null;
  onClose: () => void;
}) {
  const themes = useTerminalThemes();
  const setPaneTheme = useTerminalStore((s) => s.setPaneTheme);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = (id: string | null) => {
    setPaneTheme(paneKey, id);
    onClose();
  };

  return (
    <div
      role="group"
      aria-label="Colour scheme for this terminal"
      className="hud-popover hud-clip-sm hud-accent-cyan absolute top-4 right-6 z-20 flex max-h-[70%] flex-col gap-1 overflow-y-auto p-2"
    >
      <span className="text-dim px-1 font-mono text-[0.6rem] tracking-[0.12em]">THIS TERMINAL</span>
      <Button
        ref={first}
        aria-pressed={current === null}
        active={current === null}
        className="justify-start"
        onClick={() => choose(null)}
      >
        Follow the settings
      </Button>
      {(themes.data ?? []).map((theme) => (
        <Button
          key={theme.id}
          aria-pressed={current === theme.id}
          active={current === theme.id}
          className="justify-start"
          onClick={() => choose(theme.id)}
        >
          {theme.name}
        </Button>
      ))}
      {(themes.data ?? []).length === 0 ? (
        <span className="text-dim/70 px-1 font-mono text-xs">
          No schemes imported yet — Settings → Terminal.
        </span>
      ) : null}
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
