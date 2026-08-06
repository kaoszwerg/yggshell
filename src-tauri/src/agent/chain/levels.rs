//! `work-levels.json` — what a project declares about its own runs.
//!
//! ## It may name, and it may escalate. It may never reassure.
//!
//! This file arrives by `git clone` and changes by pull request: it is **not** ours (ADR-PROJ-005
//! §4). And `rule:work-legibility` admits, in its own text, that its truthfulness cannot be checked
//! — *"a run named `unit` that quietly reaches a database is a lie the file cannot detect"*.
//!
//! So the declaration is authoritative for **labelling** — which act, which refinement — and for
//! *widening* the reach. Where the built-in heuristic recognises something that leaves this machine
//! and the file claims `@local`, the heuristic wins and the interface shows the **contradiction as a
//! contradiction**. The one question this file exists to answer is *"am I about to hit
//! production?"*, and a wrong answer there is the only failure in this feature worse than having no
//! feature at all.

use super::model::{ChainLink, Reach};
use serde::Deserialize;
use std::path::Path;

/// Caps applied before anything is parsed. The file is foreign input (ADR-PROJ-005 §4).
const MAX_BYTES: u64 = 256 * 1024;
const MAX_ENTRIES: usize = 512;
const MAX_STRING: usize = 200;

/// The declaration, as read from disk.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Levels {
    #[serde(default)]
    pub entrypoints: Vec<Entry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Entry {
    /// The command prefix as a person would type it.
    pub run: String,
    /// `act/refinement@target#area`.
    pub is: String,
    /// Required whenever the target is not `local`.
    #[serde(default)]
    pub reaches: Option<String>,
}

/// Targets in ascending order of how far they reach. The ordering is what makes "escalate only"
/// expressible.
fn rank(target: &str) -> u8 {
    match target {
        "local" => 0,
        "dev" => 1,
        "staging" => 2,
        "prod" => 3,
        _ => 0,
    }
}

impl Levels {
    /// Read the declaration a project ships, walking up from the tab's directory as a person would
    /// look for it. `None` when there is none — the common case, and not a failure.
    pub fn load(cwd: &Path) -> Option<Self> {
        let mut dir = Some(cwd);
        while let Some(current) = dir {
            let candidate = current.join("work-levels.json");
            if let Some(levels) = Self::read(&candidate) {
                tracing::debug!(
                    entries = levels.entrypoints.len(),
                    "read a work-levels declaration"
                );
                return Some(levels);
            }
            dir = current.parent();
        }
        None
    }

    /// Read one file, bounded and defensively.
    fn read(path: &Path) -> Option<Self> {
        let meta = std::fs::metadata(path).ok()?;
        // A regular file only: a FIFO would block `read_to_string` forever, and a symlink to a
        // device is the same trap wearing a different hat.
        if !meta.is_file() || meta.len() > MAX_BYTES {
            return None;
        }
        let text = std::fs::read_to_string(path).ok()?;
        let mut levels: Self = serde_json::from_str(&text).ok()?;
        levels.entrypoints.truncate(MAX_ENTRIES);
        for entry in &mut levels.entrypoints {
            entry.run.truncate(MAX_STRING);
            entry.is.truncate(MAX_STRING);
            if let Some(reaches) = entry.reaches.as_mut() {
                reaches.truncate(MAX_STRING);
                // Untrusted display data: a control character would let a repository put a terminal
                // escape sequence into somebody else's sidebar.
                reaches.retain(|c| !c.is_control());
            }
        }
        Some(levels)
    }

