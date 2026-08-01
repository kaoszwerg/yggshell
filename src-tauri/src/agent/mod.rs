//! Reading what the AI harness in a terminal tab is doing.
//!
//! This is the tool the product exists for (mem:project-scope): the terminal shows a *flow*, and
//! what is missing is the *state*. Coming back after twenty minutes should not mean scrolling back
//! three hundred lines to find out where the session got to.
//!
//! ## The Claude home belongs to the TAB, never to the machine
//!
//! The maintainer runs several Claude accounts side by side, separated by `CLAUDE_CONFIG_DIR` and
//! selected per project by direnv. Measured: two complete homes exist (`~/.claude` and
//! `~/.claude-privat`), and four projects each name one of them. **A tool that hard-codes
//! `~/.claude` therefore shows the wrong account in three of those four — and shows it plausibly,
//! which is worse than showing nothing.**
//!
//! The home is found from the `.envrc` that declares it, walking upwards from the tab's directory
//! exactly as direnv does; failing that, from whichever home actually holds a transcript for this
//! project. Reading the running shell's environment would be the obvious route and is not available:
//! see `declared_home`.
//!
//! ## The transcript format carries no promise
//!
//! `<home>/projects/<slug>/<session>.jsonl` is Claude Code's own working file, not an API. Every
//! read here is defensive: an unknown shape yields *less* information, never an error and never a
//! crash. If it changes, this tool goes quiet — the app does not.

pub mod direnv;
pub mod hooks;
pub mod usage;

use crate::dto::AgentSession;
use std::path::{Path, PathBuf};

/// Which Claude home a directory belongs to.
///
/// **Measured first, because the obvious answer does not work.** The natural place to look is the
/// environment of the tab's own shell — that is where direnv puts `CLAUDE_CONFIG_DIR`. macOS does
/// not hand a process's environment to anyone else: `ps eww` returned nothing for a child process
/// this very code had just spawned with a known variable set. So reading it from the running shell
/// is not an option on the platform this app is developed on, and an approach that only works on
/// Linux is not an approach.
///
/// What *is* readable is the **declaration**: the `.envrc` sitting in the project. That is where the
/// user wrote the decision down, it is the same file direnv reads, and it is true whether or not
/// direnv has run yet — which the environment is not, for a terminal opened before the first prompt.
///
/// The walk goes upwards, exactly as direnv's does: a repository root usually carries the file and
/// every directory below it inherits it.
pub fn declared_home(cwd: &Path) -> Option<PathBuf> {
    let mut dir = Some(cwd);
    while let Some(current) = dir {
        let envrc = current.join(".envrc");
        if let Ok(text) = std::fs::read_to_string(&envrc) {
            if let Some(home) = parse_envrc(&text) {
                tracing::debug!(file = %envrc.display(), "a .envrc names a claude home");
                return Some(expand_home(&home));
            }
        }
        dir = current.parent();
    }
    None
}

/// Pull `CLAUDE_CONFIG_DIR` out of an `.envrc`.
///
/// Deliberately *not* a shell interpreter. An `.envrc` is arbitrary code, and running it to find out
/// what it sets would mean executing a file this app merely found on disk — which is precisely the
/// thing direnv's own approval mechanism exists to prevent. This recognises the one form the
/// decision is actually written in and ignores everything else: a value it cannot read plainly is a
/// value it does not claim to know.
pub fn parse_envrc(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.starts_with('#'))
        .find_map(|line| {
            let rest = line
                .strip_prefix("export ")
                .unwrap_or(line)
                .strip_prefix("CLAUDE_CONFIG_DIR=")?;
            let value = rest.trim().trim_matches('"').trim_matches('\'');
            // A value built from other variables ($FOO, $(cmd)) is not one we can resolve without
            // running the file. `$HOME` is the one exception, because it is what everybody writes.
            if value.is_empty() || (value.contains('$') && !value.starts_with("$HOME")) {
                return None;
            }
            Some(value.to_string())
        })
}

