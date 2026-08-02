import { useMemo, useState } from "react";
import { BuildIdentity } from "../components/BuildIdentity";
import { ProfileControls } from "../components/settings/ProfileControls";
import { CliInstaller } from "../components/settings/CliInstaller";
import { NotesSettings } from "../components/settings/NotesSettings";
import { Changelog } from "../components/settings/Changelog";
import { Credits } from "../components/settings/Credits";
import { MouseReference, ShortcutEditor } from "../components/settings/ShortcutEditor";
import { StatusBarEditor } from "../components/settings/StatusBarEditor";
import { ThemeControls } from "../components/settings/ThemeControls";
import { Button } from "../components/ui/Button";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { HudPanel } from "../components/ui/HudPanel";
import { TextField } from "../components/ui/TextField";
import { Tabs } from "../components/ui/Tabs";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "../lib/app";
import { smallCaps } from "../lib/smallCaps";
import logoUrl from "../../src-tauri/icons/icon.svg";
import { availableFonts, DEFAULT_FONT, FONT_SIZES } from "../lib/fonts";
import { labelShells } from "../lib/shellLabels";
import { useSettings, useShells, useUpdateSettings } from "../hooks/useSettings";
import { useFontSettled } from "../hooks/useFontSettled";
import { useLocale, useT } from "../hooks/useT";
import { useUiStore } from "../store/ui";
import { LOCALES, type MessageKey } from "../i18n";
import type { TmuxMode } from "../bindings/TmuxMode";

const UI_SCALES = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5] as const;

/** Three states, because "join one if it is running" and "always have one" are different wishes. */
const TMUX_MODES: { id: TmuxMode; label: MessageKey; hint: MessageKey }[] = [
  { id: "off", label: "settings.tmux.mode.off", hint: "settings.tmux.mode.off.hint" },
  { id: "attach", label: "settings.tmux.mode.attach", hint: "settings.tmux.mode.attach.hint" },
  {
    id: "attach-or-create",
    label: "settings.tmux.mode.attachOrCreate",
    hint: "settings.tmux.mode.attachOrCreate.hint",
  },
];

/**
 * The tabs, in the order they are read down the left-hand side.
 *
 * Grouped by *area* rather than by widget, because this list is going to grow: iTerm2 themes, the
 * theme editor and per-terminal configuration all land here. One scrolling page would have made each
 * of those a worse neighbour than the last.
 *
 * **A tab is not the unit of grouping — a panel is.** Each tab renders a column of headed
 * `HudPanel`s, because the Terminal tab had grown to seven blocks separated by nothing but hairlines:
 * a reader looking for one control had to parse all of them. Adding a setting means adding a panel
 * or extending one, never lengthening an unbroken page.
 */
const SECTIONS = [
  { id: "appearance", label: "settings.tab.appearance" },
  { id: "terminal", label: "settings.tab.terminal" },
  { id: "keyboard", label: "keys.title" },
  { id: "tools", label: "settings.tab.tools" },
  { id: "window", label: "settings.tab.window" },
  { id: "about", label: "settings.tab.about" },
] as const satisfies readonly { id: string; label: MessageKey }[];

type SectionId = (typeof SECTIONS)[number]["id"];

const panelId = (id: string) => `settings-panel-${id}`;

