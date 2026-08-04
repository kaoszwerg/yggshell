//! Telling macOS that this window can go full screen.
//!
//! **The defect this fixes, and it had two faces.** A window created with `decorations: false` is
//! borderless, and AppKit does not give a borderless window
//! `NSWindowCollectionBehaviorFullScreenPrimary` by itself. Without that bit the window is simply not
//! a full-screen-capable window as far as AppKit is concerned, and **every route that goes through
//! the responder chain silently declines**:
//!
//!  - `muda`'s predefined *Toggle Full Screen* item, which sends `toggleFullScreen:` down the chain
//!    (`muda/platform_impl/macos/mod.rs`) — it was in the View menu, looked right, did nothing;
//!  - the *Enter Full Screen* item **AppKit inserts into the View menu by itself** — same chain, same
//!    silence, and it cannot be removed by us because we never added it.
//!
//! Meanwhile the title-bar control worked the whole time, because Tauri's `set_fullscreen` goes
//! through `tao`, which manipulates the window directly instead of asking the responder chain. One
//! window, two answers, and the difference invisible from the outside — which is why the first fix
//! attempt (routing the menu item to the same code as the button) removed the *symptom* on our own
//! item and left AppKit's sitting beside it, still inert.
//!
//! Setting the bit is the cause rather than the symptom: after it, AppKit's own item works, labels
//! itself *Enter*/*Exit* as the state changes, and carries `⌃⌘F` — so this app needs no full-screen
//! menu item of its own at all.
//!
//! macOS-only by construction. Nothing here runs on Windows or Linux, where a frameless window is
//! not a special case for full screen (rule:cross-platform).

#![cfg(target_os = "macos")]

use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use tauri::{Manager, Runtime};

/// Mark the main window full-screen-capable, so AppKit's own menu item and `⌃⌘F` work on it.
///
/// A failure here is logged and no more: full screen is still reachable through the title-bar
/// control, which does not depend on this, so an app that starts without it is diminished rather
/// than broken (`rule:logging` — reported, never swallowed).
pub fn allow_fullscreen<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!("no main window to make full-screen-capable");
        return;
    };
    let handle = match window.ns_window() {
        Ok(handle) => handle,
        Err(error) => {
            tracing::warn!(%error, "could not reach the native window; full screen stays on the title-bar control");
            return;
        }
    };
    if handle.is_null() {
        tracing::warn!(
            "the native window handle was null; full screen stays on the title-bar control"
        );
        return;
    }

    // SAFETY: `ns_window()` returns the `NSWindow` this webview lives in, owned by AppKit for as long
    // as the window exists; it is checked for null above and only borrowed for this call. Reading and
    // writing `collectionBehavior` is what every Cocoa app does to opt a window into full screen, and
    // it touches nothing else about the window.
    let behavior = unsafe {
        let window: &NSWindow = &*handle.cast::<NSWindow>();
        let behavior = window.collectionBehavior() | NSWindowCollectionBehavior::FullScreenPrimary;
        window.setCollectionBehavior(behavior);
        behavior
    };

    tracing::info!(?behavior, "the window may go full screen");
}
