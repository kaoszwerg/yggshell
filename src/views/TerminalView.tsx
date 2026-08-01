import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, TerminalSquare, X } from "lucide-react";
import { api } from "../api/commands";
import { terminalApi, type SessionId } from "../api/terminal";
import { GitDetailPanel } from "../components/tools/GitDetailPanel";
import { ActivityLine } from "../components/ui/ActivityLine";
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
import { BUILTIN_THEME_ID, resolveTheme, themeById } from "../lib/terminalTheme";
import type { Activity, ActivityState } from "../lib/osc133";
import { useT } from "../hooks/useT";
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

/** How long the activity line holds the result of a command before settling back to rest. */
const RESULT_MS = 1600;

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
  const t = useT();
  const panes = useTerminalStore((s) => s.panes);
  const activeKey = useTerminalStore((s) => s.activeKey);
  const openPane = useTerminalStore((s) => s.openPane);
  const bootstrap = useTerminalStore((s) => s.bootstrap);
  const closePane = useTerminalStore((s) => s.closePane);
  const detachToShell = useTerminalStore((s) => s.detachToShell);

  /** Backend session id per pane, learned once the PTY is actually open. */
  const sessions = useRef(new Map<string, SessionId>());

  const setPaneSession = useTerminalStore((s) => s.setPaneSession);

  const registerSession = useCallback(
    (key: string, id: SessionId) => {
      sessions.current.set(key, id);
      // Mirrored into the store as well, because the sidebar tools ask "what is this tab running"
      // from outside this view entirely, and a ref in a component is not reachable from there.
      setPaneSession(key, id);
    },
    [setPaneSession],
  );

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
          // The store has to forget it too, or a tool reading "what is this tab running" would keep
          // asking the backend about a session that has ended.
          setPaneSession(key, null);
          // Detaching from tmux is not the end of anything: the session keeps running, and the user
          // asked to be back in a terminal. Closing the tab took the window away instead — the one
          // thing they had not asked for. A tmux client that ended cleanly puts a plain shell in the
          // same tab; a shell that exited, or a client that died, closes it as before.
          if (exit.tmux_client && (exit.code ?? 0) === 0) {
            detachToShell(key);
            return;
          }
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
  }, [closePane, detachToShell, setPaneSession]);

  if (panes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <TerminalSquare className="text-cyan/40" size={48} strokeWidth={1.25} aria-hidden />
        <p className="text-dim font-mono text-sm">{t("terminal.none")}</p>
        <Button accent="green" onClick={() => openPane()}>
          {t("terminal.newTab")}
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
          restoredCwd={pane.cwd}
          plain={pane.plain}
          generation={pane.generation}
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
  restoredCwd,
  plain,
  generation,
  active,
  onSession,
}: {
  paneKey: string;
  /** Fixed for this pane's life — it decided which shell is running (see the store). */
  profileId: string | null;
  /** This tab's own colour scheme, if the user gave it one. Changeable at any time. */
  themeId: string | null;
  /**
   * Where this tab was when the app last closed, or `null` for a tab opened in this run.
   *
   * Read once, at mount: the store's `cwd` is overwritten the moment the shell reports where it is,
   * so anything read later is the CURRENT directory rather than the restored one.
   */
  restoredCwd: string | null;
  /** Ignore the tmux setting for this tab — set once the user has detached out of it. */
  plain: boolean;
  /** Bumped to ask for a fresh session in this same tab. */
  generation: number;
  active: boolean;
  onSession: (key: string, id: SessionId) => void;
}) {
  const handle = useRef<TerminalHandle>(null);
  const sessionId = useRef<SessionId | null>(null);
  const opening = useRef(false);
  /** Geometry measured while the open call was still in flight. Applied the moment it lands. */
  const pending = useRef<{ rows: number; cols: number } | null>(null);
  /** The last geometry this pane reported, so a new session can be started without waiting for the
   *  emulator to be resized into reporting one again. */
  const lastGeometry = useRef<{ rows: number; cols: number } | null>(null);
  /**
   * The directory this tab had when the app last closed, used once.
   *
   * Captured at mount rather than read live: `cwd` is updated by the shell the moment it reports where
   * it is, so by the time a second session opened in this tab it would no longer be the restored
   * value — and a tab that detached out of tmux would jump back to where it started.
   */
  const restoreCwd = useRef<string | null>(restoredCwd);
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
  const t = useT();
  /**
   * What this terminal is doing, for the line along its top edge.
   *
   * Per pane, like everything else about a tab: two terminals run different things, and one indicator
   * for the window would be telling you about whichever tab happened to report last.
   */
  const activity = useTerminalStore(
    (s) => s.panes.find((p) => p.key === paneKey)?.activity ?? "idle",
  );
  const setPaneActivity = useTerminalStore((s) => s.setPaneActivity);
  // Kept in a ref as well so the callbacks below do not have to be rebuilt — and re-subscribe the
  // emulator — every time the state changes, which is several times a second while a command runs.
  const setActivity = useCallback(
    (next: ActivityState, command: string | null = null) => setPaneActivity(paneKey, next, command),
    [paneKey, setPaneActivity],
  );
  /** Clears a held result. Held here rather than in the line, so the primitive stays a primitive. */
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [schemeOpen, setSchemeOpen] = useState(false);
  const setTitle = useTerminalStore((s) => s.setTitle);
  const setCwd = useTerminalStore((s) => s.setCwd);
  const setPaneTmuxSession = useTerminalStore((s) => s.setPaneTmuxSession);
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

      lastGeometry.current = { rows, cols };
      terminalApi
        .open({
          rows,
          cols,
          // Where this tab was when the app last closed. A directory that has since gone is not an
          // error: the backend logs it and the shell starts where it otherwise would have.
          cwd: restoreCwd.current ?? undefined,
          profile: profileId,
          plain,
          onOutput: (bytes) => handle.current?.write(bytes),
        })
        .then((opened) => {
          const id = opened.id;
          sessionId.current = id;
          setSessionOpen(true);
          onSession(paneKey, id);
          setTitle(paneKey, `Terminal ${id + 1}`);
          // Recorded so a restart can return this tab to the same tmux session — the one kind of
          // session that genuinely survives us.
          setPaneTmuxSession(paneKey, opened.tmux_session);
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
    [onSession, paneKey, plain, profileId, setPaneTmuxSession, setTitle],
  );

  // Only the FIRST session of a tab starts in the restored directory; after that the shell decides.
  //
  // Guarded on `sessionOpen` being TRUE rather than just running on its change: an effect runs on
  // mount too, and clearing it there threw the restored directory away before anything could use it.
  useEffect(() => {
    if (sessionOpen) restoreCwd.current = null;
  }, [sessionOpen]);

  // A bumped generation means "this tab wants a new session" — today, that the user detached out of
  // tmux. The emulator, the scrollback and the tab all stay; only the process behind them is new.
  const started = useRef(generation);
  useEffect(() => {
    if (started.current === generation) return;
    started.current = generation;
    sessionId.current = null;
    opening.current = false;
    setSessionOpen(false);
    const geometry = lastGeometry.current;
    if (geometry) onResize(geometry.rows, geometry.cols);
  }, [generation, onResize]);

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

  // Straight from the shell (OSC 133) when there is no tmux in the way — instant, and with the exit
  // status the tmux poll cannot provide.
  //
  // The result is HELD for a moment and then cleared: a command's outcome is announced once, and a
  // state that never settles stops being a signal. Driven from the event rather than from an effect,
  // because that is what it is.
  const onActivity = useCallback(
    (next: Activity) => {
      if (activityTimer.current !== null) clearTimeout(activityTimer.current);
      if (next.state === "running") {
        setActivity("running");
        return;
      }
      // An unknown exit status counts as success: it is what a shell that says nothing means, and
      // colouring silence red would cry wolf on every less talkative shell.
      setActivity(next.exit === null || next.exit === 0 ? "ok" : "failed");
      activityTimer.current = setTimeout(() => setActivity("idle"), RESULT_MS);
    },
    [setActivity],
  );

  useEffect(
    () => () => {
      if (activityTimer.current !== null) clearTimeout(activityTimer.current);
    },
    [],
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
        .status(id)
        .then((status) => {
          if (stopped) return;
          if (status.cwd !== null) setCwd(paneKey, status.cwd);
          // Also when WE did not start it: somebody who typed `tmux` in the shell is in a session
          // the app was never told about, and the status bar showed nothing for them.
          setPaneTmuxSession(paneKey, status.session);
          // Inside tmux this poll is the only source of activity: OSC 133 is swallowed there, so
          // there is no exit status to be had — only whether something is running.
          if (status.command !== null) {
            // In tmux this is also the only place the command's NAME can come from — OSC 133 never
            // carries one — which is why the status bar can say "cargo" here and only "running"
            // outside a session.
            setActivity(status.busy ? "running" : "idle", status.busy ? status.command : null);
          }
        })
        .catch(survivable("read the session status"));
    };
    ask();
    const timer = setInterval(ask, CWD_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, sessionOpen, paneKey, setCwd, setActivity, setPaneTmuxSession]);

  // The search shortcut is matched centrally (`useShortcuts`) and arrives here as an event, because
  // the KEY is configurable and having two places decide what "find" means is how they drift apart.
  // Only the visible pane listens, so several open terminals do not fight over it.
  useEffect(() => {
    if (!active) return;
    const onFind = () => setSearchOpen(true);
    window.addEventListener("yggshell:find", onFind);
    return () => window.removeEventListener("yggshell:find", onFind);
  }, [active]);

  // The title bar pastes into a terminal it does not render — a middle-click on a tab lands here.
  // Registered as a paste TARGET rather than exposing the whole handle: nobody outside needs the
  // rest of it.
  useEffect(() => {
    registerPasteTarget(paneKey, {
      paste: (text: string) => handle.current?.paste(text),
      // Ctrl+L, straight to the shell: it redraws its prompt, exactly as if the key had been
      // pressed. Not a `clear` command — the interface does not choose what runs (ADR-PROJ-001 §5).
      clear: () => onData("\x0c"),
    });
    return () => registerPasteTarget(paneKey, undefined);
  }, [paneKey, onData]);

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
      // The scheme's background covers the WHOLE pane, padding included.
      //
      // xterm paints its own background behind the character grid and nothing beyond it, so the
      // padding — and the strip of leftover pixels that is narrower than one cell — showed the app's
      // grid instead. The terminal then looked like a rectangle floating on a different surface
      // rather than like the surface itself. Painting it here makes the inset read as a margin
      // INSIDE the terminal, which is what it was always meant to be.
      style={{ backgroundColor: resolveTheme(theme).background }}
      role="tabpanel"
      id={`terminal-panel-${paneKey}`}
      aria-label={t("nav.terminal")}
    >
      {/* Edge to edge across the terminal area, and no further: the rail and the tool column are not
          part of what is running, and a line sweeping across them would be claiming otherwise.
          `inset-x-0` rather than matching the pane's padding — this is the boundary of the terminal
          area, so it runs the full width of it and stops exactly where that area does. */}
      <ActivityLine state={activity} className="absolute inset-x-0 top-0 z-10" />

      <ContextMenu
        label={t("terminal.actions")}
        items={[
          {
            id: "copy",
            label: t("terminal.copy"),
            shortcut: KEYS.copy,
            disabled: !hasSelection,
            onSelect: () => {
              // The clipboard can refuse — permissions, an empty selection, a webview without focus.
              navigator.clipboard.writeText(readPrimarySelection()).catch(survivable("copy"));
            },
          },
          {
            id: "paste",
            label: t("terminal.paste"),
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
          { id: "find", label: t("terminal.find"), shortcut: KEYS.find, onSelect: openSearch },
          {
            id: "scheme",
            label: t("terminal.schemeMenu"),
            // A picker rather than a submenu of every scheme: the list grows with each import, and a
            // context menu forty entries long is a list you scroll past, not a menu.
            onSelect: () => setSchemeOpen(true),
          },
          { separator: true },
          {
            id: "close",
            label: t("terminal.closeTab"),
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
            onActivity={onActivity}
            fontSize={fontSize}
            theme={theme}
            copyOnSelect={settings.data?.copy_on_select ?? false}
            fontFamily={settings.data?.terminal_font ?? ""}
          />
        </div>
      </ContextMenu>

      {/* Inside the pane, so it covers THIS terminal and travels with the tab: two tabs are two
          repositories as often as not, and a panel belonging to the window meant opening a diff in
          one tab and finding it over another. */}
      <GitDetailPanel paneKey={paneKey} />

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
  const t = useT();
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
      aria-label={t("terminal.schemeFor")}
      className="hud-popover hud-clip-sm hud-accent-cyan absolute top-4 right-6 z-20 flex max-h-[70%] flex-col gap-1 overflow-y-auto p-2"
    >
      <span className="text-dim px-1 font-mono text-[0.6rem] tracking-[0.12em]">
        {t("scheme.thisTerminal")}
      </span>
      <Button
        ref={first}
        aria-pressed={current === null}
        active={current === null}
        className="justify-start"
        onClick={() => choose(null)}
      >
        {t("scheme.followSettings")}
      </Button>
      {/* The built-in scheme, choosable in its own right. Not the same as the entry above: this tab
          then stays on Yggdrasil whatever the setting is later changed to. */}
      <Button
        aria-pressed={current === BUILTIN_THEME_ID}
        active={current === BUILTIN_THEME_ID}
        className="justify-start"
        onClick={() => choose(BUILTIN_THEME_ID)}
      >
        Yggdrasil
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
  const t = useT();
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
      aria-label={t("terminal.searchThe")}
      className="hud-popover hud-clip-sm hud-accent-cyan absolute top-4 right-6 z-20 flex items-center gap-1 p-1"
    >
      <TextField
        ref={inputRef}
        value={query}
        aria-label={t("terminal.searchThe")}
        placeholder={t("terminal.findPlaceholder")}
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
      <IconButton
        label={t("terminal.searchPrevious")}
        variant="ghost"
        onClick={() => step("previous")}
      >
        <ChevronUp size={14} strokeWidth={2.5} />
      </IconButton>
      <IconButton label={t("terminal.searchNext")} variant="ghost" onClick={() => step("next")}>
        <ChevronDown size={14} strokeWidth={2.5} />
      </IconButton>
      <IconButton
        label={t("terminal.closeSearch")}
        variant="ghost"
        accent="danger"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2.5} />
      </IconButton>
    </div>
  );
}
