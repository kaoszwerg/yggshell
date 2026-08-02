//! Against a temporary directory, never the real notes location.
//!
//! A test that can reach the maintainer's own notes is a defect (`rule:testing`), and this module's
//! whole job is writing files and committing them.

use super::*;

/// A notes root in a fresh temp directory, removed when the guard drops.
struct Temp(PathBuf);

impl Temp {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "ygg-notes-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        Self(dir)
    }
    fn root(&self) -> &Path {
        &self.0
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_project_is_its_remote_however_it_was_cloned() {
    // The same project must be the same folder on every machine. ssh and https forms of one
    // repository are the commonest way for that to silently split in two.
    assert_eq!(
        project_key("git@github.com:kaoszwerg/yggshell.git").as_deref(),
        Some("github.com/kaoszwerg/yggshell")
    );
    assert_eq!(
        project_key("https://github.com/kaoszwerg/yggshell").as_deref(),
        Some("github.com/kaoszwerg/yggshell")
    );
    assert_eq!(
        project_key("ssh://git@example.com/team/thing.git/").as_deref(),
        Some("example.com/team/thing")
    );
    assert_eq!(project_key("   "), None);
}

#[test]
fn a_name_cannot_climb_out_of_its_directory() {
    // `../..` as a topic must not become a file somewhere else. Refused rather than mangled: a name
    // that is only punctuation is a mistake worth reporting, not one worth guessing at.
    assert!(safe_segment("..").is_err());
    assert!(safe_segment("   ").is_err());
    assert_eq!(safe_segment("../etc/passwd").unwrap(), "-etc-passwd");
    assert_eq!(safe_segment(" release notes ").unwrap(), "release notes");
}

#[test]
fn nothing_can_be_written_outside_the_notes_root() {
    // The check that survives a refactor moving code between modules. The frontend never supplies a
    // path, so this is belt and braces — and `![](../../../etc/passwd)` in a pasted note is exactly
    // the abuse case it is braced against (ADR-PROJ-004).
    let temp = Temp::new("root");
    let outside = temp.root().parent().unwrap().join("elsewhere.md");
    assert!(within_root(temp.root(), &outside).is_err());
    assert!(within_root(temp.root(), &temp.root().join("a.md")).is_ok());
}

#[test]
fn a_capture_becomes_a_task_with_its_body_indented_under_it() {
    // Everything here is handed over and then done, which is what a checkbox says — and it is what
    // makes the done-fold work for a prompt as well as a chore. A multi-line thought stays one item.
    let temp = Temp::new("capture");
    capture(
        temp.root(),
        "proj",
        "ask about the frame\nit flickers after a resize",
    )
    .unwrap();

    let text = read(temp.root(), "proj", INBOX).unwrap();
    assert_eq!(
        text,
        "- [ ] ask about the frame\n      it flickers after a resize\n"
    );
}

#[test]
fn two_captures_do_not_run_into_each_other() {
    let temp = Temp::new("capture2");
    capture(temp.root(), "proj", "one").unwrap();
    capture(temp.root(), "proj", "two").unwrap();

    assert_eq!(
        read(temp.root(), "proj", INBOX).unwrap(),
        "- [ ] one\n- [ ] two\n"
    );
}

#[test]
fn an_empty_capture_is_refused_rather_than_filed() {
    let temp = Temp::new("capture3");
    assert!(capture(temp.root(), "proj", "   \n  ").is_err());
}

#[test]
fn ticking_rewrites_the_marker_and_nothing_else() {
    // Ticking is not editing: it flips `- [ ]` to `- [x]` in the file and leaves every other byte
    // alone. Taken as a byte offset rather than a line number, because a line number is wrong the
    // moment anything above it changes.
    let temp = Temp::new("toggle");
    write(temp.root(), "p", "t", "- [ ] one\n- [ ] two\n").unwrap();

    let done = toggle(temp.root(), "p", "t", 10).unwrap();

    assert!(done);
    assert_eq!(
        read(temp.root(), "p", "t").unwrap(),
        "- [ ] one\n- [x] two\n"
    );
}

#[test]
fn ticking_again_clears_it() {
    let temp = Temp::new("toggle2");
    write(temp.root(), "p", "t", "- [x] done\n").unwrap();

    assert!(!toggle(temp.root(), "p", "t", 0).unwrap());
    assert_eq!(read(temp.root(), "p", "t").unwrap(), "- [ ] done\n");
}

#[test]
fn a_stale_offset_is_refused_instead_of_editing_the_wrong_line() {
    // The view's idea of where an item is can be out of date — the file may have been pulled from
    // another machine since it was drawn. Rewriting three bytes at a position nobody checked is how
    // a note quietly loses a word.
    let temp = Temp::new("toggle3");
    write(
        temp.root(),
        "p",
        "t",
        "a paragraph, no tasks\n\n- [ ] later\n",
    )
    .unwrap();

    assert!(toggle(temp.root(), "p", "t", 0).is_err());
}

#[test]
fn a_note_that_was_never_written_reads_as_empty() {
    // An empty inbox and a note nobody has written to are the same thing to a reader; refusing would
    // make the first capture in a project a two-step affair.
    let temp = Temp::new("read");
    assert_eq!(read(temp.root(), "fresh", INBOX).unwrap(), "");
}

#[test]
fn projects_and_topics_come_back_with_the_inbox_first() {
    let temp = Temp::new("list");
    capture(temp.root(), "github.com/a/b", "x").unwrap();
    write(temp.root(), "github.com/a/b", "release", "- [ ] ship\n").unwrap();
    write(temp.root(), "github.com/a/b", "abc", "text\n").unwrap();

    assert_eq!(projects(temp.root()), vec!["github.com/a/b".to_string()]);
    assert_eq!(
        topics(temp.root(), "github.com/a/b").unwrap(),
        vec![
            "inbox".to_string(),
            "abc".to_string(),
            "release".to_string()
        ]
    );
}

#[test]
fn search_is_case_insensitive_and_says_where_it_found_it() {
    let temp = Temp::new("search");
    write(temp.root(), "p", "t", "nothing\nThe Frame flickers\n").unwrap();

    let hits = search(temp.root(), "frame");

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].topic, "t");
    assert_eq!(hits[0].line, "The Frame flickers");
    assert_eq!(hits[0].offset, "nothing\n".len());
}

