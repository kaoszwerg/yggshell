//! Turning one tool call into one act of work.
//!
//! ## Classify the PROGRAM, never the command text
//!
//! The first attempt matched on the whole command string and counted `grep -n "test("` as a test
//! run — 78 relevant commands collapsed to 52 signatures, which is not a list anybody assigns by
//! hand. Matching the executable instead brought the same session to 28. The word "test" appears in
//! filenames, in grep patterns and in commit messages; the program does not lie about what it is.
//!
//! ## And a command is not one program
//!
//! Measured in this repository: **200 of 427 Bash calls (47 %) contain `&&`, `;` or `|`**, 9 begin
//! with `cd`, 6 with a variable assignment, 3 with a shell function definition. "The first token" is
//! therefore not the program in a third of all cases. Every segment is examined and the **most
//! significant** act wins — `foo && npm run check:all` is a gate, and the `foo` is noise.

use super::model::{Act, Kind, Step};

/// Programs that produce a step. Everything else is a probe.
///
/// Deliberately a small list of *tool families* rather than an attempt at completeness: an unknown
/// program is a `probe`, which is the honest answer and the one that degrades well (ADR-PROJ-005 §1:
/// less information, never a wrong one).
const RUNNERS: &[&str] = &[
    "playwright",
    "cypress",
    "vitest",
    "jest",
    "mocha",
    "pytest",
    "tox",
    "nox",
    "cargo",
    "go",
    "gradle",
    "mvn",
    "npm",
    "pnpm",
    "yarn",
    "bun",
    "deno",
    "eslint",
    "prettier",
    "rustfmt",
    "clippy",
    "tsc",
    "ruff",
    "mypy",
    "black",
    "flake8",
    "shellcheck",
    "docker",
    "podman",
    "kubectl",
    "helm",
    "terraform",
    "fly",
    "vercel",
    "git",
    "gh",
    "glab",
    "make",
    "just",
    "task",
    "rake",
];

/// Everything up to the first quote of a command.
///
/// **A mention is not a run.** Seen in the running app: a link labelled `verify app:dev"` — with the
/// quote still attached — because a command that merely *printed* the words `npm run app:dev` was
/// read as running them. `echo "…"`, a commit message, a `grep` pattern: all of them contain command
/// text that nothing executed.
///
/// Cutting at the first quote is deliberately blunt. A shell parser would be more accurate and would
/// be a shell parser; the interesting act of a compound command is almost always before its first
/// quoted argument, and everything this drops was going to be a `probe` anyway.
fn strip_quoted(command: &str) -> &str {
    command
        .find(['"', '\''])
        .map_or(command, |at| &command[..at])
}

/// One command, split into the segments a shell would run separately.
///
/// Only the three separators that actually sequence work. A redirect or a pipe *tail* (`| tail -60`)
/// is not a step — but the command feeding it is, which is why `|` splits and the classifier then
/// keeps the most significant side rather than the last.
pub fn segments(command: &str) -> Vec<&str> {
    strip_quoted(command)
        .split([';', '\n'])
        .flat_map(|part| part.split("&&"))
        .flat_map(|part| part.split("||"))
        .flat_map(|part| part.split('|'))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect()
}

/// The program a segment actually runs, with the wrappers and prefixes stripped.
///
/// `None` when the segment runs no program we would recognise — a bare assignment, a function
/// definition, an empty continuation.
pub fn program(segment: &str) -> Option<(&str, Vec<&str>)> {
    let mut rest = segment.trim();

    // Leading environment assignments and wrappers: `COVERAGE=off npx playwright …`,
    // `bash scripts/run-tests.sh backend`.
    //
    // **The assignment test looks at the name, not at the value.** An earlier version rejected any
    // word containing `/`, to avoid mistaking a path for an assignment — and thereby failed on
    // `TAO=~/.cargo/bin`, where the *value* is a path. What makes a word an assignment is that
    // everything before the first `=` is a variable name.
    //
    // `bash`/`sh` are wrappers here: `bash scripts/run-tests.sh` is the script's work, not the
    // shell's, and the script is what a project declares in `work-levels.json`.
    loop {
        let word = rest.split_whitespace().next()?;
        let is_assignment = word
            .split_once('=')
            .is_some_and(|(name, _)| !name.is_empty() && name.chars().all(is_name_char));
        let is_wrapper = matches!(
            word,
            "npx" | "bunx" | "env" | "time" | "sudo" | "nohup" | "bash" | "sh" | "zsh"
        );
        if !is_assignment && !is_wrapper {
            break;
        }
        rest = rest.get(word.len()..)?.trim_start();
    }

    let mut words = rest.split_whitespace();
    let raw = words.next()?;
    // `./scripts/run-tests.sh` and `scripts/run-tests.sh` are the same entrypoint.
    let name = raw.trim_start_matches("./");
    if name.is_empty() {
        return None;
    }
    Some((name, words.collect()))
}

