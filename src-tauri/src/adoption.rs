//! Handing `work-legibility` to a repository that has never heard of it.
//!
//! ## Why this exists at all
//!
//! The convention is only worth anything if it reaches the projects the maintainer actually works
//! in — and those projects **do not consume this repository's governance**. Most of them have their
//! own, and none of them depend on the layer that would carry an update. A governance cascade
//! therefore cannot deliver it, however many layers it has.
//!
//! What *can* reach an arbitrary repository is the thing sitting in front of both of them: this app.
//! It is open on the directory in question, and it ships the files.
//!
//! ## Two channels, and the split is deliberate
//!
//! - **The gate is a file, so it is written.** It is machinery: the same script that runs in this
//!   repository's own `check:all`, bundled from that one source so what ships is provably the one
//!   that works.
//! - **The rule is text, so it is copied.** It goes into another agent's context — through the
//!   clipboard, into a chat that may be on another machine entirely — with an instruction to install
//!   it in *its* project-level governance. That is the only channel that crosses a repository
//!   boundary without needing a network, a dependency or write access to somebody else's code.
//!
//! ## What this deliberately does NOT do
//!
//! **It does not write `work-levels.json`.** The obvious move is to scan `package.json` and a
//! `Makefile` and fill one in — and it is exactly the guess the rule forbids: whether a run
//! truthfully says `unit` or quietly reaches a database is a judgement only somebody standing in
//! that repository can make, and `rule:work-legibility` says so in its own text. An app-written
//! declaration would be a file full of confident `@local` claims that nobody checked, which is worse
//! than no file: the tool would stop saying it is guessing.

use crate::error::{AppError, Result};
use std::path::{Path, PathBuf};

/// The manual, as shipped.
///
/// **A document, not a string literal in this file.** It is the app's *output* — the manual a
/// foreign agent reads — so it is edited, reviewed and diffed as prose, next to the other things
/// this app ships. Held in Rust it was unreadable in a diff, which is how a paragraph goes missing.
pub const HANDOVER: &str = "resources/adoption/handover.md";

/// The convention itself: the very file this repository lives under, front-matter and all.
pub const RULE: &str = "resources/adoption/work-legibility.md";

/// The grammar check, bundled from the path that already runs in this repository's own gate.
pub const GATE: &str = "resources/adoption/check-work-levels.mjs";

/// Strip a leading YAML front-matter block, if there is one.
///
/// **This is what lets the shipped rule be the same file this repository lives under.** There were
/// two copies for a while — the governed one and a stripped "adoption" copy — and they drifted 120
/// lines apart before anyone compared them, at which point the app was bundling the stale one. One
/// source, and the difference between the two audiences is four lines of parsing rather than a file
/// nobody remembers to update (ADR-CORE-005).
///
/// Front-matter belongs to the system that reads it: the receiving project has its own, or none.
fn without_front_matter(text: &str) -> &str {
    let Some(rest) = text.strip_prefix("---\n") else {
        return text;
    };
    match rest.find("\n---\n") {
        Some(end) => rest[end + "\n---\n".len()..].trim_start_matches('\n'),
        // An opening fence with no close is not front-matter; handing back the whole document is
        // the answer that loses nothing.
        None => text,
    }
}

/// The whole handover, as it should arrive in another agent's context.
///
/// **The manual first, then the rule.** The agent receiving this is in another repository, possibly
/// on another machine, and will never see the panel this came from: it did not press the button and
/// cannot be told anything a second time. So the manual carries everything the interface knows —
/// what makes it legible, which files exist and where, how to run the check, what to write next —
/// and the rule carries the convention itself, unchanged from the one this repository lives under.
pub fn rule_text(handover: &Path, bundled_rule: &Path) -> Result<String> {
    let manual = std::fs::read_to_string(handover)
        .map_err(|e| AppError::io(handover.display().to_string(), e))?;
    let body = std::fs::read_to_string(bundled_rule)
        .map_err(|e| AppError::io(bundled_rule.display().to_string(), e))?;
    Ok(format!("{manual}\n{}", without_front_matter(&body)))
}

/// Where the gate is written in a foreign repository.
///
/// `scripts/` because it is the most widely understood place for one, and the report says where it
/// landed so it can be moved: this app cannot know where a project keeps its checks, and pretending
/// otherwise would be the same guess `work-levels.json` is spared above.
fn gate_destination(repo: &Path) -> PathBuf {
    repo.join("scripts/check-work-levels.mjs")
}

