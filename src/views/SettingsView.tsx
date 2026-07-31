import { useMemo, useState } from "react";
import { BuildIdentity } from "../components/BuildIdentity";
import { ProfileControls } from "../components/settings/ProfileControls";
import { ThemeControls } from "../components/settings/ThemeControls";
import { Button } from "../components/ui/Button";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { HudPanel } from "../components/ui/HudPanel";
import { TextField } from "../components/ui/TextField";
import { Tabs } from "../components/ui/Tabs";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "../lib/app";
import { availableFonts } from "../lib/fonts";
import { labelShells } from "../lib/shellLabels";
import { useSettings, useShells, useUpdateSettings } from "../hooks/useSettings";
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
  const copyOnSelect = settings.data?.copy_on_select ?? false;
  const autoFetch = settings.data?.git_auto_fetch ?? true;

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
      <ShellControls />

      <div className="bg-cyan/15 my-4 h-px" aria-hidden />

      <FontChoice />

      <div className="bg-cyan/15 my-4 h-px" aria-hidden />

      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">Git remote</span>
        <div className="flex flex-wrap gap-1">
          <Button
            aria-pressed={autoFetch}
            active={autoFetch}
            onClick={() => update.mutate({ gitAutoFetch: true })}
          >
            Check the remote
          </Button>
          <Button
            aria-pressed={!autoFetch}
            active={!autoFetch}
            onClick={() => update.mutate({ gitAutoFetch: false })}
          >
            Stay offline
          </Button>
        </div>
        <span className="text-dim text-xs">
          The ahead/behind counts come from what was last fetched, so without this they go quietly
          wrong — not <em>unknown</em>, but <strong className="text-fg">↓0</strong> while the remote
          has moved on. This is the only outbound connection the app makes (ADR-PROJ-002): a{" "}
          <code>git fetch</code> every five minutes while the Git tool is open, never interactive,
          and it cannot touch your working tree.
        </span>
      </div>

      <div className="bg-cyan/15 my-4 h-px" aria-hidden />

      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">Selecting text</span>
        <div className="flex flex-wrap gap-1">
          <Button
            aria-pressed={!copyOnSelect}
            active={!copyOnSelect}
            onClick={() => update.mutate({ copyOnSelect: false })}
          >
            Select only
          </Button>
          <Button
            aria-pressed={copyOnSelect}
            active={copyOnSelect}
            onClick={() => update.mutate({ copyOnSelect: true })}
          >
            Copy to clipboard
          </Button>
        </div>
        <span className="text-dim text-xs">
          Off by default because it replaces whatever you had copied, without saying so. A
          middle-click always pastes the last selection either way, as on X11.
        </span>
      </div>

      <div className="bg-cyan/15 my-4 h-px" aria-hidden />

      <ThemeControls />

      <div className="bg-cyan/15 my-4 h-px" aria-hidden />

      <ProfileControls />

      <div className="bg-cyan/15 my-4 h-px" aria-hidden />

      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">Text size</span>
        <div className="flex flex-wrap gap-1">
          {TERMINAL_FONT_SIZES.map((s) => (
            <Button
              key={s}
              aria-pressed={Math.abs(size - s) < 0.001}
              active={Math.abs(size - s) < 0.001}
              onClick={() => update.mutate({ terminalFontSize: s })}
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

/**
 * Which font the terminal renders in.
 *
 * The list is what this machine turned out to have, measured rather than enumerated — a WebView cannot
 * ask for a font list, so each candidate is probed by rendering it and comparing widths against the
 * fallbacks (`lib/fonts`). Anything not detected can still be typed: the list is a convenience, not a
 * gate.
 *
 * Every row previews itself in its own font, which is the whole point. Choosing a typeface from names
 * set in a different typeface is choosing blind — and the specific thing people are looking for here
 * is whether the Powerline glyphs are there at all.
 */
function FontChoice() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const chosen = settings.data?.terminal_font ?? "";
  // Probed once: fonts are not installed while a settings page is open, and each probe measures text
  // on a canvas.
  const options = useMemo(
    () =>
      availableFonts().map((family) => ({
        value: family,
        label: family,
        preview: { fontFamily: `"${family}", monospace` },
      })),
    [],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-dim text-xs">Font</span>
      <div className="flex flex-wrap items-start gap-2">
        <SearchableSelect
          label="Terminal font"
          value={chosen}
          options={options}
          placeholder="MesloLGS NF"
          emptyHint="Not found on this machine — it will be used anyway if you have it."
          className="max-w-xs flex-1"
          onChange={(family) => update.mutate({ terminalFont: family })}
        />
        {chosen === "" ? null : (
          <Button onClick={() => update.mutate({ terminalFont: "" })}>Default</Button>
        )}
      </div>
      {/* The sample is the answer to the question people actually have: are the Powerline glyphs
          there? A name in a list cannot tell you that. */}
      <div
        className="hud-clip-sm bg-elevated text-fg overflow-x-auto px-2 py-1 text-xs whitespace-pre"
        style={{ fontFamily: chosen === "" ? undefined : `"${chosen}", monospace` }}
        aria-label="Font preview"
      >
        {"\ue0b0 \ue0b2 \uf07b \uf126  ~/git-projects  0O1lI| {} => != ->"}
      </div>
      <span className="text-dim text-xs">
        <strong className="text-fg">MesloLGS NF</strong> ships with the app — it is the font
        powerlevel10k recommends, so a Powerline prompt works without installing anything. A font
        this list does not show can still be typed in: a WebView cannot enumerate what is installed,
        so the list is what could be detected rather than everything you have.
      </span>
    </div>
  );
}

/**
 * Which shell a new terminal starts.
 *
 * A list, never a text field. The backend produces what this machine offers and refuses anything
 * else, which is what keeps this setting from becoming a way to name an arbitrary program for the
 * terminal to run (ADR-PROJ-001 §5, `terminal::shells`).
 */
function ShellControls() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const shells = useShells();
  const chosen = settings.data?.terminal_shell ?? "";
  const choices = labelShells(shells.data ?? []);
  const defaultShell = shells.data?.find((s) => s.is_default);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-dim text-xs">Shell</span>
      {shells.isPending ? (
        <span className="text-dim font-mono text-xs">Reading what this machine offers…</span>
      ) : shells.isError ? (
        <span className="text-danger font-mono text-xs">
          Could not read the available shells. New terminals still start your default shell.
        </span>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            <Button
              aria-pressed={chosen === ""}
              active={chosen === ""}
              onClick={() => update.mutate({ terminalShell: "" })}
            >
              System default
            </Button>
            {choices.map((choice) => (
              <Button
                key={choice.path}
                aria-pressed={chosen === choice.path}
                active={chosen === choice.path}
                onClick={() => update.mutate({ terminalShell: choice.path })}
              >
                {choice.label}
              </Button>
            ))}
          </div>
          <span className="text-dim text-xs">
            {chosen === "" ? (
              <>
                Your account&rsquo;s own shell
                {defaultShell ? (
                  <>
                    {" — "}
                    <code>{defaultShell.path}</code>
                  </>
                ) : null}
                . Takes effect for terminals opened from now on.
              </>
            ) : (
              <>
                <code>{chosen}</code>. Takes effect for terminals opened from now on; the ones
                already running keep the shell they started with.
              </>
            )}
          </span>
        </>
      )}
    </div>
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
          >
            Quit app
          </Button>
          <Button
            aria-pressed={minimizeToTray}
            active={minimizeToTray}
            onClick={() => update.mutate({ minimizeToTray: true })}
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