#[test]
fn an_empty_query_finds_nothing_rather_than_everything() {
    let temp = Temp::new("search2");
    write(temp.root(), "p", "t", "anything\n").unwrap();
    assert!(search(temp.root(), "   ").is_empty());
}

#[test]
fn deleting_a_note_that_is_not_there_is_not_an_error() {
    let temp = Temp::new("delete");
    assert!(delete_note(temp.root(), "p", "gone").is_ok());
}

#[test]
fn a_remote_that_is_a_command_is_refused() {
    // `--upload-pack=…` is not a URL. Without this the settings field is an execution hole, however
    // carefully the argument list is built (ADR-PROJ-004).
    assert!(!git::valid_remote("--upload-pack=/bin/sh"));
    assert!(!git::valid_remote("-x"));
    assert!(!git::valid_remote("https://example.com/a\nrm -rf /"));
    assert!(!git::valid_remote(""));
    assert!(git::valid_remote("git@github.com:kaoszwerg/notes.git"));
    assert!(git::valid_remote("https://github.com/kaoszwerg/notes.git"));
}

#[test]
fn an_image_is_copied_in_and_referred_to_relatively() {
    // Copied, never referenced where it came from: a note pointing at ~/Desktop is broken on the
    // second machine and again the day the desktop is tidied.
    let temp = Temp::new("image");
    let source = temp.root().parent().unwrap().join("ygg-shot.png");
    std::fs::write(&source, b"not really a png").unwrap();

    let rel = images::add(temp.root(), "p", &source, "2026-08-02").unwrap();

    assert_eq!(rel, "assets/2026-08-02-ygg-shot.png");
    assert_eq!(
        images::read(temp.root(), "p", &rel).unwrap(),
        b"not really a png"
    );
    let _ = std::fs::remove_file(&source);
}

#[test]
fn an_image_path_cannot_climb_out_of_the_notes() {
    // The abuse case from the threat model, in the one place a path really is untrusted: it comes
    // out of a note's markdown, which arrives by paste from anywhere.
    let temp = Temp::new("image2");
    assert!(images::read(temp.root(), "p", "../../../etc/passwd").is_err());
}

#[test]
fn a_remote_image_is_never_read_from_disk() {
    let temp = Temp::new("image3");
    assert!(images::read(temp.root(), "p", "https://example.com/x.png").is_err());
}

#[test]
fn orphans_are_listed_and_the_referenced_ones_are_left_alone() {
    // Nothing is collected automatically: a note written on another machine and not yet pulled still
    // refers to its image, and this machine cannot see that note.
    let temp = Temp::new("orphans");
    let dir = project_dir(temp.root(), "p").unwrap().join(images::ASSETS);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("kept.png"), b"a").unwrap();
    std::fs::write(dir.join("lost.png"), b"bb").unwrap();
    write(temp.root(), "p", "t", "![shot](assets/kept.png)\n").unwrap();

    let found = images::orphans(temp.root());

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0, "p/assets/lost.png");
    assert_eq!(found[0].1, 2);
}

#[test]
fn cleaning_removes_only_what_was_named() {
    let temp = Temp::new("clean");
    let dir = project_dir(temp.root(), "p").unwrap().join(images::ASSETS);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("a.png"), b"a").unwrap();
    std::fs::write(dir.join("b.png"), b"b").unwrap();

    let removed = images::remove(temp.root(), &["p/assets/a.png".to_string()]).unwrap();

    assert_eq!(removed, 1);
    assert!(!dir.join("a.png").exists());
    assert!(dir.join("b.png").exists());
}
