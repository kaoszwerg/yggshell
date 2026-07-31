//! Opening a terminal in a directory somebody named from outside the app.
//!
//! Two ways in, one path through here:
//!
//!  - **`ygg ~/some/project`** — the command-line launcher, which is `open -a` under the hood.
//!  - **Finder → Open With → YggShell** on a folder.
//!
//! Both arrive as an *opened* event carrying `file://` URLs, and both are **untrusted input**: the
//! string comes from a shell, from a drag, from whatever `open` was handed (rule:security). So it is
//! validated here, once, before anything acts on it — and what it can express is deliberately tiny.
//!
//! **A directory, and nothing else.** This is not a way to name a program for the terminal to run
//! (ADR-PROJ-001 §5): the value becomes a working directory for a shell the *settings* choose, never
//! a command line. A file resolves to the directory holding it, because "open this in a terminal" is
//! what somebody means when they drop a file on a terminal emulator.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// The event the frontend listens for. One name, used by both entry routes.
pub const EVENT: &str = "open-in-directory";

/// Directories that arrived before the window could listen.
///
/// **This is not an optimisation, it is the common case.** Launching from a cold start means the
/// `Opened` event fires while the webview is still loading, so an emit at that moment reaches
/// nobody — the user typed `ygg .`, the app opened, and their terminal is in the wrong place. The
/// frontend asks for what it missed as soon as it is listening.
#[derive(Default)]
pub struct Pending(Mutex<Vec<String>>);

impl Pending {
    fn push(&self, path: String) {
        // Poisoned only if another thread panicked while holding it; a launch request is not worth
        // taking the process down over, and the list is replaceable.
        if let Ok(mut queue) = self.0.lock() {
            queue.push(path);
        }
    }

    /// Take everything queued, leaving the queue empty — each request opens exactly one tab.
    pub fn drain(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut queue| std::mem::take(&mut *queue))
            .unwrap_or_default()
    }
}

/// Act on paths handed to the app from outside: validate, then tell the frontend to open a tab.
///
/// Anything that does not resolve is **logged and dropped**, never substituted — opening a terminal
/// somewhere the user did not name would be a silent lie about what they asked for.
pub fn handle_urls(app: &tauri::AppHandle, urls: &[String]) {
    for url in urls {
        let Some(path) = path_from_url(url) else {
            tracing::info!(%url, "ignoring a launch request that is not a file:// URL");
            continue;
        };
        match resolve(&path) {
            Target::Directory(dir) => {
                let dir = dir.to_string_lossy().to_string();
                tracing::info!(path = %dir, "opening a terminal from outside the app");
                // Queued first, emitted second: if the window is not listening yet the emit is lost,
                // and the queue is what the frontend drains once it is.
                app.state::<Pending>().push(dir.clone());
                if let Err(error) = app.emit(EVENT, dir) {
                    tracing::warn!(%error, "could not tell the interface to open a terminal");
                }
            }
            Target::Rejected(why) => {
                tracing::warn!(%why, "refusing a launch request");
            }
        }
    }
}

/// What a launch request resolves to, once it has been checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// A directory that exists and can be handed to a shell.
    Directory(PathBuf),
    /// Nothing usable — reported, never guessed at.
    Rejected(String),
}

/// Turn something the outside world named into a directory, or say why not.
///
/// The rules, and why each one:
///
///  - **It must exist.** A path that does not is a typo or a stale bookmark; starting a shell in the
///    user's home instead would be a silent substitution of something they did not ask for.
///  - **A file becomes its parent.** Dropping a file on a terminal means "put me where that lives".
///  - **It is canonicalised**, which resolves `..` and symlinks. Not as a security boundary — there
///    is no boundary to cross here, the user can `cd` anywhere they like — but so the tab's title and
///    the Git tool agree with what the shell actually reports.
pub fn resolve(raw: &Path) -> Target {
    let canonical = match raw.canonicalize() {
        Ok(path) => path,
        Err(error) => {
            return Target::Rejected(format!("{} — {error}", raw.display()));
        }
    };

    if canonical.is_dir() {
        return Target::Directory(canonical);
    }

    match canonical.parent() {
        Some(parent) if parent.is_dir() => Target::Directory(parent.to_path_buf()),
        _ => Target::Rejected(format!("{} is not a directory", canonical.display())),
    }
}

