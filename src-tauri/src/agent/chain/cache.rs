//! The parse cache: how the chain stays cheap without the command becoming destructive.
//!
//! ## The invariant
//!
//! **The reader is idempotent.** The IPC command always returns the *whole* chain; the offset is an
//! optimisation that never crosses the boundary. A command returning a delta would be destructive
//! on call, and this frontend loses a delta four different ways — `React.StrictMode` doubles mounts
//! (`src/main.tsx`), `retry: 3` is the QueryClient default, a tool switch unmounts the query, and
//! two tabs on one repository poll the same file under two query keys.
//!
//! ## In memory only
//!
//! ADR-PROJ-005 §3. The folded steps **are** transcript content — command signatures, file names.
//! They live here and nowhere else: never serialised, never written, gone when the app exits. The
//! precedent is the log ring buffer. A disk cache would put a second copy of the user's sessions
//! outside Claude's own home, unbounded and unknown to them.
//!
//! ## Validated by file identity, not by name
//!
//! `/clear` starts a new session and therefore a new file; a rotation or a rewind changes the one we
//! are reading. Comparing `(inode, length)` catches all of them: same inode and a length that has
//! only grown means the tail is genuinely new, and anything else means start again.

use super::model::Step;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// What was read from one transcript last time.
#[derive(Debug, Clone)]
struct Entry {
    inode: u64,
    len: u64,
    offset: u64,
    steps: Vec<Step>,
}

/// Per-transcript parse state.
#[derive(Default)]
pub struct ChainCache {
    entries: Mutex<HashMap<String, Entry>>,
}

/// What the caller should do for this poll.
pub enum Resume {
    /// Continue from this offset, with these steps already in hand.
    From(u64, Vec<Step>),
    /// Start again: a different file, or one that shrank.
    Fresh,
}

impl ChainCache {
    /// Decide where to resume reading `path`.
    pub fn resume(&self, path: &Path) -> Resume {
        let Some((inode, len)) = identity(path) else {
            return Resume::Fresh;
        };
        let key = path.to_string_lossy().to_string();
        let entries = match self.entries.lock() {
            Ok(entries) => entries,
            // A poisoned lock means another thread panicked while holding it. Re-reading costs
            // milliseconds; propagating the panic would take the tool down for a cache.
            Err(poisoned) => poisoned.into_inner(),
        };
        match entries.get(&key) {
            Some(entry) if entry.inode == inode && len >= entry.len => {
                Resume::From(entry.offset, entry.steps.clone())
            }
            _ => Resume::Fresh,
        }
    }

    /// Record what was read, so the next poll can continue.
    pub fn store(&self, path: &Path, offset: u64, steps: &[Step]) {
        let Some((inode, len)) = identity(path) else {
            return;
        };
        let key = path.to_string_lossy().to_string();
        let mut entries = match self.entries.lock() {
            Ok(entries) => entries,
            Err(poisoned) => poisoned.into_inner(),
        };
        entries.insert(
            key,
            Entry {
                inode,
                len,
                offset,
                steps: steps.to_vec(),
            },
        );
    }

    /// Forget everything. Called when the app wants the memory back.
    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
    }
}

/// `(inode, length)` — the pair that says whether this is still the same file.
#[cfg(unix)]
fn identity(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.ino(), meta.len()))
}

/// Windows has no inode; the creation time serves the same purpose — it changes when the file does.
#[cfg(not(unix))]
fn identity(path: &Path) -> Option<(u64, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    let created = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos() as u64);
    Some((created, meta.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::chain::model::Act;

    fn steps() -> Vec<Step> {
        vec![Step::new(Act::Verify, Some("core".into()))]
    }

    fn write(dir: &Path, body: &str) -> std::path::PathBuf {
        let path = dir.join("t.jsonl");
        std::fs::write(&path, body).expect("write");
        path
    }

    #[test]
    fn a_cold_cache_starts_from_the_beginning() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "one\n");

        assert!(matches!(ChainCache::default().resume(&path), Resume::Fresh));
    }

    #[test]
    fn a_grown_file_resumes_where_it_stopped() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "one\n");
        let cache = ChainCache::default();
        cache.store(&path, 4, &steps());

        std::fs::write(&path, "one\ntwo\n").expect("append");

        match cache.resume(&path) {
            Resume::From(offset, kept) => {
                assert_eq!(offset, 4);
                assert_eq!(kept.len(), 1, "the work already folded is kept");
            }
            Resume::Fresh => panic!("a file that only grew must not be re-read"),
        }
    }

    #[test]
    fn a_file_that_shrank_is_read_again_from_the_start() {
        // A rewind, a rotation, or a truncation. Continuing from an offset past the end would read
        // nothing for ever and the chain would freeze without saying so.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "one\ntwo\nthree\n");
        let cache = ChainCache::default();
        cache.store(&path, 14, &steps());

        std::fs::write(&path, "one\n").expect("truncate");

        assert!(matches!(cache.resume(&path), Resume::Fresh));
    }

    #[test]
    fn a_replaced_file_is_read_again_even_at_the_same_length() {
        // `/clear` mints a new session id and therefore a new file; a replacement at the same size
        // is the case a length check alone would miss entirely.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "one\n");
        let cache = ChainCache::default();
        cache.store(&path, 4, &steps());

        std::fs::remove_file(&path).expect("remove");
        std::fs::write(&path, "two\n").expect("recreate");

        assert!(
            matches!(cache.resume(&path), Resume::Fresh),
            "same name, same length, different file"
        );
    }

    #[test]
    fn a_vanished_file_asks_for_a_fresh_read_rather_than_failing() {
        let cache = ChainCache::default();
        assert!(matches!(
            cache.resume(Path::new("/nowhere/at/all.jsonl")),
            Resume::Fresh
        ));
        // Storing one is a no-op rather than an error.
        cache.store(Path::new("/nowhere/at/all.jsonl"), 0, &steps());
    }

    #[test]
    fn clearing_forgets_everything() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "one\n");
        let cache = ChainCache::default();
        cache.store(&path, 4, &steps());

        cache.clear();

        assert!(matches!(cache.resume(&path), Resume::Fresh));
    }
}