/// Resolve a leading `$HOME` or `~`, and nothing else.
fn expand_home(value: &str) -> PathBuf {
    let Some(home) = std::env::var_os("HOME") else {
        return PathBuf::from(value);
    };
    let home = PathBuf::from(home);
    if let Some(rest) = value
        .strip_prefix("$HOME/")
        .or_else(|| value.strip_prefix("~/"))
    {
        return home.join(rest);
    }
    if value == "$HOME" || value == "~" {
        return home;
    }
    PathBuf::from(value)
}

/// Every Claude home on this machine, newest transcript first for `cwd`.
///
/// The fallback when nothing is declared, and the honest one: rather than assuming `~/.claude`, look
/// at which home actually has a transcript for this project and prefer the one that was written to
/// most recently. On a machine with a single account this is `~/.claude` anyway; on the maintainer's
/// it is the account that has genuinely been used here.
pub fn homes_for(home_dir: &Path, cwd: &Path) -> Vec<PathBuf> {
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    let Ok(entries) = std::fs::read_dir(home_dir) else {
        return Vec::new();
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        // `.claude`, `.claude-privat`, `.claude-work` — the convention the maintainer already uses.
        if !name.starts_with(".claude") || !path.is_dir() {
            continue;
        }
        let project = project_dir(&path, cwd);
        let Some(newest) = transcripts_by_age(&project)
            .first()
            .and_then(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
        else {
            continue;
        };
        found.push((newest, path));
    }
    found.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    found.into_iter().map(|(_, path)| path).collect()
}

/// Point a project at a Claude home by writing the declaration direnv reads.
///
/// **What this actually does, stated plainly:** it writes one `export` line into a file that direnv
/// will EXECUTE on entering the directory. That is a meaningful thing for an application to do, and
/// it is bounded here as tightly as the feature allows:
///
/// - **Only one line is ours.** An existing `.envrc` is preserved in full; the
///   `CLAUDE_CONFIG_DIR` line is replaced if present and appended if not. The maintainer's own file
///   carries a `source_env_if_exists` line that must survive being pointed at a different account.
/// - **A backup first**, whenever there was something to lose. This edits a file the user wrote.
/// - **`$HOME`, not an absolute path**, because that is what the existing files say and what makes
///   them portable between machines.
///
/// Returns the path written, so the caller can tell the user exactly what changed.
pub fn declare_home(project: &Path, home: &Path) -> std::io::Result<PathBuf> {
    let envrc = project.join(".envrc");
    let existing = std::fs::read_to_string(&envrc).unwrap_or_default();
    if !existing.is_empty() {
        // Timestamped by content rather than by clock: two edits in the same second must not
        // overwrite each other's backup.
        let backup = envrc.with_extension(format!("envrc.ygg-backup-{}", existing.len()));
        std::fs::write(&backup, &existing)?;
        tracing::info!(backup = %backup.display(), "backed up an existing .envrc before editing it");
    }
    std::fs::write(&envrc, rewrite_envrc(&existing, &home_relative(home)))?;
    tracing::info!(file = %envrc.display(), home = %home.display(), "declared a claude home");
    Ok(envrc)
}

/// Write `$HOME/x` where the path is under the home directory, so the file stays portable.
fn home_relative(home: &Path) -> String {
    let Some(user_home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return home.to_string_lossy().to_string();
    };
    match home.strip_prefix(&user_home) {
        Ok(rest) => format!("$HOME/{}", rest.display()),
        Err(_) => home.to_string_lossy().to_string(),
    }
}

/// Replace the `CLAUDE_CONFIG_DIR` line, or append one, leaving everything else untouched.
///
/// Split out from the file handling so the one part that can silently destroy a user's work — the
/// rewriting — is tested on its own, against the shapes their files actually have.
pub fn rewrite_envrc(existing: &str, value: &str) -> String {
    let line = format!("export CLAUDE_CONFIG_DIR={value}");
    let mut replaced = false;
    let mut out: Vec<String> = existing
        .lines()
        .map(|raw| {
            let trimmed = raw.trim();
            let names_it = !trimmed.starts_with('#')
                && trimmed
                    .strip_prefix("export ")
                    .unwrap_or(trimmed)
                    .starts_with("CLAUDE_CONFIG_DIR=");
            if names_it && !replaced {
                replaced = true;
                line.clone()
            } else {
                raw.to_string()
            }
        })
        .collect();
    if !replaced {
        // Ahead of the rest, because a `source_env_if_exists` at the end of the file should be able
        // to override what we set — the user's own line is the more specific one.
        out.insert(0, line);
        if out.len() > 1 && !out[1].trim().is_empty() {
            out.insert(1, String::new());
        }
    }
    let mut text = out.join("\n");
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text
}

/// The directory Claude Code keeps a project's transcripts in.
///
/// The slug is the absolute path with every separator replaced by a dash — verified against a live
/// installation: `/Users/steve/git-projects/private/yggshell` becomes
/// `-Users-steve-git-projects-private-yggshell`.
pub fn project_dir(home: &Path, cwd: &Path) -> PathBuf {
    let slug: String = cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c == '/' || c == '\\' { '-' } else { c })
        .collect();
    home.join("projects").join(slug)
}

