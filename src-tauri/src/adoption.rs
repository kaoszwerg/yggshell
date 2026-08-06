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

/// What an agent is told when the rule lands in its context.
///
/// It is prepended rather than written into the rule itself: the rule is a **document about a
/// convention** and must read the same wherever it ends up, while this is an instruction to one
/// agent at one moment. Merging them would put "install me" into a file that has already been
/// installed.
const PREAMBLE: &str = "\
Install the rule below into this repository's own project-level governance — wherever the agents
working here read their rules (`CLAUDE.md`, `AGENTS.md`, a rules directory). It is self-supporting:
it names no stack, needs no tooling and cites nothing outside itself. If your governance expects
front-matter, add whatever fields it wants.

Then write this repository's `work-levels.json` from what is already here, following the rule. Do
not rename anything: a project declares what it has. The one field to get right is `reaches` —
anything whose target is not `local` says where it actually goes.

---

";

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

/// The rule as it should arrive in another agent's context.
pub fn rule_text(bundled_rule: &Path) -> Result<String> {
    let body = std::fs::read_to_string(bundled_rule)
        .map_err(|e| AppError::io(bundled_rule.display().to_string(), e))?;
    Ok(format!("{PREAMBLE}{}", without_front_matter(&body)))
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
pub fn declares_levels(repo: &Path) -> bool {
    repo.join("work-levels.json").is_file()
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

    #[test]
    fn the_rule_arrives_with_an_instruction_and_its_whole_text() {
        let dir = tempfile::tempdir().expect("tempdir");
        let rule = bundled(
            dir.path(),
            "rule.md",
            "# Every piece of work says what it is\n",
        );

        let text = rule_text(&rule).expect("the rule");

        assert!(
            text.contains("project-level governance"),
            "an agent pasted this into a chat needs to be told what to do with it"
        );
        assert!(text.contains("work-levels.json"), "and what to write next");
        assert!(
            text.ends_with("# Every piece of work says what it is\n"),
            "the rule itself, whole"
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

        let text = rule_text(&rule).expect("the rule");

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
        assert!(rule_text(&PathBuf::from("/nowhere/rule.md")).is_err());
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
}