/** Settings, grouped into sections with the section list down the left (WAI-ARIA vertical tabs). */
export function SettingsView() {
  const [section, setSection] = useState<SectionId>("appearance");
  const t = useT();
  const current = SECTIONS.find((s) => s.id === section);

  return (
    <div className="flex h-full">
      <Tabs
        label={t("settings.sections")}
        orientation="vertical"
        items={SECTIONS.map((s) => ({ id: s.id, label: t(s.label) }))}
        activeId={section}
        onSelect={(id) => setSection(id as SectionId)}
        getPanelId={panelId}
        className="hud-strip w-44 shrink-0 p-2"
      />

      <div
        role="tabpanel"
        id={panelId(section)}
        aria-label={current ? t(current.label) : t("nav.settings")}
        className="h-full flex-1 overflow-auto p-6"
      >
        <div className="flex flex-col gap-4">
          {section === "appearance" ? <AppearanceSection /> : null}
          {section === "terminal" ? <TerminalSection /> : null}
          {section === "keyboard" ? <KeyboardSection /> : null}
          {section === "tools" ? <ToolsSection /> : null}
          {section === "window" ? <WindowSection /> : null}
          {section === "about" ? <AboutSection /> : null}
          {section === "about" ? <ChangelogPanel /> : null}
          {section === "about" ? <CreditsPanel /> : null}
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const t = useT();
  return (
    <>
      <InterfaceScale />
      <HudPanel
        accent="cyan"
        label={t("settings.language.title")}
        description={t("settings.language.description")}
      >
        <LanguageChoice />
      </HudPanel>
      <HudPanel
        accent="cyan"
        label={t("settings.statusbar.title")}
        description={t("settings.statusbar.description")}
        info={<p>{t("settings.statusbar.info")}</p>}
      >
        <StatusBarEditor />
      </HudPanel>
    </>
  );
}

/**
 * Which language the interface speaks.
 *
 * Each language is named in **itself** — "Deutsch", not "German". Someone who has landed in a
 * language they cannot read needs to find their way out, and a list written in the language they are
 * trying to leave is no help at all.
 */
function LanguageChoice() {
  const update = useUpdateSettings();
  const locale = useLocale();
  const setLocale = useUiStore((s) => s.setLocale);
  const t = useT();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-dim text-xs">{t("settings.language.title")}</span>
      <div className="flex flex-wrap gap-1">
        {LOCALES.map((l) => (
          <Button
            key={l.id}
            aria-pressed={locale === l.id}
            active={locale === l.id}
            onClick={() => {
              // Both, and in this order: the mirror so the interface changes under the click rather
              // than after a round trip, and the setting so it is still that language tomorrow.
              setLocale(l.id);
              update.mutate({ language: l.id });
            }}
          >
            {l.label}
          </Button>
        ))}
      </div>
      <span className="text-dim text-xs">{t("settings.language.hint")}</span>
    </div>
  );
}

/** How large the chrome is drawn. */
function InterfaceScale() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const scale = settings.data?.ui_scale ?? 1;
  const t = useT();

  return (
    <HudPanel
      accent="cyan"
      label={t("settings.interface.title")}
      description={t("settings.interface.description")}
      info={<p>{t("settings.interface.info")}</p>}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">{t("settings.interface.scale")}</span>
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

/**
 * Terminal settings, as a column of headed blocks.
 *
 * Ordered by how early you meet them: what runs (Shell), what it looks like (Font, Theme), how it
 * behaves (Selection), and the two things that are a step beyond ordinary use (tmux, Profiles).
 */
function TerminalSection() {
  const t = useT();
  return (
    <>
      <HudPanel
        accent="cyan"
        label={t("settings.shell.title")}
        description={t("settings.shell.description")}
      >
        <ShellControls />
      </HudPanel>

      <HudPanel
        accent="cyan"
        label={t("settings.font.title")}
        description={t("settings.font.description")}
        info={<p>{t("settings.font.info")}</p>}
      >
        <FontChoice />
        <div className="bg-cyan/15 my-4 h-px" aria-hidden />
        <TextSizeChoice />
      </HudPanel>

      <HudPanel
        accent="cyan"
        label={t("settings.theme.title")}
        description={t("settings.theme.description")}
      >
        <ThemeControls />
      </HudPanel>

      <HudPanel
        accent="cyan"
        label={t("settings.selection.title")}
        description={t("settings.selection.description")}
      >
        <SelectionChoice />
      </HudPanel>

      <HudPanel
        accent="cyan"
        label={t("settings.tmux.title")}
        description={t("settings.tmux.description")}
      >
        <TmuxControls />
      </HudPanel>

      <HudPanel
        accent="cyan"
        label={t("settings.profiles.title")}
        description={t("settings.profiles.description")}
      >
        <ProfileControls />
      </HudPanel>
    </>
  );
}

/** How much output fits on screen. Its own component so the Font panel reads as two settings. */
function TextSizeChoice() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const size = settings.data?.terminal_font_size ?? 13;
  const t = useT();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-dim text-xs">{t("settings.font.size")}</span>
      <div className="flex flex-wrap gap-1">
        {FONT_SIZES.map((s) => (
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
      <span className="text-dim text-xs">{t("settings.font.sizeHint")}</span>
    </div>
  );
}

/** Whether dragging across output also puts it on the clipboard. */
function SelectionChoice() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const copyOnSelect = settings.data?.copy_on_select ?? false;
  const t = useT();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-dim text-xs">{t("settings.selection.label")}</span>
      <div className="flex flex-wrap gap-1">
        <Button
          aria-pressed={!copyOnSelect}
          active={!copyOnSelect}
          onClick={() => update.mutate({ copyOnSelect: false })}
        >
          {t("settings.selection.selectOnly")}
        </Button>
        <Button
          aria-pressed={copyOnSelect}
          active={copyOnSelect}
          onClick={() => update.mutate({ copyOnSelect: true })}
        >
          {t("settings.selection.copy")}
        </Button>
      </div>
      <span className="text-dim text-xs">{t("settings.selection.hint")}</span>
    </div>
  );
}

