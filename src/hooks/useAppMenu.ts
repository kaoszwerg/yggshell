import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api/commands";
import { appMenuSpec } from "../lib/appMenu";
import { isActionId } from "../lib/shortcuts";
import { useUiStore } from "../store/ui";
import { useRunAction } from "./useRunAction";
import { useT } from "./useT";

/** The id the backend sends for the one item that is not a shortcut action (`menu.rs`). */
const ABOUT = "about";

/**
 * Keep the native application menu describing this application, and run what it asks for.
 *
 * **Two halves, and both are the point.**
 *
 * *Describing:* the menu is rebuilt whenever the language or a key binding changes, from the i18n
 * catalogue and the shortcut store. Neither is copied into the menu — a copy of the strings would be
 * a second thing to translate, and a copy of the keys would silently **beat** the user's own
 * binding, because a menu key equivalent is dispatched by AppKit before the webview sees the
 * keystroke.
 *
 * *Running:* a press comes back as one event carrying the item's id, and that id goes to the same
 * runner the keyboard uses (`useRunAction`). The menu is a second way to ask for something, never a
 * second idea of what was asked for (ADR-CORE-005).
 *
 * Mounted once, at the app root, beside `useShortcuts`.
 */
export function useAppMenu(): void {
  const t = useT();
  const bindings = useUiStore((s) => s.shortcuts);
  const locale = useUiStore((s) => s.locale);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  const run = useRunAction();

  // Through a ref, so the listener is registered once rather than being torn down and rebuilt each
  // time a setting changes underneath the runner.
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });

  // `locale` is not read in the body — it is here because the catalogue `t` reads changes with it,
  // and the menu has to be rebuilt when it does.
  useEffect(() => {
    void api.setAppMenu(appMenuSpec(t, bindings)).catch((error: unknown) => {
      // Surfaced to the log rather than swallowed: without this the menu keeps whatever it had, and
      // a menu that quietly stopped following its own settings is exactly the defect this replaced
      // (rule:logging).
      console.warn("the application menu could not be updated", error);
    });
  }, [t, bindings, locale]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    listen<string>("menu://action", (event) => {
      const id = event.payload;
      if (id === ABOUT) {
        setAboutOpen(true);
        return;
      }
      // An id this build does not know is a backend newer than the interface. Ignored rather than
      // guessed at, and said out loud.
      if (!isActionId(id)) {
        console.warn("the menu asked for something this build does not have:", id);
        return;
      }
      latest.current(id);
    })
      .then((off) => {
        if (cancelled) off();
        else stop = off;
      })
      .catch((error: unknown) => {
        // Without this listener every menu item is inert — which is the failure the whole menu was
        // rebuilt to remove, so it must not happen quietly.
        console.warn("menu presses cannot be received", error);
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [setAboutOpen]);
}
