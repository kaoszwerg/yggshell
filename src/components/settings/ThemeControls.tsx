import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Palette, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { ColorField } from "../ui/ColorField";
import { PreviewCard } from "../ui/PreviewCard";
import { IconButton } from "../ui/IconButton";
import { TextField } from "../ui/TextField";
import { BUILTIN_THEME_NAME, HUD_TERMINAL_THEME, resolveTheme } from "../../lib/terminalTheme";
import { useT } from "../../hooks/useT";
import {
  useDeleteTerminalTheme,
  useImportTerminalTheme,
  useSaveTerminalTheme,
  useSettings,
  useTerminalThemes,
  useUpdateSettings,
} from "../../hooks/useSettings";
import type { TerminalTheme } from "../../bindings/TerminalTheme";

/** The ANSI slots, in the order a scheme lists them, with the names people use for them. */
const ANSI_NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright black",
  "bright red",
  "bright green",
  "bright yellow",
  "bright blue",
  "bright magenta",
  "bright cyan",
  "bright white",
] as const;

/** The named colours, and where each falls back to in the HUD theme. */
const NAMED = [
  { key: "background", label: "Background", fallback: HUD_TERMINAL_THEME.background },
  { key: "foreground", label: "Foreground", fallback: HUD_TERMINAL_THEME.foreground },
  { key: "cursor", label: "Cursor", fallback: HUD_TERMINAL_THEME.cursor },
  { key: "cursor_accent", label: "Cursor text", fallback: HUD_TERMINAL_THEME.cursorAccent },
  { key: "selection", label: "Selection", fallback: HUD_TERMINAL_THEME.selectionBackground },
  {
    key: "selection_foreground",
    label: "Selected text",
    fallback: HUD_TERMINAL_THEME.foreground,
  },
] as const satisfies readonly {
  key: keyof TerminalTheme;
  label: string;
  fallback: string;
}[];

/** A theme with nothing defined — the starting point for one built by hand. */
const blank = (name: string): TerminalTheme => ({
  id: "",
  name,
  ansi: Array.from({ length: 16 }, () => null),
  builtin: false,
  background: null,
  foreground: null,
  cursor: null,
  cursor_accent: null,
  selection: null,
  selection_foreground: null,
});

/**
 * Terminal colour schemes: choose one, import one from iTerm2, edit one, delete one.
 *
 * **Import is a file drop, not a file dialog**, and that is a deliberate trade rather than a shortcut.
 * A drop hands the webview a *path*; the backend is what opens the file (bounded, extension-checked,
 * parsed by a reader that resolves no entities). A dialog would have meant a plugin dependency for a
 * gesture that is, for a file you already have open in Finder, the more direct one anyway.
 */
