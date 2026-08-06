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

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// What was read from one transcript last time.
///
/// **Everything derived, not a selection of it.** An earlier version kept only `steps`, and the
/// plan, the tally and the version were rebuilt from whatever few lines each poll happened to read —
/// so a session with nineteen tracked tasks reported that it kept no plan, and its coverage read
/// `173/173` for a file where it was `275/392`. A partial cache is worse than none: it is wrong only
/// from the second poll onwards, which is the one nobody watches.
#[derive(Debug, Clone)]
struct Entry {
    inode: u64,
    parsed: super::Parsed,
}

/// Per-transcript parse state.
#[derive(Default)]
pub struct ChainCache {
    entries: Mutex<HashMap<String, Entry>>,
}

impl ChainCache {
    /// Everything already known about `path`, or a fresh state when it must be read again.
    ///
    /// Returns what to hand to `parse_onto`: its `offset` says where to continue, and `0` means
    /// start over — which is always correct, only slower.
    pub fn resume(&self, path: &Path) -> super::Parsed {
        let Some((inode, len)) = identity(path) else {
            return super::Parsed::default();
        };
        let key = path.to_string_lossy().to_string();
        let entries = match self.entries.lock() {
            Ok(entries) => entries,
            // A poisoned lock means another thread panicked while holding it. Re-reading costs
            // milliseconds; propagating the panic would take the tool down for a cache.
            Err(poisoned) => poisoned.into_inner(),
        };
        match entries.get(&key) {
            Some(entry) if entry.inode == inode && len >= entry.parsed.offset => {
                entry.parsed.clone()
            }
            _ => super::Parsed::default(),
        }
    }

    /// Record what is now known, so the next poll can continue from it.
    pub fn store(&self, path: &Path, parsed: &super::Parsed) {
        let Some((inode, _len)) = identity(path) else {
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
                parsed: parsed.clone(),
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
    use crate::agent::chain::model::{Act, PlanStep, Step};
    use crate::agent::chain::Parsed;

    /// A parse state with something in every field that accumulates.
    fn parsed(offset: u64) -> Parsed {
        Parsed {
            steps: vec![Step::new(Act::Verify, Some("core".into()))],
            plan: vec![PlanStep {
                id: "1".into(),
                subject: "verify@local: prove it".into(),
                status: "completed".into(),
                blocked_by: Vec::new(),
            }],
            session_id: Some("abc".into()),
            harness_version: Some("2.1.223".into()),
            seen: 7,
            understood: 5,
            finished_plans: 2,
            background: std::collections::HashMap::from([(
                "b1".to_string(),
                crate::agent::chain::OpenRun {
                    act: Act::Build,
                    refinement: Some("app:build".into()),
                    at: None,
                    failed: false,
                },
            )]),
            offset,
        }
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

        assert_eq!(ChainCache::default().resume(&path).offset, 0);
    }

    #[test]
    fn a_grown_file_resumes_with_everything_already_known() {
        // **The regression this test exists for.** The first version cached only `steps`, so from
        // the second poll onwards the plan and the tally were rebuilt from the few new lines alone:
        // a session with nineteen tracked tasks reported "keeps no plan", and coverage read 173/173
        // for a file where it was 275/392. Every accumulating field is asserted here, by name, so
        // adding one and forgetting the cache fails loudly.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "one\n");
        let cache = ChainCache::default();
        cache.store(&path, &parsed(4));

        std::fs::write(&path, "one\ntwo\n").expect("append");
        let kept = cache.resume(&path);

        assert_eq!(kept.offset, 4);
        assert_eq!(kept.steps.len(), 1, "steps");
        assert_eq!(kept.plan.len(), 1, "the plan — the field that was lost");
        assert_eq!(kept.seen, 7, "the tally");
        assert_eq!(kept.understood, 5, "and the understood half of it");
        assert_eq!(kept.finished_plans, 2, "how many lists came before");
        assert_eq!(
            kept.background.len(),
            1,
            "and what is still running — a build outlives many polls, so losing this on the second \
             one would mean the panel only ever knew about it for four seconds"
        );
        assert_eq!(kept.session_id.as_deref(), Some("abc"));
        assert_eq!(kept.harness_version.as_deref(), Some("2.1.223"));
    }

    #[test]
    fn a_file_that_shrank_is_read_again_from_the_start() {
        // A rewind, a rotation, or a truncation. Continuing from an offset past the end would read
        // nothing for ever and the chain would freeze without saying so.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "one\ntwo\nthree\n");
        let cache = ChainCache::default();
        cache.store(&path, &parsed(14));

        std::fs::write(&path, "one\n").expect("truncate");

        let fresh = cache.resume(&path);
        assert_eq!(fresh.offset, 0);
        assert!(fresh.plan.is_empty(), "and it starts genuinely empty");
    }

    #[test]
    fn a_replaced_file_is_read_again_even_at_the_same_length() {
        // `/clear` mints a new session id and therefore a new file; a replacement at the same size
        // is the case a length check alone would miss entirely.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "one\n");
        let cache = ChainCache::default();
        cache.store(&path, &parsed(4));

        std::fs::remove_file(&path).expect("remove");
        std::fs::write(&path, "two\n").expect("recreate");

        assert_eq!(
            cache.resume(&path).offset,
            0,
            "same name, same length, different file"
        );
    }

    #[test]
    fn a_vanished_file_asks_for_a_fresh_read_rather_than_failing() {
        let cache = ChainCache::default();
        assert_eq!(cache.resume(Path::new("/nowhere/at/all.jsonl")).offset, 0);
        // Storing one is a no-op rather than an error.
        cache.store(Path::new("/nowhere/at/all.jsonl"), &parsed(0));
    }

    #[test]
    fn clearing_forgets_everything() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write(dir.path(), "one\n");
        let cache = ChainCache::default();
        cache.store(&path, &parsed(4));

        cache.clear();

        assert_eq!(cache.resume(&path).offset, 0);
    }
}
