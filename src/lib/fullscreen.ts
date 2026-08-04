import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Put the window into full screen, or take it out — **the one implementation**.
 *
 * There are two ways to ask (the title-bar control and the View menu) and there must be exactly one
 * answer, which this is (ADR-CORE-005). That is not a tidiness point: the menu first used
 * `muda`'s predefined Fullscreen item, which sends AppKit's own `toggleFullScreen:` through the
 * responder chain — and AppKit refuses to perform it on a **frameless** window, whose
 * `collectionBehavior` carries no `FullScreenPrimary`. The result was a menu entry that existed,
 * looked right and did nothing, while the button beside it worked, because Tauri's `setFullscreen`
 * does not go through the chain. Two implementations, one of them silently inert.
 *
 * **Nothing of the interface goes away when this runs.** The title bar with its tabs, the tool column
 * and the status bar are the window's *content*, and the content is what grows. What hides is the
 * system's menu bar and the Dock.
 */
export async function toggleFullscreen(): Promise<void> {
  const window = getCurrentWindow();
  const on = await window.isFullscreen();
  await window.setFullscreen(!on);
}
