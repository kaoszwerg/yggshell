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
fn ticking_a_task_below_an_umlaut_uses_the_offset_the_view_actually_has() {
    // **The boundary counts UTF-16 code units, not bytes**, and this is the test that says so.
    //
    // The frontend's offsets come from mdast (`node.position.start.offset`) and are handed back to
    // `textarea.setSelectionRange`. Both count UTF-16 code units, and **neither can be made to count
    // anything else** — so the conversion belongs on this side, where the string is held anyway.
    //
    // One German word is enough to split the two apart: `Grüße` is five code units and seven bytes.
    // Every task below one was unreachable, and the user was told "that item is no longer a task"
    // about an item that was plainly right there.
    let temp = Temp::new("toggle-utf16");
    write(temp.root(), "p", "t", "- [ ] Grüße\n- [ ] zwei\n").unwrap();

    // 12 is what the view has for the second item. The byte offset would be 14.
    let done = toggle(temp.root(), "p", "t", 12).unwrap();

    assert!(done);
    assert_eq!(
        read(temp.root(), "p", "t").unwrap(),
        "- [ ] Grüße\n- [x] zwei\n"
    );
}

#[test]
fn a_search_hit_reports_the_offset_in_the_same_unit_the_caret_uses() {
    // The other direction of the same contract: a hit's offset is carried to `openNote` and lands in
    // `setSelectionRange`. Reported in bytes, it puts the caret further and further from the hit the
    // more non-ASCII text is above it — silently, because a caret in the wrong place looks like a
    // caret.
    let temp = Temp::new("search-utf16");
    write(temp.root(), "p", "t", "Grüße\nzwei\n").unwrap();

    let hits = search(temp.root(), "zwei");

    assert_eq!(hits.len(), 1);
    // "Grüße\n" is six code units and eight bytes.
    assert_eq!(hits[0].offset, 6);
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

#[test]
fn the_whole_tree_comes_back_in_one_call() {
    // **One IPC call, not one per file.** Opening the tool used to ask for the topic list per
    // project and then for each note's text separately — every one of them a round trip, and every
    // one of them running on Tauri's MAIN thread, so they could not even overlap. With two projects
    // and a handful of notes that is a visible wait before anything appears: "das laden des todo
    // widgets dauert extrem lange".
    let temp = Temp::new("tree");
    write(temp.root(), "p", "inbox", "- [ ] one\n").unwrap();
    write(temp.root(), "p", "later", "prose\n").unwrap();
    write(temp.root(), "q", "inbox", "- [ ] two\n").unwrap();

    let files = tree(temp.root(), &["p".to_string(), "q".to_string()]);

    assert_eq!(files.len(), 3);
    // Same order as `topics`: inbox first, and the projects in the order they were asked for.
    assert_eq!(files[0].project, "p");
    assert_eq!(files[0].topic, "inbox");
    assert_eq!(files[0].text, "- [ ] one\n");
    assert_eq!(files[2].project, "q");
}

#[test]
fn a_project_that_is_gone_does_not_take_the_others_with_it() {
    // A project can be renamed or deleted between the list and the read. One unreadable entry must
    // not empty the whole panel.
    let temp = Temp::new("tree2");
    write(temp.root(), "p", "inbox", "- [ ] one\n").unwrap();

    let files = tree(temp.root(), &["p".to_string(), "vanished".to_string()]);

    assert_eq!(files.len(), 1);
}

#[test]
fn an_image_with_no_path_is_refused_rather_than_read_as_a_directory() {
    // **The toolbar's own Image button writes `![]()`** — a template to fill in — so a half-finished
    // note is the ordinary case, not a malformed one. `dir.join("")` is the project directory, and
    // reading it produced `io error at : Is a directory (os error 21)` once a second in the log, with
    // an empty path in the message that named nothing.
    //
    // Found in a running dev build on 2026-08-04, from a note the maintainer had actually written.
    let temp = Temp::new("image-empty");

    assert!(images::read(temp.root(), "p", "").is_err());
    assert!(images::read(temp.root(), "p", "   ").is_err());
    assert!(images::read(temp.root(), "p", "assets").is_err());
}

/// Importing markdown somebody else wrote, with the pictures it points at.
///
/// **The interesting half is what is NOT copied.** A markdown file is content from anywhere, and the
/// destination is a repository that gets pushed to a remote — so a reference reaching outside the
/// file's own folder is the abuse case, not the edge case (ADR-PROJ-004).
mod import {
    use super::*;
    use crate::notes::import;

    /// A folder of markdown to import from, outside the notes root.
    fn source(tag: &str) -> Temp {
        Temp::new(tag)
    }

    fn put(dir: &Path, name: &str, text: &str) -> PathBuf {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn a_markdown_file_becomes_a_topic_of_the_chosen_project() {
        let notes = Temp::new("imp-notes");
        let from = source("imp-src");
        let file = put(from.root(), "ideas.md", "# Ideas\n\nsomething\n");

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].topic.as_deref(), Some("ideas"));
        assert_eq!(
            read(notes.root(), "p", "ideas").unwrap(),
            "# Ideas\n\nsomething\n"
        );
    }

    #[test]
    fn the_images_it_points_at_come_with_it_and_the_links_are_rewritten() {
        // The whole reason this is not "copy the file": a note whose pictures stayed behind is a
        // note full of broken images on the second machine, which is what the synced repository
        // exists to prevent.
        let notes = Temp::new("imp-img-notes");
        let from = source("imp-img-src");
        put(from.root(), "assets/shot.png", "PNG");
        let file = put(
            from.root(),
            "note.md",
            "text\n\n![a shot](assets/shot.png)\n",
        );

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 1);
        let written = read(notes.root(), "p", "note").unwrap();
        assert!(
            written.contains("![a shot](assets/1000-0-shot.png)"),
            "{written}"
        );
        assert!(project_dir(notes.root(), "p")
            .unwrap()
            .join("assets/1000-0-shot.png")
            .exists());
    }

    #[test]
    fn an_image_outside_the_notes_own_folder_is_never_copied() {
        // The one that matters. `![](../../.ssh/id_rsa)` in an offered file would otherwise put a
        // private key in a repository that is then PUSHED. The link is left exactly as it was — the
        // file is not read at all — and the user is told (ADR-PROJ-004).
        let notes = Temp::new("imp-out-notes");
        let from = source("imp-out-src");
        let secret = from.root().parent().unwrap().join("ygg-import-secret.txt");
        std::fs::write(&secret, "private").unwrap();
        let file = put(from.root(), "note.md", "![k](../ygg-import-secret.txt)\n");

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 0);
        assert_eq!(report[0].skipped.len(), 1);
        assert!(report[0].skipped[0].contains("ygg-import-secret.txt"));
        assert_eq!(
            read(notes.root(), "p", "note").unwrap(),
            "![k](../ygg-import-secret.txt)\n"
        );
        let _ = std::fs::remove_file(&secret);
    }

    #[test]
    fn a_topic_that_already_exists_is_refused_rather_than_overwritten() {
        // A note is the one thing here that cannot be regenerated. Skipped and named, never merged
        // and never clobbered.
        let notes = Temp::new("imp-clash-notes");
        let from = source("imp-clash-src");
        write(notes.root(), "p", "ideas", "mine\n").unwrap();
        let file = put(from.root(), "ideas.md", "theirs\n");

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert!(report[0].topic.is_none());
        assert_eq!(read(notes.root(), "p", "ideas").unwrap(), "mine\n");
    }

    #[test]
    fn a_folder_brings_the_markdown_directly_inside_it_and_no_deeper() {
        // Not recursive: a subfolder would have to be flattened, which collides, or mapped to nested
        // projects, which is a naming policy nobody asked for.
        let notes = Temp::new("imp-dir-notes");
        let from = source("imp-dir-src");
        put(from.root(), "one.md", "one\n");
        put(from.root(), "two.md", "two\n");
        put(from.root(), "deeper/three.md", "three\n");
        put(from.root(), "readme.txt", "not markdown\n");

        let report = import::run(notes.root(), "p", &[from.root().to_path_buf()], "1000");

        let mut topics: Vec<String> = report.iter().filter_map(|e| e.topic.clone()).collect();
        topics.sort();
        assert_eq!(topics, vec!["one".to_string(), "two".to_string()]);
    }

    #[test]
    fn the_same_image_referenced_twice_is_copied_once() {
        let notes = Temp::new("imp-dup-notes");
        let from = source("imp-dup-src");
        put(from.root(), "shot.png", "PNG");
        let file = put(
            from.root(),
            "note.md",
            "![](shot.png)\n\n![again](./shot.png)\n",
        );

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 1);
        let written = read(notes.root(), "p", "note").unwrap();
        assert_eq!(written.matches("assets/1000-0-shot.png").count(), 2);
    }

    #[test]
    fn a_reference_style_definition_is_rewritten_too() {
        // `![a][one]` with `[one]: shot.png` at the bottom is ordinary markdown, and a rewriter that
        // only understood the inline form would silently leave those images behind.
        let notes = Temp::new("imp-ref-notes");
        let from = source("imp-ref-src");
        put(from.root(), "shot.png", "PNG");
        let file = put(
            from.root(),
            "note.md",
            "![a][one]\n\n[one]: shot.png \"a title\"\n",
        );

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 1);
        let written = read(notes.root(), "p", "note").unwrap();
        assert!(
            written.contains("[one]: assets/1000-0-shot.png \"a title\""),
            "{written}"
        );
    }

    #[test]
    fn an_absolute_path_from_another_machine_is_found_by_name_in_the_notes_own_folder() {
        // **The case this feature is actually for, and the first real import failed on it.** A
        // markdown file exported by Typora on Windows carries links like
        // `C:\Users\…\OneDrive - …\Images\shot.png` — an absolute path on a machine that is not this
        // one. On macOS a backslash is not a separator, so the whole thing is one filename, nothing
        // resolves, and all 37 pictures were reported missing while sitting in `Images/` next to the
        // note the user had just picked.
        //
        // So the literal path is tried first and the **file name** is the fallback, looked up
        // **inside the note's own folder**. The boundary is untouched: the search never leaves that
        // folder, so an absolute path is only ever a hint about a name, never a way out.
        let notes = Temp::new("imp-win-notes");
        let from = source("imp-win-src");
        put(from.root(), "Images/shot.png", "PNG");
        let file = put(
            from.root(),
            "note.md",
            "![a](C:\\Users\\Someone\\OneDrive - Firma\\Images\\shot.png)\n",
        );

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 1);
        assert!(report[0].skipped.is_empty(), "{:?}", report[0].skipped);
        let written = read(notes.root(), "p", "note").unwrap();
        assert!(
            written.contains("![a](assets/1000-0-shot.png)"),
            "{written}"
        );
    }

    #[test]
    fn a_file_url_is_a_local_path_from_another_machine_not_a_remote_image() {
        // Word and Outlook paste `file:///C:/Users/…/Temp/msohtmlclip1/01/clip_image002.png`. Counted
        // as remote it was kept verbatim and reported as nothing at all — a dead link, since
        // `open_external` refuses every scheme but http(s). One of these was in the maintainer's own
        // first import.
        let notes = Temp::new("imp-fileurl-notes");
        let from = source("imp-fileurl-src");
        put(from.root(), "Images/clip_image002.png", "PNG");
        let file = put(
            from.root(),
            "note.md",
            "![c](file:///C:/Users/IhrDo/AppData/Local/Temp/msohtmlclip1/01/clip_image002.png)\n",
        );

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 1);
        assert!(read(notes.root(), "p", "note")
            .unwrap()
            .contains("assets/1000-0-clip_image002.png"));
    }

    #[test]
    fn a_file_url_with_nothing_behind_it_is_reported_rather_than_left_silently_dead() {
        let notes = Temp::new("imp-fileurl-miss-notes");
        let from = source("imp-fileurl-miss-src");
        let file = put(
            from.root(),
            "note.md",
            "![c](file:///C:/Temp/clip_image002.png)\n",
        );

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 0);
        assert_eq!(report[0].skipped.len(), 1);
        assert!(report[0].skipped[0].contains("clip_image002.png"));
    }

    #[test]
    fn a_name_that_is_not_in_the_folder_stays_missing_and_says_so() {
        let notes = Temp::new("imp-win-miss-notes");
        let from = source("imp-win-miss-src");
        let file = put(
            from.root(),
            "note.md",
            "![a](C:\\Users\\X\\Images\\gone.png)\n",
        );

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 0);
        assert_eq!(report[0].skipped.len(), 1);
        assert!(report[0].skipped[0].contains("gone.png"));
    }

    #[test]
    fn two_files_with_the_same_name_are_reported_rather_than_guessed_between() {
        // Copying the wrong picture into a note is worse than copying none: it is wrong *silently*,
        // and the note reads as finished.
        let notes = Temp::new("imp-amb-notes");
        let from = source("imp-amb-src");
        put(from.root(), "a/shot.png", "ONE");
        put(from.root(), "b/shot.png", "TWO");
        let file = put(from.root(), "note.md", "![a](C:\\Somewhere\\shot.png)\n");

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 0);
        assert!(
            report[0].skipped[0].contains("more than one"),
            "{:?}",
            report[0].skipped
        );
    }

    /// The maintainer's own failing import, reduced to the shapes it actually contained.
    ///
    /// `2026 07 alle Anpassungen ZRL.md`, exported by Typora on Windows: 37 pictures, every link an
    /// absolute `C:\…\OneDrive - Anders Coachen\…\Images\…png` **with spaces in it**, plus one
    /// `file:///C:/…/Temp/msohtmlclip1/…` pasted out of Word. All 37 were reported missing while
    /// sitting in `Images/` beside the note. Two separate defects, and this pins both together
    /// because it is their combination that made the feature useless on the first real file it met.
    #[test]
    fn the_shapes_a_real_windows_export_actually_contains() {
        let notes = Temp::new("imp-real-notes");
        let from = source("imp-real-src");
        put(
            from.root(),
            "Images/image-20260731131951079-1785514305914-4.png",
            "PNG",
        );
        put(from.root(), "Images/clip_image002.png", "PNG");
        let file = put(
            from.root(),
            "2026 07 alle Anpassungen ZRL.md",
            "text\n\n\
             ![image-20260731131951079](C:\\Users\\IhrDo\\OneDrive - Anders Coachen\\03 AndersCoachen\\02 Reaktiv2010\\Images\\image-20260731131951079-1785514305914-4.png)\n\n\
             ![clip](file:///C:/Users/IhrDo/AppData/Local/Temp/msohtmlclip1/01/clip_image002.png)\n",
        );

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(
            report[0].topic.as_deref(),
            Some("2026 07 alle Anpassungen ZRL")
        );
        assert_eq!(report[0].images, 2, "{:?}", report[0].skipped);
        assert!(report[0].skipped.is_empty(), "{:?}", report[0].skipped);

        let written = read(notes.root(), "p", "2026 07 alle Anpassungen ZRL").unwrap();
        // The link is replaced WHOLE — the old failure cut it at the first space and wrote
        // "- Anders Coachen\03 AndersCoachen\…" into the note as prose.
        assert!(!written.contains("OneDrive"), "{written}");
        assert!(!written.contains("msohtmlclip1"), "{written}");
        assert!(
            written.contains("![image-20260731131951079](assets/1000-0-image-20260731131951079-1785514305914-4.png)"),
            "{written}"
        );
        assert!(
            written.contains("![clip](assets/1000-1-clip_image002.png)"),
            "{written}"
        );
    }

    #[test]
    fn a_remote_image_is_left_exactly_as_it_was() {
        // Nothing is fetched during an import. A remote image keeps its URL and stays subject to the
        // press-to-load rule the reader already applies (ADR-PROJ-004).
        let notes = Temp::new("imp-remote-notes");
        let from = source("imp-remote-src");
        let file = put(from.root(), "note.md", "![](https://example.com/x.png)\n");

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 0);
        assert!(report[0].skipped.is_empty());
        assert_eq!(
            read(notes.root(), "p", "note").unwrap(),
            "![](https://example.com/x.png)\n"
        );
    }

    #[test]
    fn a_percent_escaped_path_is_still_found() {
        // Every markdown editor writes a screenshot's spaces as %20, and macOS names screenshots with
        // spaces. Not decoding it means the commonest pasted image in existence is "missing".
        let notes = Temp::new("imp-esc-notes");
        let from = source("imp-esc-src");
        put(from.root(), "two words.png", "PNG");
        let file = put(from.root(), "note.md", "![](two%20words.png)\n");

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert_eq!(report[0].images, 1);
        assert!(read(notes.root(), "p", "note")
            .unwrap()
            .contains("assets/1000-0-two words.png"));
    }

    #[test]
    fn something_that_is_not_markdown_is_reported_rather_than_ignored() {
        // A silent no-op is indistinguishable from a broken import.
        let notes = Temp::new("imp-not-md-notes");
        let from = source("imp-not-md-src");
        let file = put(from.root(), "notes.txt", "hello\n");

        let report = import::run(notes.root(), "p", &[file], "1000");

        assert!(report[0].topic.is_none());
        assert_eq!(report[0].skipped.len(), 1);
    }
}

#[test]
fn the_index_names_every_file_without_reading_any() {
    // What "move to" needs: names only. Reading every note in the repository to fill a menu would
    // make opening that menu the most expensive thing the tool does.
    let temp = Temp::new("index");
    write(temp.root(), "p", "inbox", "- [ ] one\n").unwrap();
    write(temp.root(), "q", "notes", "prose\n").unwrap();

    let index = index(temp.root());

    assert_eq!(index.len(), 2);
    assert!(index.iter().any(|f| f.project == "q" && f.topic == "notes"));
    assert!(index.iter().all(|f| f.text.is_empty()));
}
