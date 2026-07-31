import type { ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "../ui/IconButton";
import { ContextMenu } from "../ui/ContextMenu";
import { Tabs } from "../ui/Tabs";
import { useBuildInfo } from "../../hooks/useBuildInfo";
import { readPrimarySelection } from "../../lib/primarySelection";
import { pasteInto } from "../../lib/terminalHandles";
import { useTerminalProfiles } from "../../hooks/useSettings";
import { useTerminalStore } from "../../store/terminal";
import { useUiStore } from "../../store/ui";
import { APP_NAME, APP_TAGLINE } from "../../lib/app";
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
  const closePane = useTerminalStore((s) => s.closePane);
  const setView = useUiStore((s) => s.setView);

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
    pasteInto(key, readPrimarySelection());
  };

  return (
    <header
      data-tauri-drag-region
      className="hud-strip hud-accent-cyan flex h-10 shrink-0 items-center justify-between pr-3 pl-5"
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <img
          src={logoUrl}
          alt=""
          aria-hidden
          className="pointer-events-none h-7 w-7 shrink-0 select-none"
        />
        <span
          className="hud-label text-glow-cyan"
          style={
            {
              fontFamily: "Orbitron, sans-serif",
              "--hud-label-size": "0.8rem",
            } as React.CSSProperties
          }
        >
          {APP_NAME}
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
          // Right-click the strip to start a terminal from a profile. The `+` stays a one-click
          // "new terminal" with the Settings defaults, because that is what it is for and what it
          // does today; the menu is the way to reach a profile without turning the common case into
          // two clicks. Profiles are also listed in Settings, which is where they are discovered.
          <ContextMenu
            label="New terminal"
            items={[
              { id: "default", label: "New terminal", onSelect: () => show(openPane()) },
              ...(profiles.data ?? []).map((profile) => ({
                id: profile.id,
                label: profile.name,
                onSelect: () => show(openPane(profile.id)),
              })),
            ]}
          >
            <Tabs
              label="Terminals"
              items={panes.map((p) => ({ id: p.key, label: p.title }))}
              activeId={activeKey ?? ""}
              onSelect={show}
              onClose={closePane}
              onMiddleClick={pasteIntoTab}
              onAdd={() => show(openPane())}
              addLabel="New terminal"
              getPanelId={(key) => `terminal-panel-${key}`}
              className="max-w-[52vw]"
            />
          </ContextMenu>
        )}
        {build?.channel === "dev" ? (
          <span className="hud-clip-sm hud-accent-gold neon-glow-gold bg-elevated px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-[var(--saga-gold)] uppercase">
            Dev
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <WinButton label="Minimize" onClick={() => void getCurrentWindow().minimize()}>
          <Minus size={15} strokeWidth={2.5} />
        </WinButton>
        <WinButton label="Maximize" onClick={() => void getCurrentWindow().toggleMaximize()}>
          <Square size={13} strokeWidth={2.5} />
        </WinButton>
        <WinButton label="Close" danger onClick={() => void getCurrentWindow().close()}>
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
