import type { ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "../ui/IconButton";
import { ContextMenu } from "../ui/ContextMenu";
import { Tabs } from "../ui/Tabs";
import { useBuildInfo } from "../../hooks/useBuildInfo";
import { terminalApi } from "../../api/terminal";
import { pasteInto } from "../../lib/terminalHandles";
import { useTerminalProfiles, useTmuxSessions } from "../../hooks/useSettings";
import { useT } from "../../hooks/useT";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";
import { APP_NAME, APP_TAGLINE } from "../../lib/app";
import { smallCaps } from "../../lib/smallCaps";
import logoUrl from "../../../src-tauri/icons/icon.svg";

/** Frameless custom HUD title bar (ADR-APP-021). The bar is the drag region; the window controls sit in
 * a non-drag section. A DEV badge marks a development build (ADR-CORE-024).
 *
 * It also carries the **terminal tabs** (ADR-PROJ-001): the bar is 40px tall and its middle was empty,
 * so the tabs cost no extra height at all — and because this app draws its own window controls on
 * every OS, there is no platform chrome to build around. The tagline gives way once a tab exists;
 * screen space in a terminal belongs to the terminal. */
export function TitleBar() {
  const { data: build } = useBuildInfo();
  const panes = useTerminalStore((s) => s.panes);
  const activeKey = useTerminalStore((s) => s.activeKey);
  const setActive = useTerminalStore((s) => s.setActive);
  const openPane = useTerminalStore((s) => s.openPane);
  const profiles = useTerminalProfiles();
  const requestClosePane = useTerminalStore((s) => s.requestClosePane);
  const sessions = useTmuxSessions();
  // A session another tab is already showing is left out rather than disabled: attaching to it would
  // give a second view of the same window, not a second terminal, and the backend refuses it anyway
  // (`tmux::launch`). An entry that cannot do what it says is worse than no entry.
  const attachable = (sessions.data ?? [])
    .map((session) => session.name)
    .filter((name) => !panes.some((p) => p.tmuxSession === name));
  const setView = useUiStore((s) => s.setView);
  const t = useT();

  // Reaching for a tab is asking to see that terminal, wherever the user currently is.
  const show = (key: string) => {
    setActive(key);
    setView("terminal");
  };

  // Middle-click means paste, in a terminal and on its tab alike — never close. The tab is brought
  // to the front first: text arriving in a terminal the user cannot see is alarming, and a paste
  // they did not witness is a paste they will not trust.
  const pasteIntoTab = (key: string) => {
    show(key);
    // The clipboard, like the middle-click inside a terminal — one gesture, one source. It read an
    // emulated X11 PRIMARY selection before, on the two platforms that have never had one.
    void terminalApi
      .clipboardText()
      .then((text) => {
        if (text !== "") pasteInto(key, text);
      })
      .catch((error: unknown) => {
        console.error("could not read the clipboard", error);
      });
  };

  return (
    <header
      data-tauri-drag-region
      className="hud-strip hud-accent-cyan flex h-10 shrink-0 items-center justify-between pr-3 pl-5"
    >
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
        <img
          src={logoUrl}
          alt=""
          aria-hidden
          className="pointer-events-none h-7 w-7 shrink-0 select-none"
        />
        {/* Small caps, built by splitting rather than with `font-variant-caps`: that property needs
            the font to carry small-cap glyphs or the engine to synthesise them, and `hud-label`
            already uppercases the text, which would flatten the casing it reads. */}
        <span
          className="hud-label text-glow-cyan"
          style={
            {
              fontFamily: "Orbitron, sans-serif",
              "--hud-label-size": "0.8rem",
            } as React.CSSProperties
          }
          // The runs are decorative; a screen reader should hear the name, not four fragments.
          aria-label={APP_NAME}
        >
          {smallCaps(APP_NAME).map((run, at) => (
            <span key={at} aria-hidden style={run.full ? undefined : { fontSize: "0.78em" }}>
              {run.text}
            </span>
          ))}
        </span>
        <span aria-hidden className="bg-dim/40 mx-0.5 h-3.5 w-px shrink-0" />
        {panes.length === 0 ? (
          <span
            data-tauri-drag-region
            className="text-green font-mono text-[11px] tracking-wide whitespace-nowrap"
          >
            {APP_TAGLINE}
          </span>
        ) : (
          // Right-click the strip to start a terminal from a profile, or to ATTACH to a tmux session
          // that is still running. The `+` stays a one-click "new terminal" with the Settings
          // defaults, because that is what it is for; the menu is the way to reach a profile without
          // turning the common case into two clicks.
          //
          // **The session rows are what makes "new" mean new.** A new tab is now given a session
          // nobody is using, so pressing `+` can no longer drop you into yesterday's work by
          // accident — which means reaching that work has to be something you can ask for. This is
          // where you ask, and it is also the only way back into tmux after a detach.
          <ContextMenu
            label={t("titlebar.newTerminal")}
            onOpen={() => void sessions.refetch()}
            items={[
              { id: "default", label: t("titlebar.newTerminal"), onSelect: () => show(openPane()) },
              ...(profiles.data ?? []).map((profile) => ({
                id: profile.id,
                label: profile.name,
                onSelect: () => show(openPane(profile.id)),
              })),
              ...(attachable.length > 0 ? [{ separator: true as const }] : []),
              ...attachable.map((name) => ({
                id: `tmux:${name}`,
                label: t("titlebar.attachTo", { session: name }),
                onSelect: () => show(openPane(null, null, name)),
              })),
            ]}
          >
            {/* A DOM element, not `<Tabs>` directly: ContextMenu attaches its handler to whatever it
                is given, and a component that does not forward unknown props to a DOM node drops it
                without a word. That is exactly how this menu shipped doing nothing. */}
            <div className="flex min-w-0 flex-1">
              <Tabs
                label={t("titlebar.terminals")}
                items={panes.map((p) => ({
                  id: p.key,
                  label: p.title,
                  attention: p.bell ?? undefined,
                }))}
                activeId={activeKey ?? ""}
                onSelect={show}
                onClose={requestClosePane}
                onMiddleClick={pasteIntoTab}
                onAdd={() => show(openPane())}
                addLabel={t("titlebar.newTerminal")}
                scrollBackLabel={t("titlebar.scrollLeft")}
                scrollForwardLabel={t("titlebar.scrollRight")}
                getPanelId={(key) => `terminal-panel-${key}`}
                // The strip takes whatever is left between the app mark and the window buttons,
                // rather than stopping at a fixed fraction of the viewport: a 52vw cap left half the
                // title bar empty on a wide window while tabs were being cut off inside it.
                className="min-w-0 flex-1"
              />
            </div>
          </ContextMenu>
        )}
        {build?.channel === "dev" ? (
          <span className="hud-clip-sm hud-accent-gold neon-glow-gold bg-elevated px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-[var(--saga-gold)] uppercase">
            Dev
          </span>
        ) : null}
      </div>

      {/* A grab area that exists no matter how full the strip is.
          The tabs take every pixel they are offered, so on a window with many of them the only
          draggable place left was the app mark — about thirty pixels, at the far left, which is
          neither discoverable nor where anyone reaches. This is the same reservation a browser
          keeps to the right of its tabs. */}
      <div
        data-tauri-drag-region
        aria-hidden
        className="h-full w-8 shrink-0 cursor-grab active:cursor-grabbing"
      />

      <div className="flex items-center gap-1.5">
        <WinButton
          label={t("titlebar.minimize")}
          onClick={() => void getCurrentWindow().minimize()}
        >
          <Minus size={15} strokeWidth={2.5} />
        </WinButton>
        <WinButton
          label={t("titlebar.maximize")}
          onClick={() => void getCurrentWindow().toggleMaximize()}
        >
          <Square size={13} strokeWidth={2.5} />
        </WinButton>
        <WinButton
          label={t("titlebar.close")}
          danger
          onClick={() => void getCurrentWindow().close()}
        >
          <X size={16} strokeWidth={2.5} />
        </WinButton>
      </div>
    </header>
  );
}

/** A single window control (minimize / maximize / close), drawn as a HUD `IconButton` for every OS
 * (ADR-APP-021). No tooltip — the accessible label alone identifies it, matching the OS window buttons. */
function WinButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <IconButton
      label={label}
      accent={danger ? "danger" : "cyan"}
      tooltip={null}
      onClick={onClick}
      className="h-7 w-7"
    >
      {children}
    </IconButton>
  );
}