/// The classification of one tool call, before any declaration is consulted.
///
/// Pure and total: every input yields a `Step`, and an unrecognised one is a `probe`. That is what
/// lets the caller count coverage honestly instead of silently dropping lines (ADR-PROJ-005 §1).
pub fn classify(tool: &str, command: Option<&str>, path: Option<&str>) -> Step {
    match tool {
        // Editing a file IS the making of the thing, whatever else the session is doing.
        "Edit" | "Write" | "NotebookEdit" => Step::new(Act::Edit, basename(path)),
        "Read" | "Glob" | "Grep" | "WebFetch" | "WebSearch" | "ToolSearch" => {
            Step::new(Act::Probe, None)
        }
        // A subagent is work this transcript does not contain — recorded as its own kind so the
        // chain can say so rather than showing a gap (chain-tool.md C3).
        "Agent" | "Task" => Step::new(Act::Delegate, None).with_kind(Kind::Delegated),
        "AskUserQuestion" => Step::new(Act::Probe, None).with_kind(Kind::Halt),
        "TaskCreate" | "TaskUpdate" | "TaskList" | "TaskGet" => {
            Step::new(Act::Plan, None).with_kind(Kind::Bookkeeping)
        }
        "Bash" => command.map_or_else(Step::unrecognised, classify_command),
        // A tool this reader has never met. Counted honestly rather than passed off as a probe.
        _ => Step::unrecognised(),
    }
}

/// The most significant act among a command's segments.
///
/// "Most significant" and not "last": a run piped into `tail` ends with `tail`, and a `cd x && cargo
/// test` ends with the test. Significance is the natural ordering of [`Act`] — shipping outranks
/// verifying outranks building outranks probing — so the interesting half of a compound command
/// survives regardless of where it sits.
fn classify_command(command: &str) -> Step {
    segments(command)
        .into_iter()
        .filter_map(classify_segment)
        .max_by_key(|step| step.act as u8)
        .unwrap_or_else(Step::unrecognised)
}