/// The transcripts in a directory, most recently written first.
///
/// "Most recent" by modification time rather than by name: the files are named by session id, which
/// says nothing about order.
fn transcripts_by_age(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().is_none_or(|e| e != "jsonl") {
                return None;
            }
            let modified = entry.metadata().and_then(|m| m.modified()).ok()?;
            Some((modified, path))
        })
        .collect();
    found.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    found.into_iter().map(|(_, path)| path).collect()
}

/// The newest transcript that actually has a session in it.
///
/// **Not simply the newest file, and that distinction is the whole defect it fixes.** A project
/// directory holds one transcript per session, and plenty of them contain no assistant turn at all:
/// a `claude -p` one-shot, a session opened and abandoned, a `/usage` query. Measured on this very
/// machine — the newest file for this project was 5 kB with zero turns while the live session sat
/// beside it at 25 MB with dozens. Taking the newest by timestamp therefore showed "no agent has run
/// here" at random, depending on what else had touched the directory, which is exactly how it was
/// reported: sometimes it notices, sometimes it does not.
///
/// **Bounded by what it reads, never by how many files it opens** — and that is the second half of
/// the same defect. Counting candidates loses a race against the user's own typing: every slash
/// command mints its own transcript, ~5 kB with no assistant turn in it, newer than the live session.
/// Measured while this was written — five of the six newest files in a working project were exactly
/// that, one per minute of work, leaving the live session a single file away from invisible. Any
/// fixed count is the same bug with more headroom.
///
/// A budget does not have that failure mode: a cheap file draws on it in proportion to what it cost,
/// so a thousand slash commands still cannot crowd out the answer, while genuinely large transcripts
/// stop the walk quickly — which is what the bound is actually for.
fn newest_session(dir: &Path) -> Option<(PathBuf, AgentSession)> {
    let mut spent: u64 = 0;
    for path in transcripts_by_age(dir) {
        if spent >= SEARCH_BUDGET {
            // Not silent: the answer is "no agent here", and this is the one case where that is a
            // give-up rather than a fact (rule:logging).
            tracing::debug!(
                dir = %dir.display(),
                spent,
                "gave up looking for a live session before reaching the end of the directory"
            );
            break;
        }
        let Some(text) = read_tail(&path, TAIL_BYTES) else {
            continue;
        };
        spent += text.len() as u64;
        if let Some(session) = parse_tail(&text) {
            return Some((path, session));
        }
    }
    None
}

/// How much may be read, in total, while looking for the live session.
///
/// Sixteen full tails. The bound has to exist — a project accumulates one transcript per session
/// forever, and answering "what is happening now" may not get more expensive every month. It is
/// deliberately generous in *files*: at the ~5 kB a slash command leaves behind, this is several
/// hundred of them, which is the flood it exists to survive.
const SEARCH_BUDGET: u64 = 16 * TAIL_BYTES;

