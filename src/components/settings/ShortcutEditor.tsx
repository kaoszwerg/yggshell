import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../store/ui";
import {
  ACTIONS,
  bindingFor,
  bindingFromEvent,
  conflictWith,
  formatBinding,
  isMacPlatform,
  isReservedForShell,
  type ActionId,
} from "../../lib/shortcuts";
import type { MessageKey } from "../../i18n";

/** Why a captured combination was refused, or `null` when it was accepted. */
type Refusal = { kind: "reserved" } | { kind: "conflict"; action: ActionId } | null;

/**
 * The shortcut list — which is also the app's answer to "what can I press?".
 *
 * **One list, not a settings page plus a help page.** A printed list of defaults goes stale the
 * moment somebody rebinds something, and then it is worse than nothing: it tells the user a key that
 * does not work. This shows what is bound *right now*, because it reads the same store the runner
 * does.
 *
 * **Capturing is modal on purpose.** While a row is recording, every keystroke belongs to it —
 * otherwise pressing `⌘W` to bind it would close the tab first.
 */
export function ShortcutEditor() {
  const t = useT();
  const bindings = useUiStore((s) => s.shortcuts);
  const setShortcut = useUiStore((s) => s.setShortcut);
  const reset = useUiStore((s) => s.resetShortcuts);
  const [recording, setRecording] = useState<ActionId | null>(null);
  const [refusal, setRefusal] = useState<Refusal>(null);
  const mac = isMacPlatform();
  const modifier = mac ? "⌘" : "Ctrl+Shift";

  useEffect(() => {
    if (recording === null) return;

    const onKey = (event: KeyboardEvent) => {
      // Captured before anything else can act on it — including the app's own shortcuts, which is
      // why binding ⌘W does not close the tab on the way.
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(null);
        setRefusal(null);
        return;
      }

      const binding = bindingFromEvent(event);
      // A bare modifier is somebody on their way to a combination, not a combination.
      if (binding === null) return;

      if (isReservedForShell(binding, mac)) {
        setRefusal({ kind: "reserved" });
        return;
      }
      const clash = conflictWith(bindings, binding, recording);
      if (clash !== null) {
        // Refused rather than stolen: silently unbinding the other action would leave the user with
        // a key that stopped working and no idea why.
        setRefusal({ kind: "conflict", action: clash });
        return;
      }

      setShortcut(recording, binding);
      setRecording(null);
      setRefusal(null);
    };

    // Capture phase, so this runs before the window-level runner sees the key.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, bindings, mac, setShortcut]);

  const label = (action: ActionId) => t(`keys.action.${action}` as MessageKey);
  const shown = (action: ActionId) => {
    const binding = bindingFor(bindings, action);
    return binding === undefined ? "" : formatBinding(binding, mac);
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1" aria-label={t("keys.title")}>
        {ACTIONS.map((action) => {
          const isRecording = recording === action;
          return (
            <li key={action} className="flex items-center justify-between gap-3">
              <span className="text-dim min-w-0 truncate text-xs">{label(action)}</span>
              <Button
                aria-label={`${label(action)} — ${shown(action)}`}
                active={isRecording}
                accent={isRecording ? "gold" : "cyan"}
                className="min-w-28 font-mono"
                onClick={() => {
                  setRefusal(null);
                  setRecording(isRecording ? null : action);
                }}
              >
                {isRecording ? t("keys.recording") : shown(action)}
              </Button>
            </li>
          );
        })}
      </ul>

      {refusal?.kind === "reserved" ? (
        <span className="text-gold text-xs">{t("keys.reserved", { modifier })}</span>
      ) : null}
      {refusal?.kind === "conflict" ? (
        <span className="text-gold text-xs">
          {t("keys.conflict", { action: label(refusal.action) })}
        </span>
      ) : null}

      <div className="flex flex-wrap gap-1">
        <Button onClick={() => reset()}>{t("keys.reset")}</Button>
      </div>

      <span className="text-dim text-xs">{t("keys.info", { modifier })}</span>
    </div>
  );
}

/** What the mouse does — the other half of "what can I press?", and none of it is configurable. */
export function MouseReference() {
  const t = useT();
  const modifier = isMacPlatform() ? "⌘" : "Ctrl";

  const rows: { what: MessageKey; how: MessageKey }[] = [
    { what: "keys.mouse.openLink", how: "keys.mouse.openLink.how" },
    { what: "keys.mouse.paste", how: "keys.mouse.paste.how" },
    { what: "keys.mouse.menu", how: "keys.mouse.menu.how" },
  ];

  return (
    <ul className="flex flex-col gap-1" aria-label={t("keys.mouse.title")}>
      {rows.map((row) => (
        <li key={row.what} className="flex items-center justify-between gap-3">
          <span className="text-dim min-w-0 truncate text-xs">{t(row.what)}</span>
          <span className="text-fg shrink-0 font-mono text-xs">{t(row.how, { modifier })}</span>
        </li>
      ))}
    </ul>
  );
}
