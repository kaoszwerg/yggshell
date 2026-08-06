//! The native application menu.
//!
//! **Why this file exists at all.** Tauri installs `Menu::default()` when an app sets none, and that
//! default is wrong here in three separate ways — none of which announce themselves:
//!
//! 1. **Its "About" opens the system panel**, built from `AboutMetadata`, not this app's own About
//!    dialog. With no `copyright` or `publisher` in the bundle config it shows a name and a version
//!    and nothing else, while the real About — the one with the build's commit, its channel and its
//!    dependencies — sits behind a status-bar item the menu never reaches.
//! 2. **Its File menu carries `Close Window` with `⌘W`** (`muda`'s predefined item hard-codes it on
//!    macOS). `⌘W` in this app is *close tab*. A menu key equivalent is dispatched by AppKit through
//!    `performKeyEquivalent:` **before** the responder chain, so the menu does not lose that argument
//!    to the webview — it wins it. There is no `Close Window` item below for exactly this reason; the
//!    window's own control closes it.
//! 3. **It says nothing about anything this app does.** No tabs, no tools, no font size, no logs.
//!
//! **The Edit submenu is load-bearing and must never be dropped.** On macOS the terminal's own
//! copy and paste rely on it: `TerminalSurface` deliberately stays out of the way there, because
//! `⌘C`/`⌘V` arrive as `copy:`/`paste:` through the menu's key equivalents and xterm listens for the
//! DOM events that result. Intercepting them in the webview pasted everything twice. So a menu
//! without Cut/Copy/Paste is a terminal that cannot copy — silently, on the one platform this is
//! developed on.
//!
//! **The words and the keys come from the frontend** (`dto::AppMenuSpec`): the words because the
//! i18n catalogue is the single source for every user-visible string and the menu must follow the
//! language setting; the keys because the shortcut store is the single source for every binding and
//! the user can rebind them. The *shape* stays here, because a macOS menu has conventions that are
//! not a frontend concern.
//!
//! **A minimal menu is installed before the frontend has said anything** ([`install_minimal`]).
//! If the webview never comes up — a crash, a failed asset load — the user still has Quit and still
//! has copy and paste. A window with no way out is not an acceptable failure mode
//! (`rule:crash-handling`).

use crate::dto::AppMenuSpec;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Wry};

/// The event a menu item sends to the webview.
///
/// One event carrying the item's id, rather than a command per item: the frontend already has a
/// runner that knows what every action does (`useRunAction`), and the menu is a second way to ask —
/// never a second answer (ADR-CORE-005).
pub const MENU_EVENT: &str = "menu://action";

/// The one item that is not a shortcut action: it opens this app's own About dialog rather than the
/// system panel, which is the whole reason this menu replaced Tauri's default.
pub const ABOUT_ID: &str = "about";