/// Whether this repository already declares its levels.
///
/// **Walks up, exactly as the reader does** (`chain::levels::Levels::load`). A tab sitting in
/// `frontend/` of a monorepo whose declaration is at the root would otherwise be told it has none,
/// and offered a second one — two files, disagreeing, in the same repository. Two answers to one
/// question is the defect; which answer is right matters less than that there is one.
pub fn declares_levels(cwd: &Path) -> bool {
    let mut dir = Some(cwd);
    while let Some(current) = dir {
        if current.join("work-levels.json").is_file() {
            return true;
        }
        dir = current.parent();
    }
    false
}

/// Put the gate into `repo` and say where it went.
///
/// The path comes from a terminal's reported working directory, so it is validated here rather than
/// trusted: it must exist and be a directory (rule:security — canonicalise, then check). A file is
/// **not** silently promoted to its parent, unlike a launch path: this writes, and writing somewhere
/// the caller did not mean is the failure worth refusing outright.
pub fn install_gate(repo: &Path, bundled_gate: &Path) -> Result<PathBuf> {
    let repo = repo
        .canonicalize()
        .map_err(|e| AppError::io(repo.display().to_string(), e))?;
    if !repo.is_dir() {
        return Err(AppError::Other(format!(
            "{} is not a directory",
            repo.display()
        )));
    }
    let destination = gate_destination(&repo);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::io(parent.display().to_string(), e))?;
    }
    std::fs::copy(bundled_gate, &destination)
        .map_err(|e| AppError::io(destination.display().to_string(), e))?;
    tracing::info!(gate = %destination.display(), "installed the work-levels gate into a repository");
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, body).expect("write");
        path
    }

    /// The manual exactly as it ships. Read from the repository rather than mocked, because the
    /// question this test asks is whether **the delivered file** is complete.
    fn shipped_handover() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(HANDOVER)
    }

    #[test]
    fn the_rule_arrives_with_an_instruction_and_its_whole_text() {
        let dir = tempfile::tempdir().expect("tempdir");
        let rule = bundled(
            dir.path(),
            "rule.md",
            "# Every piece of work says what it is\n",
        );

        let text = rule_text(&shipped_handover(), &rule).expect("the rule");

        // **Everything the receiving agent cannot get anywhere else.** It is in another repository,
        // did not press the button, will never see the panel, and cannot be told a second time — so
        // anything missing here is knowledge that never arrives. The list is deliberately literal:
        // a paragraph quietly edited out of the manual fails here rather than in six months, in
        // somebody else's repository, silently.
        assert!(
            text.contains("TaskCreate"),
            "how to make the plan half work at all — without a task list there is no plan"
        );
        assert!(
            text.contains("entrypoints the project declares"),
            "why running the declared script rather than its runner matters"
        );
        assert!(
            text.contains("project-level governance"),
            "what to do with the rule"
        );
        assert!(
            text.contains("check-work-levels.mjs"),
            "which other file exists, and where"
        );
        assert!(
            text.contains("node scripts/check-work-levels.mjs"),
            "how to run it — a file nobody knows how to invoke is not delivered"
        );
        assert!(
            text.contains("repository root"),
            "where the declaration goes"
        );
        assert!(text.contains("work-levels.json"), "and what to write next");
        assert!(
            text.contains("reaches"),
            "the one field that can hurt somebody when it is wrong"
        );
        assert!(
            text.ends_with("# Every piece of work says what it is\n"),
            "the rule itself, whole"
        );
    }

    #[test]
    fn the_manual_names_the_paths_this_code_actually_uses() {
        // **Half of the anti-drift, and the half a grammar check cannot see.** The manual tells a
        // foreign agent where the two files are; this code is what puts them there. Renaming either
        // without touching the other would leave a confident manual pointing at nothing — and the
        // agent it misleads is in a different repository, with no way to ask.
        let manual = std::fs::read_to_string(shipped_handover()).expect("the shipped manual");

        let gate = gate_destination(Path::new("/r"));
        let gate = gate.strip_prefix("/r").expect("relative");
        assert!(
            manual.contains(&gate.to_string_lossy().to_string()),
            "the manual must name the path install_gate writes to"
        );
        assert!(
            manual.contains("work-levels.json"),
            "and the file declares_levels looks for"
        );
    }

    #[test]
    fn the_governed_rule_ships_without_its_front_matter() {
        // The receiving project has its own governance system, or none — `id:`/`load:`/`triggers:`
        // are addressed to ours and would arrive as noise. Stripping them here is what allows ONE
        // file to serve both, which the two drifted copies before it did not.
        let dir = tempfile::tempdir().expect("tempdir");
        let rule = bundled(
            dir.path(),
            "rule.md",
            "---\nid: rule:work-legibility\nload: core\n---\n\n# Every piece of work says what it is\n",
        );
        let handover = shipped_handover();

        let text = rule_text(&handover, &rule).expect("the rule");

        assert!(!text.contains("rule:work-legibility"), "no front-matter");
        assert!(text.contains("# Every piece of work says what it is"));
    }

    #[test]
    fn a_document_without_front_matter_survives_whole() {
        assert_eq!(without_front_matter("# Title\n"), "# Title\n");
        // An opening fence that never closes is not front-matter, and cutting on it would silently
        // deliver half a rule.
        assert_eq!(
            without_front_matter("---\nid: x\n# Title\n"),
            "---\nid: x\n# Title\n"
        );
    }

    #[test]
    fn a_missing_bundled_rule_is_an_error_rather_than_an_empty_clipboard() {
        // Copying nothing and reporting success is the silent failure this refuses: the user pastes
        // an empty buffer into another agent and cannot tell why nothing happened.
        assert!(rule_text(&shipped_handover(), &PathBuf::from("/nowhere/rule.md")).is_err());
        assert!(rule_text(&PathBuf::from("/nowhere/manual.md"), &shipped_handover()).is_err());
    }

    #[test]
    fn the_gate_lands_in_the_repository_and_says_where() {
        let dir = tempfile::tempdir().expect("tempdir");
        let gate = bundled(dir.path(), "check.mjs", "// the gate\n");
        let repo = tempfile::tempdir().expect("repo");

        let written = install_gate(repo.path(), &gate).expect("installed");

        assert!(written.ends_with("scripts/check-work-levels.mjs"));
        assert_eq!(
            std::fs::read_to_string(&written).expect("read"),
            "// the gate\n"
        );
    }

    #[test]
    fn a_second_run_updates_the_gate_rather_than_refusing() {
        // It is our file and it is versioned with the app: a fix to it must reach a repository that
        // already has an older copy, or the fix only reaches whoever adopted last week.
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = tempfile::tempdir().expect("repo");
        install_gate(repo.path(), &bundled(dir.path(), "a.mjs", "old\n")).expect("first");

        let written =
            install_gate(repo.path(), &bundled(dir.path(), "b.mjs", "new\n")).expect("second");

        assert_eq!(std::fs::read_to_string(&written).expect("read"), "new\n");
    }

    #[test]
    fn a_path_that_is_not_a_directory_is_refused_rather_than_written_near() {
        let dir = tempfile::tempdir().expect("tempdir");
        let gate = bundled(dir.path(), "check.mjs", "x");
        let file = bundled(dir.path(), "not-a-repo.txt", "x");

        assert!(install_gate(&file, &gate).is_err());
        assert!(install_gate(&dir.path().join("gone"), &gate).is_err());
    }

    #[test]
    fn a_declaration_is_noticed_only_when_it_is_a_file() {
        let repo = tempfile::tempdir().expect("repo");
        assert!(!declares_levels(repo.path()));

        std::fs::create_dir(repo.path().join("work-levels.json"))
            .expect("a directory of that name");
        assert!(
            !declares_levels(repo.path()),
            "a directory of that name is not a declaration"
        );
    }

    #[test]
    fn a_declaration_further_up_still_counts() {
        // The reader walks up from the working directory, so this must too. A tab in `frontend/`
        // being offered a second declaration, while the root already has one, is two files
        // disagreeing inside one repository.
        let repo = tempfile::tempdir().expect("repo");
        let deep = repo.path().join("frontend/src");
        std::fs::create_dir_all(&deep).expect("dirs");
        std::fs::write(repo.path().join("work-levels.json"), "{}").expect("write");

        assert!(declares_levels(&deep));
    }
}
