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
///
/// **Bounded** — see `MAX_PENDING`: the source is outside this process.
#[derive(Default)]
pub struct Pending(Mutex<Vec<String>>);

/// How many un-drained launch requests are kept.
///
/// Generous for the real case — nobody opens thirty-two directories before the window appears — and
/// finite for the one that is not real: a webview that never mounts, or a script calling `ygg` in a
/// loop.
const MAX_PENDING: usize = 32;

impl Pending {
    fn push(&self, path: String) {
        // Poisoned only if another thread panicked while holding it; a launch request is not worth
        // taking the process down over, and the list is replaceable.
        if let Ok(mut queue) = self.0.lock() {
            // **Bounded, because the source is outside this process.** Every `ygg <dir>` and every
            // Finder "Open With" appends here, and the queue is only emptied when the webview mounts
            // and asks for it. If that never happens — a webview that fails to start, a shell loop
            // calling `ygg` — an unbounded Vec is the app growing until it is killed, for input it
            // was never going to act on (rule:security: the client is hostile even when you wrote it).
            //
            // The OLDEST goes, not the newest: these are directories somebody asked to open, and the
            // most recent request is the one they are still waiting for.
            if queue.len() >= MAX_PENDING {
                let dropped = queue.remove(0);
                tracing::warn!(
                    dropped = %dropped,
                    max = MAX_PENDING,
                    "the launch queue is full — dropping the oldest request"
                );
            }
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
    let paths: Vec<PathBuf> = urls
        .iter()
        .filter_map(|url| match path_from_url(url) {
            Some(path) => Some(path),
            None => {
                tracing::info!(%url, "ignoring a launch request that is not a file:// URL");
                None
            }
        })
        .collect();
    handle_paths(app, &paths);
}

/// The same thing for paths that did not arrive as URLs.
///
/// The Finder service can hand over a plain filesystem path (`NSFilenamesPboardType`), so the two
/// routes differ in *shape* and not in *trust*: both end here, and `resolve` is the one place that
/// decides whether a path is usable.
pub fn handle_paths(app: &tauri::AppHandle, paths: &[PathBuf]) {
    for path in paths {
        match resolve(path) {
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
    fn the_queue_is_bounded_and_keeps_the_newest() {
        // The source is outside the process: every `ygg <dir>` appends, and the queue only empties
        // when the webview mounts and asks. If that never happens, an unbounded Vec is the app
        // growing until it is killed — for requests it was never going to act on.
        let pending = Pending::default();
        for i in 0..MAX_PENDING + 5 {
            pending.push(format!("/tmp/{i}"));
        }

        let queued = pending.drain();
        assert_eq!(queued.len(), MAX_PENDING);
        // The newest survive: the most recent request is the one somebody is still waiting for.
        assert_eq!(queued.last().map(String::as_str), Some("/tmp/36"));
        assert_eq!(queued.first().map(String::as_str), Some("/tmp/5"));
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
    fn a_file_is_never_opened_only_the_place_it_lives() {
        // The property the Finder entry depends on. Right-clicking a script and choosing
        // "New YggShell Terminal Here" must give a terminal WHERE THAT SCRIPT IS — never an attempt
        // to run or open it. Nothing downstream executes anything, and this is the reason it cannot:
        // what leaves here is a directory, whatever came in.
        let dir = tempfile::tempdir().expect("tempdir");
        let script = dir.path().join("deploy.sh");
        std::fs::write(&script, "#!/bin/sh\nrm -rf /\n").expect("write");

        match resolve(&script) {
            Target::Directory(resolved) => {
                assert_eq!(resolved, dir.path().canonicalize().expect("canonicalize"));
                assert!(resolved.is_dir(), "what comes out is always a directory");
                assert_ne!(resolved, script, "the file itself must never be the target");
            }
            other => panic!("a file must resolve to its directory, got {other:?}"),
        }
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
