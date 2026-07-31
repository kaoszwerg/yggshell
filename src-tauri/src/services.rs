//! The Finder context-menu entry: **New YggShell Terminal Here**.
//!
//! **Why this exists next to the "Open With" association.** Declaring `public.folder` as a document
//! type puts the app in Finder's *Open With* submenu — two clicks deep, next to every other app that
//! can open a folder. What a terminal actually wants is a line in the menu itself, and on macOS that
//! is a **Service** (`NSServices`): it is what iTerm2 does (`NSMessage: openTab`, verified in its own
//! Info.plist), and it is the only mechanism that produces that entry.
//!
//! A Service needs two halves, and the half that is easy to forget is this one:
//!
//!  - `NSServices` in `Info.plist` — what the menu says and what it is allowed to receive;
//!  - a **service provider** registered at runtime, holding the method named by `NSMessage`. Without
//!    it the entry appears and does nothing, which is worse than not appearing at all.
//!
//! **Everything here is macOS-only and deliberately small.** It runs inside the maintainer's daily
//! terminal, so it does the least it can: read paths off the pasteboard, hand them to the same
//! `launch::resolve` that validates every other route in, and return. It never executes anything.

#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::{define_class, msg_send, AllocAnyThread, ClassType};
use objc2_app_kit::{NSApplication, NSPasteboard, NSPasteboardTypeString};
use objc2_foundation::{MainThreadMarker, NSArray, NSBundle, NSString, NSURL};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::AppHandle;

/// The running app, for the service callback.
///
/// A `OnceLock` rather than an instance variable: the provider is created by the Objective-C runtime
/// and outlives any Rust value we could hand it, and there is exactly one app in a process.
static APP: OnceLock<AppHandle> = OnceLock::new();

define_class!(
    /// The object AppKit calls when the menu item is chosen.
    ///
    /// The selector must match `NSMessage` in `Info.plist` exactly: `openTerminalHere` there becomes
    /// `openTerminalHere:userData:error:` here. A mismatch is silent — the menu entry appears and
    /// does nothing at all — which is why both sides are pinned by a test.
    #[unsafe(super(objc2::runtime::NSObject))]
    #[name = "YggShellServiceProvider"]
    struct ServiceProvider;

    impl ServiceProvider {
        #[unsafe(method(openTerminalHere:userData:error:))]
        fn open_terminal_here(
            &self,
            pasteboard: &NSPasteboard,
            _user_data: *mut NSString,
            _error: *mut *mut NSString,
        ) {
            let paths = paths_on(pasteboard);
            if paths.is_empty() {
                tracing::info!("the Finder service was invoked with nothing usable on the pasteboard");
                return;
            }
            let Some(app) = APP.get() else {
                // Cannot happen — the provider is registered after the app exists — but a panic
                // here would cross back into Objective-C, where unwinding is undefined behaviour.
                tracing::error!("the Finder service fired before the app was ready");
                return;
            };
            tracing::info!(count = paths.len(), "opening a terminal from the Finder service");
            crate::launch::handle_paths(app, &paths);
        }
    }
);

/// The filesystem paths sitting on a pasteboard.
///
/// **Two shapes, because the service accepts two.** `NSFilenamesPboardType` arrives as URLs, and
/// `public.plain-text` as a string somebody may have selected in another app. Both are declared in
/// `Info.plist` for the same reason iTerm2 declares them: without the text type the menu item does
/// not appear for a plain FILE at all, only for a folder — and "new terminal here" is exactly as
/// meaningful on a file.
///
/// Neither is trusted. Both end up in `launch::resolve`, which is the one place that decides whether
/// a path is usable at all.
fn paths_on(pasteboard: &NSPasteboard) -> Vec<PathBuf> {
    let classes = NSArray::from_slice(&[NSURL::class()]);
    // SAFETY: `readObjectsForClasses:options:` is a documented AppKit method; the class array is
    // built above and the options argument is allowed to be null.
    let objects: Option<Retained<NSArray<objc2::runtime::AnyObject>>> = unsafe {
        msg_send![pasteboard, readObjectsForClasses: &*classes, options: std::ptr::null::<objc2::runtime::AnyObject>()]
    };

    let mut out = Vec::new();
    if let Some(objects) = objects {
        for index in 0..objects.count() {
            let object = objects.objectAtIndex(index);
            // SAFETY: the read was restricted to NSURL, so every element is one.
            let url: &NSURL = unsafe { &*(std::ptr::from_ref(&*object).cast::<NSURL>()) };
            if let Some(path) = url.path() {
                out.push(PathBuf::from(path.to_string()));
            }
        }
    }

    // A selection of TEXT, which is the other type the service declares. Only an absolute path is
    // taken: a sentence somebody happened to have selected is not a directory, and guessing at a
    // relative one has no base to resolve against.
    if out.is_empty() {
        // SAFETY: `stringForType:` is a documented AppKit reader; the type constant comes from
        // AppKit itself, and it returns nil rather than misbehaving when the type is absent.
        if let Some(text) = unsafe { pasteboard.stringForType(NSPasteboardTypeString) } {
            let trimmed = text.to_string().trim().to_string();
            if trimmed.starts_with('/') {
                out.push(PathBuf::from(trimmed));
            }
        }
    }

    out
}

