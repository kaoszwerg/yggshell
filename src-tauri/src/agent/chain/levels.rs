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

/// Whether a declared `run` and an observed command are the same entrypoint.
///
/// Neither string is canonical: a project writes `npm run test:e2e`, the agent typed
/// `npx playwright test --project=admin`, and the reader reduced it to `playwright test admin`. So
/// the comparison is on **words**, and one being a prefix of the other is enough — a declaration
/// naming fewer words is the more general statement and should still match.
fn words(s: &str) -> Vec<String> {
    s.split_whitespace()
        .filter(|w| !w.starts_with('-'))
        .map(|w| w.trim_start_matches("./").to_string())
        .filter(|w| !matches!(w.as_str(), "npx" | "bunx" | "bash" | "sh" | "env"))
        .collect()
}

/// How many leading words a declared `run` and an observed command share, or `None` if they are
/// different entrypoints.
///
/// **The count is what makes the answer safe.** Eleven entries of the form
/// `gh workflow run <file> -f environment=<name>` all share their first three words, so a caller
/// that stopped at the first match reported a production deploy as the image build listed above it —
/// measured against a real declaration. The longest agreement is the specific one, and specificity
/// is the whole reason those entries exist separately.
fn shared_prefix(declared: &str, observed: &str) -> Option<usize> {
    let (a, b) = (words(declared), words(observed));
    if a.is_empty() || b.is_empty() {
        return None;
    }
    let shared = a.iter().zip(b.iter()).take_while(|(x, y)| x == y).count();
    // One of the two must be a prefix of the other: a shorter declaration is the more general
    // statement and still matches, but a disagreement inside the overlap is a different command.
    (shared == a.len().min(b.len())).then_some(shared)
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

    /// The act and refinement a project declares for a command, if it declares one.
    ///
    /// **This is what makes a declaration more than a relabelling.** The heuristic knows a fixed set
    /// of programs, and a project's own runner is not in it: measured against lysisai-dsp, 16 of its
    /// 59 entrypoints — every `python3 scripts/…`, every `node scripts/…`, and the whole `./heimdal`
    /// vocabulary — produced no step at all, so there was no link for `apply` to label and a
    /// correctly written declaration changed nothing. The file exists to name what cannot be
    /// guessed; until this, it could only rename what already had been.
    pub fn classify(&self, command: &str) -> Option<(super::model::Act, Option<String>)> {
        let entry = self
            .entrypoints
            .iter()
            .filter_map(|e| shared_prefix(&e.run, command).map(|shared| (shared, e)))
            .max_by_key(|(shared, _)| *shared)
            .map(|(_, e)| e)?;
        let head = entry.is.split(['@', '#']).next().unwrap_or(&entry.is);
        let (act, refinement) = match head.split_once('/') {
            Some((act, refinement)) => (act, Some(refinement.to_string())),
            None => (head, None),
        };
        super::model::Act::parse(act).map(|act| (act, refinement))
    }

    /// Name a link from the declaration, and widen its reach — never narrow it.
    pub fn apply(&self, link: &mut ChainLink) {
        // **Matched on the command, not on the refinement.** A refinement is a category — `cargo
        // test` becomes `unit` — so matching on it meant a declaration listing `npm run test` found
        // nothing, and a project that had written one still saw almost every link marked as guessed.
        // Only entries whose refinement happened to also be a script name worked, which made the
        // bug look like an inconsistency.
        let Some(signature) = link.signature.clone() else {
            return;
        };
        let Some(entry) = self
            .entrypoints
            .iter()
            .filter_map(|e| shared_prefix(&e.run, &signature).map(|shared| (shared, e)))
            .max_by_key(|(shared, _)| *shared)
            .map(|(_, e)| e)
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

    /// A link as the reader actually produces one: the command it ran, and a refinement that is a
    /// **category** rather than that command.
    ///
    /// The gap between the two arguments is the point. `apply` once matched on the refinement, so a
    /// project that had written a declaration still saw nearly every link marked as a guess —
    /// `cargo test` becomes `unit`, and no entry lists `unit` as its `run`. Keeping them different
    /// here means a return to that would fail every test below.
    fn link(command: &str, reach: Option<Reach>) -> ChainLink {
        ChainLink {
            act: Act::Verify,
            refinement: Some("unit".to_string()),
            signature: Some(command.to_string()),
            outcome: Outcome::Done,
            kind: Kind::Normal,
            compacts: 0,
            reported: None,
            seconds_live: 0,
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
        // Verbatim what `classify_segment` writes for this command (`classify.rs`): the program plus
        // its first two plain arguments. The fixture is that string and not a prettier one, because a
        // declaration is matched against exactly this.
        let mut link = link("npm run test:e2e", None);

        l.apply(&mut link);

        assert!(!link.guessed);
        let reach = link.reach.expect("a reach");
        assert_eq!(reach.target, "dev");
        assert_eq!(reach.host.as_deref(), Some("localhost:3000"));
        assert!(!reach.disputed);
    }

    #[test]
    fn the_most_specific_declaration_wins_not_the_first_one_listed() {
        // **The defect this module exists to prevent, found in a real declaration.** Eleven entries
        // of the form `gh workflow run <file> -f environment=<name>` share their first three words;
        // taking the first match reported a deploy to a production host as the image build listed
        // above it. `reaches` is the one field that can hurt somebody when it is wrong.
        let l = levels(
            r#"{"entrypoints":[
                {"run":"gh workflow run build-images.yml","is":"build@local"},
                {"run":"gh workflow run deploy.yml -f environment=staging","is":"ship/deploy@staging","reaches":"testing.example.com"},
                {"run":"gh workflow run deploy.yml -f environment=prod","is":"ship/deploy@prod","reaches":"portal.example.com"}
            ]}"#,
        );
        let mut link = link("gh workflow run deploy.yml environment=prod", None);

        l.apply(&mut link);

        let reach = link.reach.expect("a reach");
        assert_eq!(reach.target, "prod");
        assert_eq!(reach.host.as_deref(), Some("portal.example.com"));
    }

    #[test]
    fn a_command_that_disagrees_inside_the_overlap_is_a_different_entrypoint() {
        let l = levels(r#"{"entrypoints":[{"run":"npm run test:e2e","is":"verify/e2e@local"}]}"#);
        let mut link = link("npm run test:unit", None);

        l.apply(&mut link);

        assert!(link.guessed, "no declaration claimed this one");
    }

    #[test]
    fn a_declaration_may_widen_the_reach() {
        let l = levels(
            r#"{"entrypoints":[{"run":"npm run deploy","is":"ship/deploy@prod","reaches":"app.example.com"}]}"#,
        );
        let mut link = link(
            "npm run deploy",
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
        let l = levels(r#"{"entrypoints":[{"run":"npm run deploy","is":"verify/unit@local"}]}"#);
        let mut link = link(
            "npm run deploy",
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
