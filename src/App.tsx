import { useRef } from "react";
import { TitleBar } from "./components/layout/TitleBar";
import { StatusBar } from "./components/layout/StatusBar";
import { Sidebar } from "./components/sidebar/Sidebar";
import { ToolPanel } from "./components/tools/ToolPanel";
import { AboutDialog } from "./components/AboutDialog";
import { CrashNotice } from "./components/CrashNotice";
import { CloseTabConfirm } from "./components/CloseTabConfirm";
import { TerminalView } from "./views/TerminalView";
import { LogsView } from "./views/LogsView";
import { SettingsView } from "./views/SettingsView";
import { useScrollTop } from "./hooks/useScrollTop";
import { useApplyUiScale } from "./hooks/useUiScale";
import { useSyncLocale } from "./hooks/useT";
import { useLaunchRequests } from "./hooks/useLaunchRequests";
import { useShortcuts } from "./hooks/useShortcuts";
import { useNativeContextMenuGuard } from "./hooks/useNativeContextMenuGuard";
import { useAttentionBell } from "./hooks/useAttentionBell";
import { useRefreshOnCommandEnd } from "./hooks/useRefreshOnCommandEnd";
import { useUiStore } from "./store/ui";

/** Application shell: frameless HUD chrome with a sidebar and the routed views. Product views are
 * registered here and in the Sidebar's nav list — nothing else in the shell needs to change. */
export default function App() {
  const view = useUiStore((s) => s.view);
  const aboutOpen = useUiStore((s) => s.aboutOpen);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  const mainRef = useRef<HTMLElement>(null);
  const { canTop, scrollToTop } = useScrollTop(mainRef, view);
  useApplyUiScale();
  // The interface language is mirrored into the UI store so the first frame is already right; this
  // is where the stored setting — the durable one — reaches that mirror (`hooks/useT`).
  useSyncLocale();
  // `ygg <dir>` and Finder's "Open With" both land here as a new terminal in that directory.
  useLaunchRequests();
  // Keyboard shortcuts, matched on the window so they work wherever the caret is.
  useShortcuts();
  useNativeContextMenuGuard();
  // An agent asking for something marks ITS tab — at the shell root, because the whole point is that
  // it reaches you while you are looking somewhere else entirely (`hooks/useAttentionBell`).
  useAttentionBell();
  // Three panels describe state the terminal produces — what it is running, the directory, the
  // containers — and none of them had a way to hear that it changed. A command ending is that
  // moment, and OSC 133 already reports it (`hooks/useRefreshOnCommandEnd`).
  useRefreshOnCommandEnd();

  return (
    <div className="window-frame h-full">
      {/* The animated band. A separate element on purpose: `clip-path` applies to an element AND its
          descendants, and `.window-frame` is the container the whole app renders inside — clipping it
          to the band would erase the application, not the covered gradient (app-109). */}
      <div className="window-frame-glow" aria-hidden="true" />
      <div className="window-frame-inner hud-grid-bg flex h-full flex-col">
        <TitleBar />
        {/* Shown only when the previous run left a crash report (ADR-APP-032) — the one place a
            startup crash, which never had a window to report into, becomes visible to the user. */}
        <CrashNotice />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          {/* The tool column sits between the rail and the view: the rail navigates, the tool renders
              here, and the view keeps whatever width is left rather than being covered. */}
          <ToolPanel />
          <main ref={mainRef} className="relative flex-1 overflow-hidden">
            {/* The terminal is HIDDEN when you navigate away, never unmounted.
                Unmounting it runs every pane's cleanup, and that cleanup ends the PTY — so a glance
                at Settings or Logs used to kill every running shell, and coming back left an empty
                workspace. The terminals are the product; a view is a place you look, not a reason to
                take a build or an agent down. This is the same trade the panes already make with each
                other: all mounted, one visible.
                It measures 0×0 while hidden, which `TerminalSurface` ignores on purpose, and its
                ResizeObserver fires again the moment it comes back. */}
            <div className={view === "terminal" ? "h-full w-full" : "hidden"}>
              <TerminalView />
            </div>
            {view === "logs" ? <LogsView /> : null}
            {view === "settings" ? <SettingsView /> : null}
          </main>
        </div>
        <StatusBar canScrollTop={canTop} onScrollTop={scrollToTop} />
      </div>
      {aboutOpen ? <AboutDialog onClose={() => setAboutOpen(false)} /> : null}
      {/* Asks before a close leaves a tmux session behind. At the root, because the three places a
          user can close a tab — the ×, ⌘W, the context menu — must all reach the same question. */}
      <CloseTabConfirm />
    </div>
  );
}