/// How much of the end of a transcript to read.
///
/// A live session was measured at 11 702 lines; reading all of it to answer "what is happening now"
/// would be several megabytes per poll. The tail carries the answer, and everything here degrades to
/// "unknown" rather than to a wrong value if it does not.
const TAIL_BYTES: u64 = 256 * 1024;

/// What the harness in this project is doing, as far as its transcript says.
///
/// `None` when there is no Claude home, no project directory, or no transcript — all of which mean
/// "no agent has run here", which is not a failure.
pub fn session(home: &Path, cwd: &Path) -> Option<AgentSession> {
    let (path, mut session) = newest_session(&project_dir(home, cwd))?;
    tracing::debug!(transcript = %path.display(), turns = session.turns, "read an agent session");
    session.home = home.to_string_lossy().to_string();
    Some(session)
}

/// Read the last `bytes` of a file, starting at a line boundary.
///
/// A partial first line is dropped rather than parsed: half a JSON object is not an object, and
/// feeding it to a parser to see what happens is how a reader ends up trusting a half-read value.
pub(crate) fn read_tail(path: &Path, bytes: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let from = len.saturating_sub(bytes);
    file.seek(SeekFrom::Start(from)).ok()?;
    let mut buffer = String::new();
    // Lossy on purpose: a multi-byte character cut in half by the seek must not lose the whole tail.
    let mut raw = Vec::new();
    file.read_to_end(&mut raw).ok()?;
    buffer.push_str(&String::from_utf8_lossy(&raw));
    if from > 0 {
        // Drop whatever came before the first newline — it is the tail of a line we did not read.
        let start = buffer.find('\n').map_or(buffer.len(), |at| at + 1);
        buffer = buffer.split_off(start);
    }
    Some(buffer)
}