/// The path inside a `file://` URL, or `None` for anything else.
///
/// Deliberately narrow: `open` and Finder hand over `file://` URLs, and a scheme we do not recognise
/// is not something to guess about. An `http` URL arriving here would mean somebody registered this
/// app for one, which it has not asked for.
pub fn path_from_url(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("file://")?;
    // `open` produces `file:///Users/...` — the empty authority. Anything else (a host, a UNC-style
    // share) is not a local directory and is not resolved here.
    let path = rest.strip_prefix('/').map(|p| format!("/{p}"))?;
    Some(PathBuf::from(percent_decode(&path)))
}

/// Undo the percent-encoding `open` applies to spaces and non-ASCII characters.
///
/// Written out rather than pulled in: the encoding is three characters wide and total, the app has no
/// other use for a URL crate, and a dependency is justified by need (rule:dependencies).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        // A `%` that is not followed by two hex digits is kept as written — a literal percent sign in
        // a directory name is legal, and mangling it would be worse than leaving it alone.
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(value) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    // The bytes came from a path, which on Unix is not required to be UTF-8. Lossy rather than
    // failing: a directory with an undecodable byte in its name is still somewhere a shell can start.
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_event_name_is_the_one_the_interface_listens_for() {
        // A contract across two runtimes. Renaming it here and nowhere else would silently stop
        // `ygg` from doing anything, with no error on either side — so it is pinned on both
        // (rule:testing: anything one side matches on is pinned by the side that produces it).
        assert_eq!(EVENT, "open-in-directory");
    }

    #[test]
    fn a_queued_request_is_handed_over_once() {
        // Draining, not reading: a reload must not reopen terminals the user already has.
        let pending = Pending::default();
        pending.push("/tmp/one".into());
        pending.push("/tmp/two".into());

        assert_eq!(pending.drain(), vec!["/tmp/one", "/tmp/two"]);
        assert!(pending.drain().is_empty(), "a second drain must be empty");
    }

    #[test]
    fn a_directory_resolves_to_itself() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert_eq!(
            resolve(dir.path()),
            Target::Directory(dir.path().canonicalize().expect("canonicalize"))
        );
    }

    #[test]
    fn a_file_resolves_to_the_directory_holding_it() {
        // Dropping a file on a terminal emulator means "put me where that lives".
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("notes.txt");
        std::fs::write(&file, "x").expect("write");

        assert_eq!(
            resolve(&file),
            Target::Directory(dir.path().canonicalize().expect("canonicalize"))
        );
    }

    #[test]
    fn a_path_that_does_not_exist_is_refused_rather_than_substituted() {
        // Falling back to the home directory would silently open a terminal somewhere the user never
        // asked for, which is worse than saying nothing happened.
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("nope");

        assert!(matches!(resolve(&missing), Target::Rejected(_)));
    }

    #[test]
    fn dot_dot_is_resolved_so_the_tab_agrees_with_the_shell() {
        let dir = tempfile::tempdir().expect("tempdir");
        let child = dir.path().join("child");
        std::fs::create_dir(&child).expect("mkdir");

        let round_about = child.join("..");
        assert_eq!(
            resolve(&round_about),
            Target::Directory(dir.path().canonicalize().expect("canonicalize"))
        );
    }

    #[test]
    fn a_file_url_yields_its_path() {
        assert_eq!(
            path_from_url("file:///Users/steve/git"),
            Some(PathBuf::from("/Users/steve/git"))
        );
    }

    #[test]
    fn a_percent_encoded_url_is_decoded() {
        // `open` encodes spaces, and a project directory with a space in it is entirely ordinary.
        assert_eq!(
            path_from_url("file:///Users/steve/My%20Projects"),
            Some(PathBuf::from("/Users/steve/My Projects"))
        );
        assert_eq!(
            path_from_url("file:///tmp/caf%C3%A9"),
            Some(PathBuf::from("/tmp/café"))
        );
    }

    #[test]
    fn a_stray_percent_is_left_alone_rather_than_mangled() {
        assert_eq!(
            path_from_url("file:///tmp/100%"),
            Some(PathBuf::from("/tmp/100%"))
        );
        assert_eq!(
            path_from_url("file:///tmp/%zz"),
            Some(PathBuf::from("/tmp/%zz"))
        );
    }

    #[test]
    fn a_scheme_we_did_not_ask_for_is_ignored() {
        // This app registers for folders, not for links. Anything else arriving here means something
        // is wrong upstream, and guessing at it is how a launcher becomes an execution path.
        assert_eq!(path_from_url("https://example.com"), None);
        assert_eq!(path_from_url("yggshell://run"), None);
        assert_eq!(path_from_url("/plain/path"), None);
    }
}