/// Tell LaunchServices about this bundle, every launch.
///
/// **Why this is not redundant.** macOS caches a bundle's document types under its identifier, and
/// **replacing the app does not invalidate that cache** — an update that adds or changes a document
/// type keeps the OLD one until something re-registers. Measured on this machine: after installing a
/// build that declares `public.folder`, `lsregister -dump` still had no claim for it, and Finder's
/// "Open With" had no entry; one manual `lsregister -f` fixed both.
///
/// Doing it at startup costs a single call and makes the fix automatic for every future update,
/// rather than something the user has to be told to run in a terminal.
fn refresh_launch_services() {
    let Some(bundle) = NSBundle::mainBundle().bundleURL().absoluteString() else {
        tracing::warn!("could not find our own bundle to register with LaunchServices");
        return;
    };
    // `lsregister` is the documented, supported way to do this and needs no private API. It is
    // idempotent, takes well under a second, and failing is not a reason to stop launching.
    let path = bundle.to_string();
    match std::process::Command::new(LSREGISTER)
        .args(["-f", "-R", "-trusted"])
        .arg(bundle_path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        Ok(status) if status.success() => tracing::debug!(%path, "registered with LaunchServices"),
        Ok(status) => tracing::info!(?status, "lsregister reported a problem"),
        Err(error) => tracing::info!(%error, "could not run lsregister"),
    }
}

/// The tool that maintains the LaunchServices database. Part of the OS, at a stable path.
const LSREGISTER: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/// This app's bundle directory, as a filesystem path.
fn bundle_path() -> std::path::PathBuf {
    NSBundle::mainBundle().bundlePath().to_string().into()
}

/// Register the provider so the menu entry actually does something.
///
/// Called once, from `setup`. Failing to register is **logged and survived**: the app is a terminal
/// first, and a missing context-menu entry is not a reason to refuse to start (rule:crash-handling —
/// the failure is reported, not swallowed, and not fatal either).
pub fn register(app: &AppHandle) {
    if APP.set(app.clone()).is_err() {
        tracing::warn!("the Finder service was already registered");
        return;
    }

    let Some(mtm) = MainThreadMarker::new() else {
        // AppKit demands the main thread. Tauri's `setup` runs there, so this is a guard against a
        // future caller moving it, not an expected state.
        tracing::error!("the Finder service must be registered on the main thread");
        return;
    };

    // SAFETY: a plain NSObject subclass with no ivars; `init` is its inherited initialiser.
    let provider: Retained<ServiceProvider> = unsafe { msg_send![ServiceProvider::alloc(), init] };

    let ns_app = NSApplication::sharedApplication(mtm);
    // SAFETY: AppKit takes any object here and looks the selector up dynamically — that is what a
    // services provider IS. The object is kept alive below.
    unsafe { ns_app.setServicesProvider(Some(&provider)) };

    // The provider must outlive this function — AppKit holds it weakly.
    std::mem::forget(provider);

    tracing::info!("registered the Finder service");

    // Done after the provider, so a slow call cannot delay the thing that must exist first.
    refresh_launch_services();
}

#[cfg(test)]
mod tests {
    /// The selector and the `NSMessage` entry in `Info.plist` are one contract across two files.
    ///
    /// Getting them out of step is **silent**: the menu item appears, the user clicks it, and
    /// nothing happens — no error anywhere. So the plist is read here and compared with the name the
    /// method is defined under (rule:testing: a contract is pinned by the side that produces it).
    #[test]
    fn the_service_selector_matches_the_one_declared_in_info_plist() {
        let plist = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Info.plist"))
            .expect("Info.plist must exist next to tauri.conf.json");

        assert!(
            plist.contains("<key>NSMessage</key>"),
            "the service is not declared at all"
        );
        assert!(
            plist.contains("<string>openTerminalHere</string>"),
            "Info.plist names a different selector than the one implemented here"
        );
        assert!(
            plist.contains("public.folder"),
            "the service must accept folders"
        );
    }
}