    /// Name a link from the declaration, and widen its reach — never narrow it.
    pub fn apply(&self, link: &mut ChainLink) {
        let Some(refinement) = link.refinement.clone() else {
            return;
        };
        let Some(entry) = self
            .entrypoints
            .iter()
            .find(|e| e.run.contains(refinement.as_str()))
        else {
            return;
        };
        let rest = entry
            .is
            .split_once('/')
            .map_or(entry.is.as_str(), |(_, rest)| rest);
        let declared = rest
            .split_once('@')
            .map_or("local", |(_, t)| t.split('#').next().unwrap_or(t));

        let heuristic = link.reach.as_ref().map_or(0, |r| rank(&r.target));
        let claimed = rank(declared);

        link.guessed = false;
        link.reach = Some(Reach {
            // The wider of the two, always. A declaration that claims something closer than the
            // heuristic recognised does not get to walk it back.
            target: if claimed >= heuristic {
                declared.to_string()
            } else {
                link.reach
                    .as_ref()
                    .map_or_else(|| declared.to_string(), |r| r.target.clone())
            },
            host: entry.reaches.clone(),
            disputed: claimed < heuristic,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::chain::model::{Act, Kind, Outcome};

    /// The BEL character, built rather than written.
    ///
    /// A raw control character in this source file would be invisible to the next reader, and — as
    /// this test discovered the hard way — would make the fixture invalid JSON, so the test would
    /// pass for the wrong reason.
    fn bel() -> char {
        char::from(7)
    }

    /// The six characters a hostile repository would actually ship to smuggle one in.
    fn bel_escape() -> String {
        format!("\\u{:04x}", bel() as u32)
    }

    fn link(refinement: &str, reach: Option<Reach>) -> ChainLink {
        ChainLink {
            act: Act::Verify,
            refinement: Some(refinement.to_string()),
            outcome: Outcome::Done,
            kind: Kind::Normal,
            reach,
            seconds: 0,
            steps: 1,
            noise: 0,
            iterations: None,
            rounds: Vec::new(),
            guessed: true,
        }
    }

    fn levels(json: &str) -> Levels {
        serde_json::from_str(json).expect("valid fixture")
    }

    #[test]
    fn a_declaration_names_a_link_and_stops_it_being_a_guess() {
        let l = levels(
            r#"{"entrypoints":[{"run":"npm run test:e2e","is":"verify/e2e@dev","reaches":"localhost:3000"}]}"#,
        );
        let mut link = link("test:e2e", None);

        l.apply(&mut link);

        assert!(!link.guessed);
        let reach = link.reach.expect("a reach");
        assert_eq!(reach.target, "dev");
        assert_eq!(reach.host.as_deref(), Some("localhost:3000"));
        assert!(!reach.disputed);
    }

    #[test]
    fn a_declaration_may_widen_the_reach() {
        let l = levels(
            r#"{"entrypoints":[{"run":"deploy","is":"ship/deploy@prod","reaches":"app.example.com"}]}"#,
        );
        let mut link = link(
            "deploy",
            Some(Reach {
                target: "local".into(),
                host: None,
                disputed: false,
            }),
        );

        l.apply(&mut link);

        assert_eq!(link.reach.expect("a reach").target, "prod");
    }

    #[test]
    fn a_declaration_may_never_narrow_it_and_the_contradiction_is_kept() {
        // THE rule of this module. A cloned repository claiming that its deploy is local must not
        // be able to turn a production run green in somebody's sidebar (ADR-PROJ-005 §4).
        let l = levels(r#"{"entrypoints":[{"run":"deploy","is":"verify/unit@local"}]}"#);
        let mut link = link(
            "deploy",
            Some(Reach {
                target: "prod".into(),
                host: Some("app.example.com".into()),
                disputed: false,
            }),
        );

        l.apply(&mut link);

        let reach = link.reach.expect("a reach");
        assert_eq!(reach.target, "prod", "the heuristic wins");
        assert!(
            reach.disputed,
            "and the disagreement is shown, not resolved"
        );
    }

    #[test]
    fn an_oversized_or_irregular_file_is_ignored_rather_than_read() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("work-levels.json");
        std::fs::write(&path, "x".repeat((MAX_BYTES + 1) as usize)).expect("write");

        assert!(Levels::read(&path).is_none());
        assert!(Levels::read(&dir.path().join("nothing.json")).is_none());
    }

    #[test]
    fn a_declaration_that_is_not_json_costs_the_declaration_and_not_the_feature() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("work-levels.json");
        std::fs::write(&path, "{ this is not json").expect("write");

        assert!(Levels::read(&path).is_none());
    }

    #[test]
    fn foreign_strings_are_capped_and_stripped() {
        // The file comes from a cloned repository, so its strings are display data written by
        // another party. The control character is written ESCAPED on purpose: that form parses
        // cleanly into a real BEL, reaches our string, and would otherwise put a terminal escape
        // sequence into somebody else's sidebar.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("work-levels.json");
        let long = "a".repeat(500);
        let smuggled = bel_escape();
        std::fs::write(
            &path,
            format!(
                r#"{{"entrypoints":[{{"run":"x","is":"verify/unit@dev","reaches":"h{smuggled}{long}"}}]}}"#
            ),
        )
        .expect("write");

        let declaration = Levels::read(&path).expect("a bounded declaration");
        let reaches = declaration.entrypoints[0]
            .reaches
            .as_deref()
            .expect("a host");

        assert!(reaches.len() <= MAX_STRING, "capped");
        assert!(!reaches.chars().any(char::is_control), "stripped");
    }

    #[test]
    fn a_raw_control_character_makes_the_document_invalid_and_it_is_refused() {
        // The other half, and it comes free: JSON forbids a raw control character inside a string,
        // so serde rejects the whole file before any of our own bounds are reached.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("work-levels.json");
        let raw = bel();
        std::fs::write(
            &path,
            format!(
                r#"{{"entrypoints":[{{"run":"x","is":"verify/unit@dev","reaches":"h{raw}i"}}]}}"#
            ),
        )
        .expect("write");

        assert!(Levels::read(&path).is_none());
    }

    #[test]
    fn the_declaration_is_found_by_walking_up_as_a_person_would() {
        let dir = tempfile::tempdir().expect("tempdir");
        let deep = dir.path().join("src/components");
        std::fs::create_dir_all(&deep).expect("dirs");
        std::fs::write(
            dir.path().join("work-levels.json"),
            r#"{"entrypoints":[{"run":"npm run test","is":"verify/unit@local"}]}"#,
        )
        .expect("write");

        assert!(Levels::load(&deep).is_some());
    }

    #[test]
    fn no_declaration_anywhere_is_not_a_failure() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(Levels::load(dir.path()).is_none());
    }
}
