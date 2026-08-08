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

/// The words that identify a command, with the noise a person does not think of removed.
///
/// Neither string is canonical: a project writes `npm run test:e2e`, the agent typed
/// `npx playwright test --project=admin`, and the reader reduced it to `playwright test admin`.
///
/// **Flag names go, and so does a flag's separate value — that second half was missing and it cost a
/// production deploy its label.** Reported from `lysisai-dsp`: the declaration read
/// `gh workflow run deploy-hetzner.yml -f environment=lysis-portal-demo`, the command that must
/// actually be typed there is `gh workflow run deploy-hetzner.yml --ref next -f environment=… -f
/// image_tag=next …`, and `--ref` was dropped while **`next` was not**. The value then stood where
/// the declaration expected `environment=…`, so every word after it compared against the wrong one.
/// Any flag with a detached value shifted the whole tail.
///
/// A value attached with `=` is kept, because that is where the identifying part usually lives
/// (`environment=lysis-portal-prod` is the entire difference between two levels of work).
fn words(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut drop_next = false;
    for word in s.split_whitespace() {
        if word.starts_with('-') {
            // `-f environment=x` carries its value in the NEXT word and that word matters;
            // `--ref next` carries one that does not. Telling them apart is not possible from the
            // flag alone, so the rule is the one that cannot lose information: a following word that
            // looks like `key=value` is kept, anything else is that flag's value and goes with it.
            drop_next = !word.contains('=');
            continue;
        }
        if drop_next {
            drop_next = false;
            if !word.contains('=') {
                continue;
            }
        }
        let word = word.trim_start_matches("./");
        if matches!(word, "npx" | "bunx" | "bash" | "sh" | "env") {
            continue;
        }
        out.push(word.to_string());
    }
    out
}

/// How many of a declaration's words an observed command carries, or `None` if it is a different
/// entrypoint.
///
/// **A subsequence, not a prefix, and that is the fix for the report above.** The declaration names
/// the words that *identify* a level; a real command carries more, and they can sit anywhere —
/// between the workflow file and its environment, at the end, in any order the tool accepts. Every
/// declared word must appear, in order, and anything extra is ignored.
///
/// **The count is still what makes the answer safe.** Eleven entries of the form
/// `gh workflow run <file> -f environment=<name>` all share their first words, so a caller that
/// stopped at the first match reported a production deploy as the image build listed above it —
/// measured against a real declaration. The longest agreement is the specific one, and specificity
/// is the whole reason those entries exist separately.
///
/// **One direction only: every declared word must be there.** The reverse — accepting a command that
/// is *missing* something the declaration names — was in the prefix version and is a mistake the
/// subsequence form makes visible: `gh workflow run deploy.yml` is not the entry that says
/// `-f environment=lysis-portal-prod`, it is a different and more general invocation. Allowing it
/// would also undo the specificity ordering, because the general entry would then match everything.
fn shared_prefix(declared: &str, observed: &str) -> Option<usize> {
    let (a, b) = (words(declared), words(observed));
    if a.is_empty() || b.is_empty() {
        return None;
    }
    subsequence(&a, &b)
}

/// How many words of `needle` appear in `haystack`, in order — `None` unless all of them do.
fn subsequence(needle: &[String], haystack: &[String]) -> Option<usize> {
    let mut at = 0;
    for word in haystack {
        if needle.get(at) == Some(word) {
            at += 1;
        }
    }
    (at == needle.len()).then_some(at)
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

    /// The declaration and the command from the report, verbatim.
    ///
    /// `lysisai-dsp`, 2026-08-08: six production deploys, all declared, none of them in the chain.
    /// The four extra arguments are not sloppiness — without `--ref` the workflow pulls plugin
    /// bundles from the wrong branch, which put two environments into maintenance mode on 07.08.
    /// So the short form in the declaration is a form nobody may ever type.
    const DEPLOY_DECLARED: &str =
        "gh workflow run deploy-hetzner.yml -f environment=lysis-portal-demo";
    const DEPLOY_TYPED: &str = "gh workflow run deploy-hetzner.yml --ref next -f environment=lysis-portal-demo -f image_tag=next -f deploy_ref=next -f plugins=calendar,conversations";

    #[test]
    fn a_flags_detached_value_no_longer_shifts_every_word_behind_it() {
        // **The measured cause, and it was not the one the report guessed.** `--ref` is dropped as a
        // flag — but `next`, its value, was not, so it stood where the declaration expected
        // `environment=…` and everything after compared against the wrong word.
        assert_eq!(
            words("gh workflow run deploy.yml --ref next -f environment=prod"),
            vec!["gh", "workflow", "run", "deploy.yml", "environment=prod"],
            "the flag AND its detached value go; a key=value stays, because that is the identity"
        );
        assert_eq!(
            words("npm run test -- --watch"),
            vec!["npm", "run", "test"],
            "and a bare `--` separator takes nothing with it that matters"
        );
    }

    #[test]
    fn extra_arguments_anywhere_do_not_break_the_match() {
        // A declaration names the words that IDENTIFY a level. A real command carries more, and they
        // sit wherever the tool accepts them — which is why this is a subsequence and not a prefix.
        assert!(shared_prefix(DEPLOY_DECLARED, DEPLOY_TYPED).is_some());
    }

    #[test]
    fn the_specific_environment_still_wins_over_the_general_entry() {
        // The property the prefix version was protecting, and it must survive: eleven entries share
        // their first words, and reporting a production deploy as the image build above it is the
        // failure that made the count exist.
        let l = levels(
            r#"{"entrypoints":[
                {"run":"gh workflow run deploy-hetzner.yml","is":"build@local"},
                {"run":"gh workflow run deploy-hetzner.yml -f environment=lysis-portal-demo","is":"ship/deploy@staging","reaches":"demo.lysis.ai"},
                {"run":"gh workflow run deploy-hetzner.yml -f environment=lysis-portal-prod","is":"ship/deploy@prod","reaches":"portal.lysis.ai"}
            ]}"#,
        );

        let mut link = link(DEPLOY_TYPED, None);
        l.apply(&mut link);

        let reach = link.reach.expect("the declaration names it");
        assert_eq!(reach.target, "staging", "the demo entry, not the bare one");
        assert_eq!(reach.host.as_deref(), Some("demo.lysis.ai"));
    }

    #[test]
    fn a_command_missing_the_declarations_identifying_word_does_not_match() {
        // The other half of "extra arguments are ignored": something the declaration names and the
        // command does not have is a DIFFERENT entrypoint, not a looser match.
        assert!(shared_prefix(
            DEPLOY_DECLARED,
            "gh workflow run deploy-hetzner.yml --ref next"
        )
        .is_none());
        assert!(shared_prefix(
            DEPLOY_DECLARED,
            "gh workflow run other.yml -f environment=lysis-portal-demo"
        )
        .is_none());
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