/// One segment, or `None` if it runs nothing recognisable.
fn classify_segment(segment: &str) -> Option<Step> {
    let (name, args) = program(segment)?;

    // A project script IS the entrypoint, and its first plain argument is the refinement the project
    // chose — `run-tests.sh backend`. Recognised before RUNNERS, because a project's own script is
    // more specific than any tool we could name.
    if name.ends_with(".sh") || name.ends_with(".mjs") || name.ends_with(".py") {
        let sub = args.iter().copied().find(|a| is_plain_argument(a));
        return Some(
            Step::new(Act::Verify, sub.map(str::to_string)).with_script(basename(Some(name))),
        );
    }

    let plain: Vec<&str> = args
        .iter()
        .copied()
        .filter(|a| is_plain_argument(a))
        .collect();

    let step = match name {
        "git" => match plain.first().copied() {
            Some("push") => Step::new(Act::Ship, Some("push".into())),
            Some("commit") | Some("add") | Some("stash") => {
                Step::new(Act::Ship, Some("commit".into()))
            }
            Some("tag") => Step::new(Act::Ship, Some("release".into())),
            Some("merge") | Some("rebase") | Some("cherry-pick") => {
                Step::new(Act::Ship, Some("merge".into()))
            }
            // status/diff/log/show/fetch — looking, not shipping.
            _ => Step::new(Act::Probe, None),
        },
        "gh" | "glab" => match (plain.first().copied(), plain.get(1).copied()) {
            // Opening a review and merging one are different acts to anybody watching: the first
            // hands work over, the second lands it.
            (Some("pr"), Some("create")) => Step::new(Act::Ship, Some("review".into())),
            (Some("pr"), Some("merge")) => Step::new(Act::Ship, Some("merge".into())),
            (Some("release"), _) => Step::new(Act::Ship, Some("release".into())),
            _ => Step::new(Act::Probe, None),
        },
        "playwright" | "cypress" => Step::new(Act::Verify, Some("e2e".into())),
        "vitest" | "jest" | "mocha" => Step::new(Act::Verify, Some("unit".into())),
        "pytest" | "tox" | "nox" => Step::new(Act::Verify, Some("unit".into())),
        "eslint" | "prettier" | "rustfmt" | "clippy" | "tsc" | "ruff" | "mypy" | "black"
        | "flake8" | "shellcheck" => Step::new(Act::Verify, Some("unit".into())),
        "cargo" | "go" | "gradle" | "mvn" => match plain.first().copied() {
            Some("test") => Step::new(Act::Verify, Some("unit".into())),
            Some("clippy") | Some("fmt") | Some("vet") | Some("audit") | Some("deny") => {
                Step::new(Act::Verify, Some("unit".into()))
            }
            Some("build") | Some("install") => Step::new(Act::Build, None),
            _ => Step::new(Act::Probe, None),
        },
        "npm" | "pnpm" | "yarn" | "bun" | "deno" => classify_package_runner(&plain),
        "docker" | "podman" => match plain.first().copied() {
            // `docker exec … pytest` is a test that happens to run in a container.
            Some("exec")
                if plain
                    .iter()
                    .any(|a| a.contains("pytest") || a.contains("test")) =>
            {
                Step::new(Act::Verify, Some("integration".into()))
            }
            Some("compose") if plain.get(1) == Some(&"up") => Step::new(Act::Ship, None),
            _ => Step::new(Act::Probe, None),
        },
        "kubectl" | "helm" | "terraform" | "fly" | "vercel" => {
            Step::new(Act::Ship, Some("deploy".into()))
        }
        "make" | "just" | "task" | "rake" => {
            let target = plain.first().copied().map(str::to_string);
            Step::new(Act::Verify, target)
        }
        _ => return None,
    };

    if !RUNNERS.contains(&name) {
        return None;
    }
    Some(step)
}

/// `npm run <script>` and friends: the script name is the refinement.
fn classify_package_runner(plain: &[&str]) -> Step {
    match plain.first().copied() {
        Some("run") => {
            let script = plain.get(1).copied().unwrap_or_default();
            Step::new(act_of_script(script), Some(script.to_string()))
        }
        Some("test") => Step::new(Act::Verify, Some("unit".into())),
        Some("audit") => Step::new(Act::Verify, Some("unit".into())),
        Some("install") | Some("ci") => Step::new(Act::Build, None),
        _ => Step::new(Act::Probe, None),
    }
}

/// What a package script name says it does.
///
/// **The namespace is a prefix, not a suffix, and that cost a wrong label.** `app:build` was read as
/// a check because the test was `starts_with("build")` — so the chain marked a release build as a
/// failed verification, and the following edit made it red. A project's scripts are named
/// `<area>:<verb>` at least as often as `<verb>:<area>`, so both ends are examined.
fn act_of_script(script: &str) -> Act {
    let verb = script.rsplit(':').next().unwrap_or(script);
    let head = script.split(':').next().unwrap_or(script);
    let makes = |word: &str| {
        matches!(
            word,
            "build" | "gen" | "sync" | "bundle" | "compile" | "dev" | "install"
        )
    };
    if makes(verb) || makes(head) {
        Act::Build
    } else {
        Act::Verify
    }
}

/// Whether a character may appear in a shell variable name.
fn is_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Whether a word is an argument that names something, rather than a flag or a redirect.
///
/// **`2>&1` is not a subtype**, and measuring a real session is what showed it: the chain carried a
/// link labelled `verify 2>&1` because the redirect is the first word that does not start with `-`.
fn is_plain_argument(word: &str) -> bool {
    !word.starts_with('-')
        && !word.starts_with('>')
        && !word.starts_with('<')
        && !word.contains(">&")
        && !word.chars().next().is_some_and(|c| c.is_ascii_digit())
}

