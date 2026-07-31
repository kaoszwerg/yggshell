import { useState } from "react";
import { BuildIdentity } from "../components/BuildIdentity";
import { Button } from "../components/ui/Button";
import { HudPanel } from "../components/ui/HudPanel";
import { TextField } from "../components/ui/TextField";
import { Tabs } from "../components/ui/Tabs";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "../lib/app";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import type { TmuxMode } from "../bindings/TmuxMode";

const UI_SCALES = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5] as const;
const TERMINAL_FONT_SIZES = [11, 12, 13, 14, 16, 18, 20] as const;

/** Three states, because "join one if it is running" and "always have one" are different wishes. */
const TMUX_MODES: { id: TmuxMode; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Start the shell directly." },
  {
    id: "attach",
    label: "Attach if running",
    hint: "Join an existing session; start a plain shell when there is none.",
  },
  {
    id: "attach-or-create",
    label: "Attach or create",
    hint: "Always end up in a session, creating it the first time.",
  },
];

/**
 * The sections, in the order they are read down the left-hand side.
 *
 * Grouped by *area* rather than by widget, because this list is going to grow: iTerm2 themes, the
 * theme editor and per-terminal configuration all land here. One scrolling page would have made each
 * of those a worse neighbour than the last.
 */
const SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "terminal", label: "Terminal" },
  { id: "window", label: "Window" },
  { id: "about", label: "About" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const panelId = (id: string) => `settings-panel-${id}`;

/** Settings, grouped into sections with the section list down the left (WAI-ARIA vertical tabs). */
export function SettingsView() {
  const [section, setSection] = useState<SectionId>("appearance");
  const current = SECTIONS.find((s) => s.id === section);

  return (
    <div className="flex h-full">
      <Tabs
        label="Settings sections"
        orientation="vertical"
        items={SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
        activeId={section}
        onSelect={(id) => setSection(id as SectionId)}
        getPanelId={panelId}
        className="hud-strip w-44 shrink-0 p-2"
      />

      <div
        role="tabpanel"
        id={panelId(section)}
        aria-label={current?.label ?? "Settings"}
        className="h-full flex-1 overflow-auto p-6"
      >
        {section === "appearance" ? <AppearanceSection /> : null}
        {section === "terminal" ? <TerminalSection /> : null}
        {section === "window" ? <WindowSection /> : null}
        {section === "about" ? <AboutSection /> : null}
      </div>
    </div>
  );
}

function AppearanceSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const scale = settings.data?.ui_scale ?? 1;

  return (
    <HudPanel
      accent="cyan"
      label="Appearance"
      info={
        <p>
          The UI scale sizes the chrome — rail, tabs, panels. Terminal text has its own size, under
          Terminal, so the two can be set independently.
        </p>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">UI scale</span>
        <div className="flex flex-wrap gap-1">
          {UI_SCALES.map((s) => (
            <Button
              key={s}
              aria-pressed={Math.abs(scale - s) < 0.001}
              active={Math.abs(scale - s) < 0.001}
              onClick={() => update.mutate({ uiScale: s })}
              className="px-3 py-1 text-xs"
            >
              {Math.round(s * 100)}%
            </Button>
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

function TerminalSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const size = settings.data?.terminal_font_size ?? 13;

  return (
    <HudPanel
      accent="cyan"
      label="Terminal"
      info={
        <p>
          Terminal text size is independent of the UI scale: the emulator is handed a size divided
          by the WebView zoom, so changing one never drags the other along.
        </p>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">Text size</span>
        <div className="flex flex-wrap gap-1">
          {TERMINAL_FONT_SIZES.map((s) => (
            <Button
              key={s}
              aria-pressed={Math.abs(size - s) < 0.001}
              active={Math.abs(size - s) < 0.001}
              onClick={() => update.mutate({ terminalFontSize: s })}
              className="px-3 py-1 text-xs"
            >
              {s}px
            </Button>
          ))}
        </div>
        <span className="text-dim text-xs">
          How much output fits on screen. The UI scale under Appearance sizes the chrome around it.
        </span>
      </div>

      <div className="bg-cyan/15 my-4 h-px" aria-hidden />

      <TmuxControls />
    </HudPanel>
  );
}

/** tmux: whether a terminal joins a session, and which one. */
function TmuxControls() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const mode: TmuxMode = settings.data?.tmux_mode ?? "off";
  const session = settings.data?.tmux_session ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? session;

  const commit = () => {
    if (draft === null || draft === session) return;
    update.mutate({ tmuxSession: draft });
    setDraft(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">tmux</span>
        <div className="flex flex-wrap gap-1">
          {TMUX_MODES.map((m) => (
            <Button
              key={m.id}
              aria-pressed={mode === m.id}
              active={mode === m.id}
              onClick={() => update.mutate({ tmuxMode: m.id })}
              className="px-3 py-1 text-xs"
            >
              {m.label}
            </Button>
          ))}
        </div>
        <span className="text-dim text-xs">
          {TMUX_MODES.find((m) => m.id === mode)?.hint} Closing a tab or the app{" "}
          <strong className="text-fg">detaches</strong> — a session is never killed from here.
        </span>
      </div>

      {mode === "off" ? null : (
        <div className="flex flex-col gap-1.5">
          <label className="text-dim text-xs" htmlFor="tmux-session">
            Session name
          </label>
          <TextField
            id="tmux-session"
            value={value}
            placeholder={mode === "attach" ? "any running session" : "yggshell"}
            className="max-w-xs font-mono"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setDraft(null);
            }}
          />
          <span className="text-dim text-xs">
            Left empty, &ldquo;attach&rdquo; joins whatever is running and &ldquo;attach or
            create&rdquo; uses <code>yggshell</code>. A name cannot contain <code>:</code> or{" "}
            <code>.</code> — tmux reads those as a window or pane.
          </span>
        </div>
      )}
    </div>
  );
}

function WindowSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const minimizeToTray = settings.data?.minimize_to_tray ?? false;

  return (
    <HudPanel accent="cyan" label="Window">
      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">Close button</span>
        <div className="flex flex-wrap gap-1">
          <Button
            aria-pressed={!minimizeToTray}
            active={!minimizeToTray}
            onClick={() => update.mutate({ minimizeToTray: false })}
            className="px-3 py-1 text-xs"
          >
            Quit app
          </Button>
          <Button
            aria-pressed={minimizeToTray}
            active={minimizeToTray}
            onClick={() => update.mutate({ minimizeToTray: true })}
            className="px-3 py-1 text-xs"
          >
            Minimize to tray
          </Button>
        </div>
        <span className="text-dim text-xs">
          What the window&apos;s close button does. &ldquo;Minimize to tray&rdquo; keeps the app
          running in the system tray with an Open/Quit menu.
        </span>
      </div>
    </HudPanel>
  );
}

/** What the old Home view was actually good for: saying which build this is. */
function AboutSection() {
  return (
    <HudPanel accent="green" label="About">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2
            className="hud-label text-glow-cyan"
            style={{ "--hud-label-size": "1rem" } as React.CSSProperties}
          >
            {APP_NAME}
          </h2>
          <p className="text-green font-mono text-xs tracking-wide">{APP_TAGLINE}</p>
        </div>
        <p className="text-dim max-w-2xl text-sm leading-relaxed">{APP_DESCRIPTION}</p>
        <BuildIdentity className="border-elevated max-w-md border-t pt-3" />
      </div>
    </HudPanel>
  );
}
