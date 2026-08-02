//! The notes sync, against a real remote.
//!
//! **`#[ignore]` on purpose.** It needs the network and the user's own git credentials, which
//! `check:all` has neither of and must never depend on (`rule:automation`: the gate is local and
//! complete). It is here so the end-to-end path can be re-proved on demand, by the one command in
//! the doc comment below, rather than by remembering how.
//!
//! ```bash
//! cargo test --test notes_sync -- --ignored --nocapture
//! ```
//!
//! What it proves that a unit test cannot: that the app's own `connect`/`pull`/`push` reach a real
//! repository with no credentials of the app's own — every prompt disabled, `BatchMode` on, the URL
//! passed after `--` — and that what it wrote is actually there afterwards, read back from a second
//! clone rather than from the one that wrote it.

use std::path::Path;
use std::process::Command;
use yggshell_lib::notes;

/// The maintainer's own notes repository, created private for this feature.
const REMOTE: &str = "git@github.com:kaoszwerg/notes.git";

fn temp(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ygg-notes-e2e-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

/// Read one file out of a FRESH clone — never out of the clone that wrote it.
///
/// Reading back from the writer would prove only that the file is on this disk, which is the one
/// thing already known. The question is whether it reached the remote.
fn read_from_remote(rel: &str) -> Option<String> {
    let dir = temp("verify");
    let out = Command::new("git")
        .args(["clone", "--depth", "1", "--", REMOTE])
        .arg(&dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .output()
        .expect("run git clone");
    assert!(
        out.status.success(),
        "verification clone failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = std::fs::read_to_string(dir.join(rel)).ok();
    let _ = std::fs::remove_dir_all(&dir);
    text
}

#[test]
#[ignore = "needs the network and the user's git credentials"]
fn a_note_written_here_arrives_in_the_repository() {
    let data = temp("data");
    let clone = notes::clone_dir(&data);

    notes::git::connect(&clone, REMOTE, "main").expect("connect to the private notes repository");
    assert!(notes::git::is_clone(&clone), "the clone is not a clone");

    // Pull first, exactly as the app does: another machine may have written since.
    notes::git::pull(&clone).expect("pull");

    let root = notes::root(&data);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_secs();
    let marker = format!("end-to-end proof {stamp}");
    notes::capture(&root, "github.com/kaoszwerg/yggshell", &marker).expect("capture");

    let sent = notes::git::push(&clone, &format!("notes: e2e {stamp}")).expect("push");
    assert!(
        sent,
        "there was nothing to push, which means nothing was written"
    );

    let there = read_from_remote("notes/github.com/kaoszwerg/yggshell/inbox.md")
        .expect("the note is not in the repository");
    assert!(
        there.contains(&marker),
        "the note reached the repository without its text: {there}"
    );

    let _ = std::fs::remove_dir_all(&data);
}

#[test]
#[ignore = "needs the network"]
fn a_remote_that_is_a_command_never_reaches_git() {
    // The argument-injection surface, checked against the real `connect` rather than only against
    // `valid_remote`: `--upload-pack=…` is a command, not a URL, and the settings field would
    // otherwise be an execution hole (ADR-PROJ-004).
    let data = temp("inject");
    let clone = notes::clone_dir(&data);
    let refused = notes::git::connect(&clone, "--upload-pack=/bin/echo", "main");
    assert!(refused.is_err(), "a dashed argument was accepted as a URL");
    assert!(!Path::new(&clone).join(".git").exists(), "it cloned anyway");
    let _ = std::fs::remove_dir_all(&data);
}

#[test]
#[ignore = "needs the network and the user's git credentials"]
fn notes_written_before_a_remote_was_named_are_adopted_rather_than_clobbered() {
    // **The first path anyone actually takes**, and the one that failed on the maintainer's machine:
    // the tool works local-only until a URL is typed, so by the time they type one the directory is
    // full — and `git clone` refuses a non-empty destination with "already exists and is not an empty
    // directory". Reported from a running build, with a screenshot.
    //
    // What must hold: the local note is still there afterwards, byte for byte, and it reaches the
    // remote. Nothing may be checked out over a working tree that holds the only copy of something.
    let data = temp("adopt");
    let root = notes::root(&data);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_secs();
    let marker = format!("written before any remote {stamp}");
    notes::capture(&root, "github.com/kaoszwerg/yggshell", &marker).expect("capture");
    assert!(
        !notes::git::is_clone(&notes::clone_dir(&data)),
        "the fixture is not the situation being tested"
    );

    notes::git::connect(&notes::clone_dir(&data), REMOTE, "main").expect("adopt");

    // Still here, untouched — this is the assertion the whole design turns on.
    let local = notes::read(&root, "github.com/kaoszwerg/yggshell", "inbox").expect("read back");
    assert!(
        local.contains(&marker),
        "the local note did not survive: {local}"
    );

    notes::git::push(&notes::clone_dir(&data), &format!("notes: adopt {stamp}")).expect("push");
    let there = read_from_remote("notes/github.com/kaoszwerg/yggshell/inbox.md")
        .expect("the note is not in the repository");
    assert!(
        there.contains(&marker),
        "the adopted note never reached the remote"
    );

    let _ = std::fs::remove_dir_all(&data);
}