/**
 * Every shortcut, and what the mouse does — the app's answer to "what can I press?".
 *
 * It lives in Settings rather than in a separate help window because it is the same list either way:
 * a help page listing defaults would be wrong the moment somebody rebinds one, and then it is worse
 * than nothing.
 */
function KeyboardSection() {
  const t = useT();
  return (
    <>
      <HudPanel accent="cyan" label={t("keys.title")} description={t("keys.description")}>
        <ShortcutEditor />
      </HudPanel>
      <HudPanel accent="cyan" label={t("keys.mouse.title")}>
        <MouseReference />
      </HudPanel>
    </>
  );
}

/**
 * Settings that belong to a tool rather than to the terminal or the window.
 *
 * The remote check lived under Terminal, which was simply wrong: it is what the Git tool does. With
 * every block now carrying a heading, that misfiling became visible — the panel would have had to be
 * called "Git" inside a tab called "Terminal".
 */
function ToolsSection() {
  const t = useT();
  return (
    <>
      <HudPanel accent="cyan" label={t("cli.title")} description={t("cli.description")}>
        <CliInstaller />
      </HudPanel>
      <HudPanel
        accent="cyan"
        label={t("settings.git.title")}
        description={t("settings.git.description")}
      >
        <GitRemoteChoice />
      </HudPanel>
      <HudPanel
        accent="cyan"
        label={t("settings.notes.title")}
        description={t("settings.notes.description")}
      >
        <NotesSettings />
      </HudPanel>
    </>
  );
}

/** The one outbound connection this app makes, and the switch that refuses it (ADR-PROJ-002). */
function GitRemoteChoice() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const autoFetch = settings.data?.git_auto_fetch ?? true;
  const t = useT();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-dim text-xs">{t("settings.git.remote")}</span>
      <div className="flex flex-wrap gap-1">
        <Button
          aria-pressed={autoFetch}
          active={autoFetch}
          onClick={() => update.mutate({ gitAutoFetch: true })}
        >
          {t("settings.git.check")}
        </Button>
        <Button
          aria-pressed={!autoFetch}
          active={!autoFetch}
          onClick={() => update.mutate({ gitAutoFetch: false })}
        >
          {t("settings.git.offline")}
        </Button>
      </div>
      <span className="text-dim text-xs">{t("settings.git.hint")}</span>
    </div>
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
  // What the terminal will ACTUALLY render in — the chosen font, or the bundled default. The sample
  // used to fall back to `undefined` here, so an untouched install previewed the *system* monospace
  // and showed empty boxes where the Powerline glyphs should be, right under a paragraph promising
  // that Meslo ships and works.
  const effective = chosen === "" ? DEFAULT_FONT : chosen;
  // Re-render once the face has loaded: a bundled @font-face is fetched lazily, so the first paint
  // would otherwise be the fallback — which for this sample means boxes.
  const settled = useFontSettled(effective);
  const t = useT();
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
      <span className="text-dim text-xs">{t("settings.font.label")}</span>
      <div className="flex flex-wrap items-start gap-2">
        <SearchableSelect
          label={t("settings.font.select")}
          value={chosen}
          options={options}
          placeholder={DEFAULT_FONT}
          emptyHint={t("settings.font.notFound")}
          className="max-w-xs flex-1"
          onChange={(family) => update.mutate({ terminalFont: family })}
        />
        {chosen === "" ? null : (
          <Button onClick={() => update.mutate({ terminalFont: "" })}>{t("common.default")}</Button>
        )}
      </div>
      {/* The sample is the answer to the question people actually have: are the Powerline glyphs
          there? A name in a list cannot tell you that. */}
      <div
        className="hud-clip-sm bg-elevated text-fg overflow-x-auto px-2 py-1 text-xs whitespace-pre"
        style={{ fontFamily: `"${effective}", monospace` }}
        data-font-settled={settled}
        aria-label={t("settings.font.preview")}
      >
        {"\ue0b0 \ue0b2 \uf07b \uf126  ~/git-projects  0O1lI| {} => != ->"}
      </div>
      <span className="text-dim text-xs">{t("settings.font.hint", { font: DEFAULT_FONT })}</span>
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
  const t = useT();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-dim text-xs">{t("settings.shell.title")}</span>
      {shells.isPending ? (
        <span className="text-dim font-mono text-xs">{t("settings.shell.reading")}</span>
      ) : shells.isError ? (
        <span className="text-danger font-mono text-xs">{t("settings.shell.failed")}</span>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            <Button
              aria-pressed={chosen === ""}
              active={chosen === ""}
              onClick={() => update.mutate({ terminalShell: "" })}
            >
              {t("common.systemDefault")}
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
                {t("settings.shell.usingDefault")}
                {defaultShell ? (
                  <>
                    {" — "}
                    <code>{defaultShell.path}</code>
                  </>
                ) : null}
                {". "}
                {t("settings.shell.takesEffect")}
              </>
            ) : (
              <>
                <code>{chosen}</code>
                {". "}
                {t("settings.shell.keepsRunning")}
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
  const t = useT();
  const value = draft ?? session;

  const commit = () => {
    if (draft === null || draft === session) return;
    update.mutate({ tmuxSession: draft });
    setDraft(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">{t("settings.tmux.title")}</span>
        <div className="flex flex-wrap gap-1">
          {TMUX_MODES.map((m) => (
            <Button
              key={m.id}
              aria-pressed={mode === m.id}
              active={mode === m.id}
              onClick={() => update.mutate({ tmuxMode: m.id })}
            >
              {t(m.label)}
            </Button>
          ))}
        </div>
        <span className="text-dim text-xs">
          {t(TMUX_MODES.find((m) => m.id === mode)?.hint ?? "settings.tmux.mode.off.hint")}{" "}
          {t("settings.tmux.neverKilled")}
        </span>
      </div>

      {mode === "off" ? null : (
        <div className="flex flex-col gap-1.5">
          <label className="text-dim text-xs" htmlFor="tmux-session">
            {t("settings.tmux.sessionName")}
          </label>
          <TextField
            id="tmux-session"
            value={value}
            placeholder={mode === "attach" ? t("settings.tmux.anyRunning") : "yggshell"}
            className="max-w-xs font-mono"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setDraft(null);
            }}
          />
          <span className="text-dim text-xs">{t("settings.tmux.sessionHint")}</span>
        </div>
      )}
    </div>
  );
}

function WindowSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const minimizeToTray = settings.data?.minimize_to_tray ?? false;
  const t = useT();

  return (
    <HudPanel
      accent="cyan"
      label={t("settings.window.closeButton")}
      description={t("settings.window.closeDescription")}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1">
          <Button
            aria-pressed={!minimizeToTray}
            active={!minimizeToTray}
            onClick={() => update.mutate({ minimizeToTray: false })}
          >
            {t("settings.window.quit")}
          </Button>
          <Button
            aria-pressed={minimizeToTray}
            active={minimizeToTray}
            onClick={() => update.mutate({ minimizeToTray: true })}
          >
            {t("settings.window.tray")}
          </Button>
        </div>
        <span className="text-dim text-xs">{t("settings.window.trayHint")}</span>
      </div>
    </HudPanel>
  );
}

/** What the old Home view was actually good for: saying which build this is. */
function AboutSection() {
  const t = useT();
  return (
    <HudPanel accent="green" label={t("about.title")}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="" aria-hidden className="h-12 w-12 shrink-0 select-none" />
          <div className="flex flex-col gap-1">
            {/* The same small-caps treatment as the title bar, from the same helper: the name is
                "YggShell", and `hud-label` alone would render it YGGSHELL — which is not how the
                product is written. One source for the shape, so the two cannot drift. */}
            <h2
              className="hud-label text-glow-cyan"
              style={
                {
                  fontFamily: "Orbitron, sans-serif",
                  "--hud-label-size": "1.1rem",
                } as React.CSSProperties
              }
              aria-label={APP_NAME}
            >
              {smallCaps(APP_NAME).map((run, at) => (
                <span key={at} aria-hidden style={run.full ? undefined : { fontSize: "0.78em" }}>
                  {run.text}
                </span>
              ))}
            </h2>
            <p className="text-green font-mono text-xs tracking-wide">{APP_TAGLINE}</p>
          </div>
        </div>
        <p className="text-dim max-w-2xl text-sm leading-relaxed">{APP_DESCRIPTION}</p>
        <BuildIdentity className="border-elevated max-w-md border-t pt-3" />
      </div>
    </HudPanel>
  );
}

/** What changed, beside the version number the user can see right above it. */
function ChangelogPanel() {
  const t = useT();
  return (
    <HudPanel
      accent="cyan"
      label={t("about.changelog")}
      description={t("about.changelogDescription")}
    >
      <Changelog />
    </HudPanel>
  );
}

/**
 * The licences of what ships inside the app.
 *
 * Its own panel rather than a line in About: MIT requires the notice to travel with the copy, and a
 * notice folded into a paragraph about the app is one nobody reads.
 */
function CreditsPanel() {
  const t = useT();
  return (
    <HudPanel accent="green" label={t("about.credits")} description={t("about.creditsDescription")}>
      <Credits />
    </HudPanel>
  );
}