/// The last path component, for a subtype a person recognises.
fn basename(path: Option<&str>) -> Option<String> {
    let path = path?;
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    (!name.is_empty()).then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_compound_command_is_split_where_a_shell_would_split_it() {
        // 47 % of the Bash calls in this repository contain one of these. Taking the first token
        // would classify `cd x && cargo test` as `cd`.
        let s = segments("cd /repo && COVERAGE=off cargo test 2>&1 | tail -40");
        assert_eq!(s.len(), 3);
        assert_eq!(s[0], "cd /repo");
        assert!(s[1].contains("cargo test"));
    }

    #[test]
    fn environment_prefixes_and_wrappers_are_not_the_program() {
        // Measured verbatim from a live session: `MASKEN_FILTER=CORE npx playwright test …`.
        let (name, args) =
            program("MASKEN_FILTER=CORE-BENUTZER npx playwright test admin/x.spec.js")
                .expect("a program");
        assert_eq!(name, "playwright");
        assert_eq!(args.first(), Some(&"test"));

        // `bash` is a wrapper too: `bash scripts/run-tests.sh` is the script's work, and the script
        // is what a project declares in `work-levels.json`.
        let (name, args) =
            program("COVERAGE=off bash scripts/run-tests.sh backend").expect("a program");
        assert_eq!(name, "scripts/run-tests.sh");
        assert_eq!(args.first(), Some(&"backend"));

        // The value of an assignment may itself be a path — the NAME is what makes it one.
        assert!(program("TAO=~/.cargo/bin").is_none());
    }

    #[test]
    fn a_segment_that_runs_no_program_is_not_a_step() {
        assert!(program("TAO=~/.cargo/bin").is_none(), "a bare assignment");
        assert!(program("").is_none());
        assert!(program("   ").is_none());
    }

    #[test]
    fn the_most_significant_act_in_a_compound_wins() {
        // The interesting half of a compound survives wherever it sits — a run piped into `tail`
        // ends with `tail`, and taking the last segment would classify the whole thing as a probe.
        let step = classify("Bash", Some("cargo test 2>&1 | tail -40"), None);
        assert_eq!(step.act, Act::Verify);

        let step = classify("Bash", Some("git add -A && git commit -m x"), None);
        assert_eq!(step.act, Act::Ship);

        // Shipping outranks verifying: a gate run before a push is one act of shipping.
        let step = classify("Bash", Some("npm run lint && git push"), None);
        assert_eq!(step.act, Act::Ship);
    }

    #[test]
    fn a_project_script_is_the_entrypoint_and_its_argument_is_the_refinement() {
        let step = classify("Bash", Some("bash scripts/run-tests.sh backend"), None);
        assert_eq!(step.act, Act::Verify);
        assert_eq!(step.refinement.as_deref(), Some("backend"));
    }

    #[test]
    fn grep_for_the_word_test_is_not_a_test_run() {
        // THE defect of the first attempt: matching the command text counted this as a test and
        // blew 78 commands up into 52 signatures.
        let step = classify(
            "Bash",
            Some(r#"grep -n "test(\|describe(" src/x.test.js"#),
            None,
        );
        assert_eq!(step.act, Act::Probe);

        let step = classify("Bash", Some("git add src/x.spec.js"), None);
        assert_eq!(step.act, Act::Ship, "adding a spec file is still a commit");
    }

    #[test]
    fn editing_a_file_is_building_and_carries_its_name() {
        let step = classify(
            "Edit",
            None,
            Some("/repo/src/components/UserManagement.jsx"),
        );
        // `edit`, not `build`. Reported from the running app: the chain said "build" while the agent
        // was changing a test file, and to a developer `build` means a compiler ran. Producing an
        // artefact is a different act and keeps that word.
        assert_eq!(step.act, Act::Edit);
        assert_eq!(step.refinement.as_deref(), Some("UserManagement.jsx"));
    }

    #[test]
    fn reading_and_searching_are_probes_and_that_is_the_default() {
        for tool in ["Read", "Grep", "Glob", "WebFetch", "SomethingUnheardOf"] {
            assert_eq!(classify(tool, None, None).act, Act::Probe, "{tool}");
        }
        // An unknown program degrades to a probe rather than being dropped — the honest answer, and
        // the one that keeps the coverage figure truthful (ADR-PROJ-005 §1).
        assert_eq!(
            classify("Bash", Some("heimdal restart nginx"), None).act,
            Act::Probe
        );
    }

    #[test]
    fn delegated_work_is_marked_because_this_transcript_does_not_contain_it() {
        // rule:agent-delegation makes fan-out the default, and a subagent's work lives in another
        // file. A gap that looks like "nothing happened" is worse than a marked gap.
        let step = classify("Agent", None, None);
        assert_eq!(step.kind, Kind::Delegated);
    }

    #[test]
    fn the_package_script_name_is_the_refinement() {
        let step = classify("Bash", Some("npm run check:all"), None);
        assert_eq!(step.act, Act::Verify);
        assert_eq!(step.refinement.as_deref(), Some("check:all"));

        let step = classify("Bash", Some("npm run build"), None);
        assert_eq!(step.act, Act::Build, "building is not verifying");
    }

    #[test]
    fn a_namespaced_script_is_read_at_both_ends() {
        // Seen in the running app: `app:build` was labelled a *verification*, because the test was
        // `starts_with("build")` and the namespace comes first. The chain then showed a release
        // build as a failed check, since the next thing anybody does after building is edit
        // something — and the following edge reads that as red.
        for building in [
            "npm run app:build",
            "npm run gen:types",
            "npm run build:web",
        ] {
            assert_eq!(
                classify("Bash", Some(building), None).act,
                Act::Build,
                "{building}"
            );
        }
        for checking in ["npm run check:all", "npm run test:e2e", "npm run lint"] {
            assert_eq!(
                classify("Bash", Some(checking), None).act,
                Act::Verify,
                "{checking}"
            );
        }
    }

    #[test]
    fn a_container_test_is_an_integration_test() {
        let step = classify(
            "Bash",
            Some("docker exec -w /app dev-backend python -m pytest tests/api/x.py"),
            None,
        );
        assert_eq!(step.act, Act::Verify);
        assert_eq!(step.refinement.as_deref(), Some("integration"));
    }

    #[test]
    fn git_reading_is_not_git_shipping() {
        // `git status` is by far the most frequent git call; counting it as a ship would put a
        // shipping act between every other step in the chain.
        for read in ["git status --short", "git diff HEAD", "git log --oneline"] {
            assert_eq!(classify("Bash", Some(read), None).act, Act::Probe, "{read}");
        }
        assert_eq!(
            classify("Bash", Some("gh pr create --base next"), None)
                .refinement
                .as_deref(),
            Some("review")
        );
    }

    #[test]
    fn a_mention_inside_a_string_is_not_a_run() {
        // Seen in the running app: a link labelled `verify app:dev"` — quote included — because a
        // command that only *printed* those words was read as running them.
        let step = classify("Bash", Some(r#"echo "npm run app:dev""#), None);
        assert_eq!(step.act, Act::Probe);

        // And the real thing still classifies, quoted argument and all.
        let step = classify("Bash", Some(r#"npm run check:all 2>&1 | tail -5"#), None);
        assert_eq!(step.act, Act::Verify);
        assert_eq!(step.refinement.as_deref(), Some("check:all"));

        let step = classify("Bash", Some(r#"git commit -m "npm run build""#), None);
        assert_eq!(
            step.act,
            Act::Ship,
            "the commit is the act, not its message"
        );
    }

    #[test]
    fn a_multiline_command_does_not_confuse_the_split() {
        // 33 of 427 measured calls are multi-line; a line-based reader would classify the heredoc
        // body.
        let step = classify(
            "Bash",
            Some("git commit -F - <<'EOF'\nsome message\nwith lines\nEOF"),
            None,
        );
        assert_eq!(step.act, Act::Ship);
    }
}