/// Build a session summary from the tail of a transcript.
///
/// Every field is optional and every lookup is defensive: this reads a private working file that may
/// change shape without notice, and the contract with the user is that the tool goes quiet rather
/// than lying or failing.
pub fn parse_tail(text: &str) -> Option<AgentSession> {
    let mut model: Option<String> = None;
    let mut branch: Option<String> = None;
    let mut last_at: Option<String> = None;
    let mut context: Option<u64> = None;
    let mut output_tokens: u64 = 0;
    let mut turns: u32 = 0;
    let mut session_id: Option<String> = None;

    for line in text.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        turns += 1;
        if let Some(id) = value.get("sessionId").and_then(|v| v.as_str()) {
            session_id = Some(id.to_string());
        }
        if let Some(at) = value.get("timestamp").and_then(|v| v.as_str()) {
            last_at = Some(at.to_string());
        }
        if let Some(b) = value.get("gitBranch").and_then(|v| v.as_str()) {
            if !b.is_empty() {
                branch = Some(b.to_string());
            }
        }
        let message = value.get("message");
        if let Some(m) = message
            .and_then(|m| m.get("model"))
            .and_then(|v| v.as_str())
        {
            model = Some(m.to_string());
        }
        if let Some(usage) = message.and_then(|m| m.get("usage")) {
            let read = |key: &str| usage.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
            // What the model actually had in front of it on this turn: everything cached plus what
            // was sent fresh. This is the number that decides when a compact is due.
            let total = read("input_tokens")
                + read("cache_read_input_tokens")
                + read("cache_creation_input_tokens");
            if total > 0 {
                context = Some(total);
            }
            output_tokens += read("output_tokens");
        }
    }

    if turns == 0 {
        return None;
    }
    Some(AgentSession {
        session_id,
        model,
        branch,
        last_at,
        context_tokens: context,
        output_tokens,
        turns,
        home: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_envrc_names_the_account_a_project_belongs_to() {
        // The maintainer's own file, verbatim. This is where the decision is written down, and it
        // is readable whether or not direnv has run yet.
        let text =
            "export CLAUDE_CONFIG_DIR=$HOME/.claude-privat\n\nsource_env_if_exists .envrc.local\n";
        assert_eq!(parse_envrc(text), Some("$HOME/.claude-privat".to_string()));
    }

    #[test]
    fn the_forms_people_actually_write_are_all_read() {
        assert_eq!(
            parse_envrc("CLAUDE_CONFIG_DIR=/opt/claude"),
            Some("/opt/claude".to_string())
        );
        assert_eq!(
            parse_envrc("export CLAUDE_CONFIG_DIR=\"/opt/my claude\""),
            Some("/opt/my claude".to_string())
        );
        assert_eq!(
            parse_envrc("  export CLAUDE_CONFIG_DIR=~/.claude-work  "),
            Some("~/.claude-work".to_string())
        );
    }

    #[test]
    fn a_value_it_cannot_read_plainly_is_not_claimed_to_be_known() {
        // This is NOT a shell. An `.envrc` is arbitrary code, and running it to find out what it sets
        // is exactly what direnv's approval mechanism exists to prevent.
        assert_eq!(
            parse_envrc("export CLAUDE_CONFIG_DIR=$SOME_OTHER_VAR"),
            None
        );
        assert_eq!(
            parse_envrc("export CLAUDE_CONFIG_DIR=$(pick-account)"),
            None
        );
        assert_eq!(parse_envrc("export CLAUDE_CONFIG_DIR="), None);
        assert_eq!(
            parse_envrc("# export CLAUDE_CONFIG_DIR=/commented/out"),
            None
        );
        assert_eq!(parse_envrc("export SOMETHING_ELSE=/x"), None);
    }

    #[test]
    fn the_declaration_is_found_by_walking_up_as_direnv_does() {
        // The file sits at the repository root; a terminal deep inside it must still find it.
        let dir = tempfile::tempdir().expect("tempdir");
        let deep = dir.path().join("src/components/ui");
        std::fs::create_dir_all(&deep).expect("dirs");
        std::fs::write(
            dir.path().join(".envrc"),
            "export CLAUDE_CONFIG_DIR=/opt/work\n",
        )
        .expect("write");

        assert_eq!(declared_home(&deep), Some(PathBuf::from("/opt/work")));
    }

    #[test]
    fn no_envrc_anywhere_means_no_declaration_rather_than_a_guess() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert_eq!(declared_home(dir.path()), None);
    }

    #[test]
    fn the_project_slug_matches_a_live_installation() {
        // Verified against the real directory, not derived from the documentation.
        assert_eq!(
            project_dir(
                Path::new("/home/.claude"),
                Path::new("/Users/steve/git-projects/private/yggshell")
            ),
            Path::new("/home/.claude/projects/-Users-steve-git-projects-private-yggshell")
        );
    }

    const TAIL: &str = r#"{"type":"user","message":{"role":"user"}}
{"type":"assistant","sessionId":"abc","timestamp":"2026-08-01T07:00:00.000Z","gitBranch":"main","message":{"model":"claude-opus-5","usage":{"input_tokens":2,"cache_read_input_tokens":100000,"cache_creation_input_tokens":5000,"output_tokens":500}}}
{"type":"assistant","sessionId":"abc","timestamp":"2026-08-01T07:05:00.000Z","gitBranch":"main","message":{"model":"claude-opus-5","usage":{"input_tokens":3,"cache_read_input_tokens":135000,"cache_creation_input_tokens":1000,"output_tokens":700}}}
"#;

    #[test]
    fn the_latest_turn_decides_the_context_and_the_output_accumulates() {
        let s = parse_tail(TAIL).expect("a session");

        // Context is a level, not a sum: what the model had in front of it on the LAST turn.
        assert_eq!(s.context_tokens, Some(3 + 135_000 + 1_000));
        // Output is a total: what it has written across the turns in view.
        assert_eq!(s.output_tokens, 1_200);
        assert_eq!(s.turns, 2);
        assert_eq!(s.model.as_deref(), Some("claude-opus-5"));
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.last_at.as_deref(), Some("2026-08-01T07:05:00.000Z"));
    }

    #[test]
    fn a_line_that_is_not_json_is_skipped_rather_than_fatal() {
        // The tail begins mid-file, and the format is somebody else's working file.
        let text = format!("{{ not json\n{TAIL}");
        assert!(parse_tail(&text).is_some());
    }

    #[test]
    fn a_shape_it_does_not_recognise_yields_less_rather_than_a_wrong_answer() {
        // The contract with the user: if the format changes, the tool goes quiet. It does not
        // invent, and it does not take the app down.
        let s = parse_tail(r#"{"type":"assistant","message":{}}"#).expect("still a turn");
        assert_eq!(s.turns, 1);
        assert_eq!(s.context_tokens, None);
        assert_eq!(s.model, None);
    }

    #[test]
    fn no_assistant_turns_is_no_session() {
        // A transcript that exists but has nothing in it is not something to report on.
        assert!(parse_tail(r#"{"type":"user"}"#).is_none());
        assert!(parse_tail("").is_none());
    }

    #[test]
    fn the_tail_starts_at_a_line_boundary() {
        // Half a JSON object is not an object; parsing one to see what happens is how a reader ends
        // up trusting a half-read value.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("t.jsonl");
        let filler = "x".repeat(200);
        std::fs::write(&path, format!("{{\"pad\":\"{filler}\"}}\n{TAIL}")).expect("write");

        let tail = read_tail(&path, 120).expect("tail");
        assert!(!tail.starts_with("x"), "a partial line must be dropped");
        assert!(tail.lines().all(|l| l.is_empty() || l.starts_with('{')));
    }

    #[test]
    fn the_newest_transcript_wins_regardless_of_its_name() {
        // Files are named by session id, which says nothing about order.
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("zzz.jsonl"), "old").expect("write");
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.path().join("aaa.jsonl"), "new").expect("write");

        assert_eq!(
            transcripts_by_age(dir.path())
                .first()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())),
            Some("aaa.jsonl".to_string())
        );
    }

    #[test]
    fn pointing_a_project_at_another_account_keeps_the_rest_of_the_file() {
        // The maintainer's own .envrc carries a `source_env_if_exists` line. Losing it while
        // switching accounts would break the project in a way nobody would connect to this action.
        let existing = "export CLAUDE_CONFIG_DIR=$HOME/.claude-privat\n\n# local secrets\nsource_env_if_exists .envrc.local\n";
        let out = rewrite_envrc(existing, "$HOME/.claude-work");

        assert!(out.contains("export CLAUDE_CONFIG_DIR=$HOME/.claude-work"));
        assert!(
            !out.contains(".claude-privat"),
            "the old value must be gone, not duplicated"
        );
        assert!(out.contains("source_env_if_exists .envrc.local"));
        assert!(out.contains("# local secrets"));
    }

    #[test]
    fn a_project_with_no_envrc_gets_one_that_is_only_our_line() {
        let out = rewrite_envrc("", "$HOME/.claude-work");
        assert_eq!(out, "export CLAUDE_CONFIG_DIR=$HOME/.claude-work\n");
    }

    #[test]
    fn our_line_goes_first_so_the_users_own_lines_can_still_win() {
        // A `source_env_if_exists` at the end must be able to override what we set: theirs is the
        // more specific statement, and direnv takes the last assignment.
        let out = rewrite_envrc("source_env_if_exists .envrc.local\n", "$HOME/.c");
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[0], "export CLAUDE_CONFIG_DIR=$HOME/.c");
        assert!(lines.contains(&"source_env_if_exists .envrc.local"));
    }

    #[test]
    fn a_commented_out_declaration_is_left_commented_out() {
        // Somebody disabled it on purpose. Reviving their comment as the live line would be the app
        // making a decision it was not asked to make.
        let out = rewrite_envrc("# export CLAUDE_CONFIG_DIR=$HOME/.old\n", "$HOME/.new");
        assert!(out.contains("# export CLAUDE_CONFIG_DIR=$HOME/.old"));
        assert!(out.contains("export CLAUDE_CONFIG_DIR=$HOME/.new"));
    }

    #[test]
    fn writing_a_declaration_backs_up_what_was_there() {
        // This edits a file the user wrote. Losing it silently is the failure that cannot be undone.
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join(".envrc"), "use flake\n").expect("write");

        declare_home(dir.path(), Path::new("/opt/claude-work")).expect("declare");

        let backups: Vec<_> = std::fs::read_dir(dir.path())
            .expect("read")
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("ygg-backup"))
            .collect();
        assert_eq!(backups.len(), 1, "the original must be recoverable");
        assert!(std::fs::read_to_string(backups[0].path())
            .expect("read backup")
            .contains("use flake"));
        assert!(std::fs::read_to_string(dir.path().join(".envrc"))
            .expect("read")
            .contains("use flake"));
    }

    #[test]
    fn a_declaration_written_here_is_read_back_by_our_own_parser() {
        // The two halves have to agree, or the app would write a file it then cannot understand.
        let dir = tempfile::tempdir().expect("tempdir");
        let home = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join(".claude-work");
        declare_home(dir.path(), &home).expect("declare");

        assert_eq!(declared_home(dir.path()), Some(home));
    }

    #[test]
    fn a_project_nobody_has_run_an_agent_in_has_no_session() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(session(dir.path(), Path::new("/nowhere")).is_none());
    }

    /// What a slash command leaves behind: its own transcript, with no assistant turn in it.
    ///
    /// Verbatim in shape from a live directory — `type` values measured, not invented.
    const LOCAL_COMMAND: &str = r#"{"type":"queue-operation"}
{"type":"attachment"}
{"type":"user","message":{"role":"user"}}
{"type":"system","subtype":"local_command"}
{"type":"last-prompt"}
"#;

    #[test]
    fn a_flood_of_newer_slash_command_transcripts_does_not_hide_the_live_session() {
        // Measured on the maintainer's machine while this was being written: a project directory
        // held the live session at 291 kB and FIVE 5.6 kB slash-command transcripts newer than it,
        // one per minute of work. Every `/command` mints another. A fixed candidate count is
        // therefore a race against the user's own typing — at six candidates the live session had
        // exactly one slot of headroom left, and the widget went blank the moment it lost it.
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("live.jsonl"), TAIL).expect("write");

        for i in 0..12 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            std::fs::write(dir.path().join(format!("cmd{i}.jsonl")), LOCAL_COMMAND).expect("write");
        }

        let (path, found) =
            newest_session(dir.path()).expect("the live session must still be found");
        assert_eq!(
            path.file_name().and_then(|n| n.to_str()),
            Some("live.jsonl"),
            "a burst of turn-less transcripts must not push the real session out of view"
        );
        assert_eq!(found.turns, 2);
    }

    #[test]
    fn the_search_is_bounded_by_what_it_reads_rather_than_by_how_many_files_it_opens() {
        // The bound has to exist — a project accumulates transcripts forever, and answering "what is
        // happening now" may not cost more every month. But it is a BUDGET, not a count: cheap files
        // (a slash command is ~5 kB) barely draw on it, so thousands of them still cannot crowd out
        // the answer, while genuinely large transcripts stop the walk quickly.
        let dir = tempfile::tempdir().expect("tempdir");
        let big = "x".repeat(TAIL_BYTES as usize);
        // Each of these costs a full tail read and carries no session.
        for i in 0..40 {
            std::fs::write(dir.path().join(format!("big{i}.jsonl")), &big).expect("write");
            std::thread::sleep(std::time::Duration::from_millis(2));
        }

        let budget_in_tails = (SEARCH_BUDGET / TAIL_BYTES) as usize;
        assert!(
            budget_in_tails < 40,
            "the fixture must actually exceed the budget, or this asserts nothing"
        );
        // It gives up rather than reading the whole directory, and gives up quietly.
        assert!(newest_session(dir.path()).is_none());
    }
}