export function ThemeControls() {
  const t = useT();
  const settings = useSettings();
  const update = useUpdateSettings();
  const themes = useTerminalThemes();
  const importTheme = useImportTerminalTheme();
  const chosen = settings.data?.terminal_theme ?? "";
  const [editing, setEditing] = useState<TerminalTheme | null>(null);
  const [dropping, setDropping] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  // Tauri's own drag-drop events. The webview never reads the file — it learns the path and hands it
  // to the backend, which is the side allowed to open anything (ADR-PROJ-001 §5).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setDropping(true);
          return;
        }
        if (event.payload.type === "leave") {
          setDropping(false);
          return;
        }
        setDropping(false);
        const paths = event.payload.paths;
        const scheme = paths.find((path) => path.toLowerCase().endsWith(".itermcolors"));
        if (scheme === undefined) {
          setDropError(
            paths.length === 0 ? null : "That is not an .itermcolors file — nothing was imported.",
          );
          return;
        }
        setDropError(null);
        importTheme.mutate(scheme, {
          onError: (error: unknown) => setDropError(String(error)),
        });
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((error: unknown) => {
        // Surfaced rather than swallowed: without this listener the drop zone is decoration, and the
        // user deserves to know that rather than dropping files into nothing.
        console.warn("themes: could not listen for file drops —", error);
        setDropError("File drops are unavailable in this window.");
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [importTheme]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5" role="group" aria-label={t("scheme.terminal")}>
        <span className="text-dim text-xs">{t("scheme.label")}</span>
        {/* Cards, not names: the point of a scheme is how it looks, and eleven names make somebody
            try each one in turn to find that out. Yggdrasil is a card too — it is a scheme like any
            other here, even though choosing it means storing nothing. */}
        <div className="flex flex-wrap gap-2">
          <BuiltinCard
            selected={chosen === ""}
            onChoose={() => update.mutate({ terminalTheme: "" })}
          />
          {(themes.data ?? []).map((theme) => (
            <SchemeCard
              key={theme.id}
              theme={theme}
              selected={chosen === theme.id}
              onChoose={() => update.mutate({ terminalTheme: theme.id })}
            />
          ))}
        </div>
        <span className="text-dim text-xs">{t("scheme.appliesToAll")}</span>
      </div>

      <SchemeChoice
        label="Diffs"
        chosen={settings.data?.diff_theme ?? ""}
        themes={themes.data ?? []}
        followsLabel="Same as the terminal"
        onChoose={(id) => update.mutate({ diffTheme: id })}
        hint="Left empty, a diff is drawn in whatever scheme its own tab's terminal uses."
      />

      <SchemeChoice
        label="Commits"
        chosen={settings.data?.commit_theme ?? ""}
        themes={themes.data ?? []}
        followsLabel="Same as diffs"
        onChoose={(id) => update.mutate({ commitTheme: id })}
        hint="Left empty, a commit follows the diff setting — and through it, the terminal."
      />

      <div
        // The drop target is the whole window (Tauri reports drops there), so this is a hint rather
        // than a hit area — which is why it is not a control and takes no focus.
        className={`hud-clip-sm border-dashed p-3 text-center transition-colors ${
          dropping ? "border-cyan bg-cyan/10 border" : "border-cyan/25 border"
        }`}
      >
        <Palette
          size={18}
          strokeWidth={1.5}
          className={dropping ? "text-cyan mx-auto" : "text-cyan/50 mx-auto"}
          aria-hidden
        />
        <p className="text-dim mt-1 font-mono text-xs">
          {importTheme.isPending
            ? "Importing…"
            : "Drop an .itermcolors file anywhere on this window to import it."}
        </p>
        {dropError === null ? null : (
          <p className="text-danger mt-1 font-mono text-xs">{dropError}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button accent="green" onClick={() => setEditing(blank("New scheme"))}>
          {t("scheme.new")}
        </Button>
        {chosen === "" ? null : (
          <Button
            onClick={() => {
              const current = (themes.data ?? []).find((theme) => theme.id === chosen);
              if (current) setEditing({ ...current, ansi: [...current.ansi] });
            }}
          >
            {t("scheme.edit", {
              name: (themes.data ?? []).find((theme) => theme.id === chosen)?.name ?? chosen,
            })}
          </Button>
        )}
      </div>

      {editing === null ? null : (
        <ThemeEditor
          theme={editing}
          onClose={() => setEditing(null)}
          onEdited={(next) => setEditing(next)}
        />
      )}
    </div>
  );
}

/**
 * One "which scheme" choice, with an explicit "follow the one above" option.
 *
 * Empty means *inherit*, and it has a button of its own rather than being the absence of a choice:
 * a chain nobody can see is a chain nobody can predict, and "same as the terminal" is the answer most
 * people want to leave in place.
 */
function SchemeChoice({
  label,
  chosen,
  themes,
  followsLabel,
  onChoose,
  hint,
}: {
  label: string;
  chosen: string;
  themes: readonly TerminalTheme[];
  followsLabel: string;
  onChoose: (id: string) => void;
  hint: string;
}) {
  return (
    // A named group so each of these is a place rather than a run of buttons — three sets of the same
    // scheme names side by side are ambiguous to anyone not looking at the headings.
    <div className="flex flex-col gap-1.5" role="group" aria-label={`${label} colour scheme`}>
      <span className="text-dim text-xs">{label}</span>
      {/* Cards rather than a row of names: the point of a scheme is how it looks, and eleven names
          make somebody try each one in turn to find that out. "Follow the settings" stays a plain
          button — it has no colours of its own to show, and drawing it as a card would invent some. */}
      <div className="flex flex-wrap gap-2">
        <Button aria-pressed={chosen === ""} active={chosen === ""} onClick={() => onChoose("")}>
          {followsLabel}
        </Button>
        {themes.map((theme) => (
          <SchemeCard
            key={theme.id}
            theme={theme}
            selected={chosen === theme.id}
            onChoose={() => onChoose(theme.id)}
          />
        ))}
      </div>
      <span className="text-dim text-xs">{hint}</span>
    </div>
  );
}

/**
 * The built-in scheme, drawn the same way as the rest.
 *
 * It has no `TerminalTheme` of its own — choosing it means storing nothing at all — so it cannot go
 * through `SchemeCard`. Rendered from the HUD's own palette, which is exactly what it is.
 */
function BuiltinCard({ selected, onChoose }: { selected: boolean; onChoose: () => void }) {
  return (
    <SchemeCardBody
      name={BUILTIN_THEME_NAME}
      colours={HUD_TERMINAL_THEME}
      selected={selected}
      onChoose={onChoose}
    />
  );
}

/**
 * One scheme, drawn as what it looks like.
 *
 * The three things it shows answer the questions somebody choosing actually has: the background and
 * foreground together (is it dark? is the text comfortable on it?), a line of prompt-shaped text
 * (what will my shell look like?), and the colours a program is most likely to reach for.
 */
function SchemeCard({
  theme,
  selected,
  onChoose,
}: {
  theme: TerminalTheme;
  selected: boolean;
  onChoose: () => void;
}) {
  return (
    <SchemeCardBody
      name={theme.name}
      colours={resolveTheme(theme)}
      selected={selected}
      onChoose={onChoose}
    />
  );
}

/** The card itself, for a scheme that has colours — bundled, imported or built in. */
function SchemeCardBody({
  name,
  colours: c,
  selected,
  onChoose,
}: {
  name: string;
  colours: ReturnType<typeof resolveTheme>;
  selected: boolean;
  onChoose: () => void;
}) {
  const t = useT();
  const swatches = [c.red, c.green, c.yellow, c.blue, c.magenta, c.cyan];

  return (
    <PreviewCard
      label={name}
      selected={selected}
      selectedLabel={t("scheme.inUse")}
      background={c.background}
      onChoose={onChoose}
      className="w-40"
    >
      <span className="truncate font-mono text-[11px]" style={{ color: c.foreground }}>
        {name}
      </span>
      {/* Prompt-shaped, because that is what the user will spend the day looking at. The command is
          `<code>`: it is what somebody TYPES, identical in every language, and translating it in a
          preview would misrepresent what their terminal is going to look like (rule:i18n). */}
      <code className="truncate font-mono text-[10px]">
        <span style={{ color: c.green }}>~/src</span> <span style={{ color: c.cyan }}>❯</span>{" "}
        <span style={{ color: c.foreground }}>git status</span>
      </code>
      <span className="flex gap-0.5" aria-hidden>
        {swatches.map((colour, at) => (
          <span key={at} className="h-2.5 flex-1" style={{ backgroundColor: colour }} />
        ))}
      </span>
    </PreviewCard>
  );
}

/** Editing one scheme: its name, its six named colours, its sixteen ANSI slots, and a live preview. */
function ThemeEditor({
  theme,
  onEdited,
  onClose,
}: {
  theme: TerminalTheme;
  onEdited: (theme: TerminalTheme) => void;
  onClose: () => void;
}) {
  const t = useT();
  const save = useSaveTerminalTheme();
  const remove = useDeleteTerminalTheme();
  const update = useUpdateSettings();
  const resolved = resolveTheme(theme);

  const setAnsi = (index: number, colour: string | null) => {
    // Rebuilt rather than assigned into: a computed index write is an object-injection sink, and the
    // gate runs at --max-warnings 0.
    const ansi = theme.ansi.map((existing, at) => (at === index ? colour : existing));
    onEdited({ ...theme, ansi });
  };

  return (
    <div className="hud-clip-sm border-cyan/20 flex flex-col gap-3 border p-3">
      <div className="flex items-center gap-2">
        <TextField
          aria-label={t("scheme.name")}
          value={theme.name}
          placeholder={t("scheme.name")}
          className="max-w-xs font-mono"
          onChange={(e) => onEdited({ ...theme, name: e.target.value })}
        />
        {theme.id === "" || theme.builtin ? null : (
          <IconButton
            label={t("scheme.delete")}
            variant="ghost"
            accent="danger"
            onClick={() => {
              remove.mutate(theme.id, {
                // The setting still names it, and a setting pointing at nothing would leave the
                // terminals on a scheme the user can no longer see or choose.
                onSuccess: () => {
                  update.mutate({ terminalTheme: "" });
                  onClose();
                },
              });
            }}
          >
            <Trash2 size={14} strokeWidth={2.5} />
          </IconButton>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">{t("scheme.named")}</span>
        <div className="grid grid-cols-2 gap-2">
          {NAMED.map((entry) => (
            <div key={entry.key} className="flex items-center gap-2">
              <span className="text-dim w-24 shrink-0 text-xs">{entry.label}</span>
              <ColorField
                label={entry.label}
                value={(theme[entry.key] as string | null) ?? null}
                fallback={entry.fallback}
                onChange={(colour) => onEdited({ ...theme, [entry.key]: colour })}
              />
            </div>
          ))}
        </div>
        <span className="text-dim text-xs">{t("scheme.namedHint")}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">{t("scheme.ansi")}</span>
        <div className="grid grid-cols-2 gap-2">
          {ANSI_NAMES.map((name, index) => (
            <div key={name} className="flex items-center gap-2">
              <span className="text-dim w-24 shrink-0 text-xs">{name}</span>
              <ColorField
                label={name}
                value={theme.ansi.at(index) ?? null}
                fallback={HUD_TERMINAL_THEME.black}
                onChange={(colour) => setAnsi(index, colour)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* The preview is the point of an editor: sixteen hex values are not a colour scheme until you
          can see them next to each other on the background they will actually sit on. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">Preview</span>
        <div
          className="hud-clip-sm flex flex-col gap-1 p-2 font-mono text-xs"
          style={{ backgroundColor: resolved.background, color: resolved.foreground }}
        >
          <div className="flex flex-wrap gap-1">
            {ANSI_NAMES.map((name, index) => (
              <span
                key={name}
                aria-label={name}
                className="h-3 w-3"
                style={{ backgroundColor: swatchFor(resolved, index) }}
              />
            ))}
          </div>
          {/* Sample terminal output, deliberately NOT translated: this is what a compiler prints,
              and it prints it in English on every machine. Translating it would misrepresent what the
              scheme will actually look like. `<code>` says so to the reader and to the i18n gate. */}
          <code className="contents">
            <span>
              <span style={{ color: resolved.green }}>~/git-projects</span>{" "}
              <span style={{ color: resolved.cyan }}>❯</span> cargo build
            </span>
            <span style={{ color: resolved.yellow }}>warning: unused variable `x`</span>
            <span style={{ color: resolved.red }}>error: could not compile</span>
          </code>
          <span>
            <span style={{ backgroundColor: resolved.selectionBackground }}>
              {t("scheme.selectedText")}
            </span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <Button
          accent="green"
          disabled={theme.name.trim() === ""}
          onClick={() => {
            save.mutate(theme, {
              // Selected on save, because saving a scheme you cannot see is a step nobody wants to
              // take twice.
              onSuccess: (stored) => {
                update.mutate({ terminalTheme: stored.id });
                onClose();
              },
            });
          }}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        {save.isError ? (
          <span className="text-danger self-center font-mono text-xs">{String(save.error)}</span>
        ) : null}
      </div>
    </div>
  );
}

/** The resolved colour for one ANSI slot. Spelled out rather than indexed: a computed member access
 *  is an object-injection sink and the gate runs at --max-warnings 0. */
function swatchFor(resolved: ReturnType<typeof resolveTheme>, index: number): string {
  switch (index) {
    case 0:
      return resolved.black;
    case 1:
      return resolved.red;
    case 2:
      return resolved.green;
    case 3:
      return resolved.yellow;
    case 4:
      return resolved.blue;
    case 5:
      return resolved.magenta;
    case 6:
      return resolved.cyan;
    case 7:
      return resolved.white;
    case 8:
      return resolved.brightBlack;
    case 9:
      return resolved.brightRed;
    case 10:
      return resolved.brightGreen;
    case 11:
      return resolved.brightYellow;
    case 12:
      return resolved.brightBlue;
    case 13:
      return resolved.brightMagenta;
    case 14:
      return resolved.brightCyan;
    default:
      return resolved.brightWhite;
  }
}