/// Install the smallest menu that leaves the app usable, before the frontend has described the real
/// one.
///
/// Quit, and the editing items the webview needs to copy and paste at all. Deliberately in English
/// and deliberately unlocalised: it exists for the seconds before the frontend answers, and for the
/// case where it never does.
pub fn install_minimal(app: &AppHandle) -> tauri::Result<()> {
    let app_menu = Submenu::with_items(
        app,
        "YggShell",
        true,
        &[
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let menu = Menu::with_items(app, &[&app_menu, &edit_submenu(app, None)?])?;
    app.set_menu(menu)?;
    Ok(())
}

/// Build and install the real menu from what the frontend says it should say.
pub fn install(app: &AppHandle, spec: &AppMenuSpec) -> tauri::Result<()> {
    let labels = &spec.labels;

    /// An item that asks the frontend to run one of its actions.
    macro_rules! action {
        ($id:expr, $text:expr) => {
            MenuItem::with_id(
                app,
                $id,
                $text,
                true,
                spec.keys.get($id).map(String::as_str),
            )?
        };
    }

    let app_menu = Submenu::with_items(
        app,
        // The product name, which macOS shows in bold as the first menu whatever we call it.
        "YggShell",
        true,
        &[
            // OUR About, not the system panel — that is the whole point of the item.
            &MenuItem::with_id(app, ABOUT_ID, &labels.about, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &action!("openSettings", &labels.settings),
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(&labels.services))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&labels.hide))?,
            &PredefinedMenuItem::hide_others(app, Some(&labels.hide_others))?,
            &PredefinedMenuItem::show_all(app, Some(&labels.show_all))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(&labels.quit))?,
        ],
    )?;

    // "Shell" rather than "File": this application's document is a terminal session. A File menu
    // whose entries are all about tabs is a heading that describes nothing.
    let shell_menu = Submenu::with_items(
        app,
        &labels.shell,
        true,
        &[
            &action!("newTab", &labels.new_tab),
            &action!("closeTab", &labels.close_tab),
            &PredefinedMenuItem::separator(app)?,
            &action!("find", &labels.find),
            &action!("clear", &labels.clear),
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        &labels.view,
        true,
        &[
            &action!("fontBigger", &labels.font_bigger),
            &action!("fontSmaller", &labels.font_smaller),
            &action!("fontReset", &labels.font_reset),
            &PredefinedMenuItem::separator(app)?,
            &action!("openLogs", &labels.logs),
            // **No full-screen item here, and that is deliberate.** AppKit adds *Enter Full Screen*
            // to this menu by itself — it recognises a View menu — so anything we put beside it is a
            // second entry for one thing. Ours was there for one build and had to be, because
            // AppKit's own item declined to fire on a frameless window; `window_chrome::allow_fullscreen`
            // fixes that at the cause, and AppKit's item is the better one anyway: it labels itself
            // *Enter* or *Exit* as the state changes, and carries `⌃⌘F` without being told.
            //
            // The separator goes with it. A trailing separator above an item nobody added draws a
            // line under nothing.
        ],
    )?;

    let tools_menu = Submenu::with_items(
        app,
        &labels.tools,
        true,
        &[
            &action!("toggleGitTool", &labels.tool_git),
            &action!("toggleFilesTool", &labels.tool_files),
            &action!("toggleActivityTool", &labels.tool_activity),
            &action!("toggleDockerTool", &labels.tool_docker),
            &action!("toggleAgentTool", &labels.tool_agent),
            &action!("toggleChainTool", &labels.tool_chain),
            &action!("toggleTmuxTool", &labels.tool_tmux),
            &action!("toggleNotesTool", &labels.tool_notes),
        ],
    )?;

    // Built as a Vec because the tab list is generated: nine near-identical entries written out is
    // nine places for one of them to be wrong.
    let mut window_items: Vec<Box<dyn tauri::menu::IsMenuItem<Wry>>> = vec![
        Box::new(PredefinedMenuItem::minimize(app, Some(&labels.minimize))?),
        Box::new(PredefinedMenuItem::maximize(app, Some(&labels.zoom))?),
        Box::new(PredefinedMenuItem::separator(app)?),
        Box::new(action!("nextTab", &labels.next_tab)),
        Box::new(action!("previousTab", &labels.previous_tab)),
        Box::new(PredefinedMenuItem::separator(app)?),
    ];
    for (index, text) in labels.select_tabs.iter().enumerate() {
        let id = format!("selectTab{}", index + 1);
        let accelerator = spec.keys.get(&id).map(String::as_str);
        window_items.push(Box::new(MenuItem::with_id(
            app,
            &id,
            text,
            true,
            accelerator,
        )?));
    }
    let window_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
        window_items.iter().map(AsRef::as_ref).collect();
    let window_menu = Submenu::with_items(app, &labels.window, true, &window_refs)?;

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &shell_menu,
            &edit_submenu(app, Some(labels))?,
            &view_menu,
            &tools_menu,
            &window_menu,
        ],
    )?;
    app.set_menu(menu)?;
    tracing::info!("app menu installed");
    Ok(())
}

/// The Edit submenu — **the one the terminal's copy and paste depend on** (see the module note).
///
/// Its accelerators are the platform's own and are deliberately *not* part of the rebindable
/// shortcut set: `⌘C` in a terminal is the webview's copy, not an action of ours, and offering it for
/// rebinding would let a user take away the only route their own selection has to the clipboard.
fn edit_submenu(
    app: &AppHandle,
    labels: Option<&crate::dto::AppMenuLabels>,
) -> tauri::Result<Submenu<Wry>> {
    let text =
        |pick: fn(&crate::dto::AppMenuLabels) -> &String| labels.map(pick).map(String::as_str);
    Submenu::with_items(
        app,
        text(|l| &l.edit).unwrap_or("Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, text(|l| &l.undo))?,
            &PredefinedMenuItem::redo(app, text(|l| &l.redo))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, text(|l| &l.cut))?,
            &PredefinedMenuItem::copy(app, text(|l| &l.copy))?,
            &PredefinedMenuItem::paste(app, text(|l| &l.paste))?,
            &PredefinedMenuItem::select_all(app, text(|l| &l.select_all))?,
        ],
    )
}

/// Hand a menu press to the frontend, which is where every action already lives.
pub fn route(app: &AppHandle, id: &str) {
    tracing::debug!(id, "app menu");
    if let Err(error) = app.emit(MENU_EVENT, id) {
        // Logged and not swallowed: a menu item that quietly did nothing is the failure this whole
        // module was written to remove (rule:logging).
        tracing::error!(id, %error, "a menu press could not be delivered to the interface");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_event_and_the_about_id_are_the_contract_with_the_frontend() {
        // Both are matched by string on the other side. A rename here with no rename there is a menu
        // that opens nothing, and nothing in either language would object (rule:testing).
        assert_eq!(MENU_EVENT, "menu://action");
        assert_eq!(ABOUT_ID, "about");
    }
}
