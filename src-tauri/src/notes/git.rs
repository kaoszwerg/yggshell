//! Keeping the notes repository in step with its remote.
//!
//! **This is the only file in the application permitted to run a writing git subcommand**, and
//! `scripts/project/check-git-writes.mjs` fails the build if `commit`, `push`, `add`, `rm`, `reset`,
//! `checkout`, `merge` or `rebase` appears anywhere else. YggShell runs `git` inside every project
//! the user has a tab in and every bit of that is read-only; a write path aimed at the wrong
//! directory would commit and push the maintainer's own work from a background timer, unasked
//! (ADR-PROJ-004).
//!
//! **The app holds no credentials and needs none.** It runs the user's own `git`, which finds them
//! where they already are — the SSH agent, the platform credential helper, `~/.gitconfig`. Nothing is
//! copied, stored or transmitted; `rule:security` allows a client to learn *that* a credential exists
//! and never its value, and here it learns neither.
//!
//! Everything else about how git is invoked is inherited from `git/fetch.rs`, which was built for the
//! auto-fetch and got it right: the binary comes from the captured login environment rather than the
//! process `PATH` (this app is launched from the dock, not a shell), every prompt is disabled because
//! nothing is attached to answer one, and there is a deadline on its own thread because `Command` has
//! none.

use crate::error::{AppError, Result};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// How long any one git call may take before the caller stops waiting.
///
/// Longer than the auto-fetch's, because this one may be pushing a first clone's worth of notes over
/// a slow link, and short enough that a wedged remote does not hold a sync for ever.
const TIMEOUT: Duration = Duration::from_secs(45);

/// What a remote URL is allowed to look like.
///
/// **`--upload-pack=…` is not a URL, it is a command.** Without this the settings field is an
/// execution hole: git would read a leading dash as an option however carefully the argument list was
/// built. Checked here *and* passed after `--` at the call site — the belt and the braces, because
/// this is the one input that reaches a process argument (ADR-PROJ-004).
pub fn valid_remote(url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() || url.starts_with('-') {
        return false;
    }
    if url.contains('\n') || url.contains('\r') || url.contains('\0') {
        return false;
    }
    url.starts_with("https://")
        || url.starts_with("http://")
        || url.starts_with("ssh://")
        // `user@host:path` — the SSH short form.
        || (url.contains('@') && url.contains(':'))
}

/// Where `git` is, from the captured login environment.
pub fn git_binary() -> Option<std::path::PathBuf> {
    crate::terminal::environment::which("git")
}

/// Run one git command in `cwd` and return its stdout, or git's own first error line.
///
/// **git's message is passed through verbatim**, and that is deliberate: "Permission denied
/// (publickey)" is actionable and "sync failed" is not. It is the whole reason the settings panel
/// carries the last error rather than a status word.
fn run(cwd: &Path, args: &[&str]) -> Result<String> {
    let Some(git) = git_binary() else {
        return Err(AppError::Other(
            "git is not on the PATH — notes stay local until it is".into(),
        ));
    };

    let mut command = Command::new(&git);
    command
        .current_dir(cwd)
        .args(args)
        // No prompts, from any of the three things that might raise one. There is no terminal
        // attached to a background sync, so a credential prompt would block until the timeout with
        // nothing on screen to explain it.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "")
        .env("SSH_ASKPASS", "")
        // `BatchMode` makes ssh fail instead of asking for a passphrase. The honest consequence: a
        // key that is not in the agent means the sync never succeeds — which is right for a
        // background task, and why the error is shown verbatim rather than swallowed.
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // The one addition over the fetch path, because pushing raises the stakes: without a socket ssh
    // has no agent at all, and a desktop launch does not inherit the shell's. "It works in my
    // terminal but not in the app" is a real and very confusing state.
    if std::env::var_os("SSH_AUTH_SOCK").is_none() {
        if let Some(sock) = crate::terminal::environment::login_env().get("SSH_AUTH_SOCK") {
            command.env("SSH_AUTH_SOCK", sock);
        }
    }

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(command.output());
    });

    match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(output)) if output.status.success() => {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        }
        Ok(Ok(output)) => {
            let reason = reason(&String::from_utf8_lossy(&output.stderr));
            tracing::info!(?args, %reason, "notes git failed");
            Err(AppError::Other(reason))
        }
        Ok(Err(error)) => {
            tracing::info!(?args, %error, "could not run git");
            Err(AppError::Other(error.to_string()))
        }
        Err(_) => {
            // The thread finishes into a dropped channel: the child cannot be killed safely from
            // here, and what matters is that the caller is not held any longer.
            tracing::info!(?args, "notes git timed out");
            Err(AppError::Other(format!(
                "no answer from the remote within {}s",
                TIMEOUT.as_secs()
            )))
        }
    }
}

/// What git actually refused, out of everything it printed on the way there.
///
/// **Not the first line.** git narrates: `From github.com:…`, the ref it fetched, a progress bar —
/// and the first non-empty line of that is what the maintainer was shown when a sync failed, over
/// and over, saying nothing at all. The line that carries the refusal is marked (`fatal:`,
/// `error:`); failing that, git's conclusion is its last line, never its first.
fn reason(stderr: &str) -> String {
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let marked = lines
        .iter()
        .rev()
        .find(|l| l.starts_with("fatal:") || l.starts_with("error:"));
    match marked.or_else(|| lines.last()) {
        Some(line) => line
            .trim_start_matches("fatal:")
            .trim_start_matches("error:")
            .trim()
            .to_string(),
        None => "git failed".into(),
    }
}

/// Prepare the clone for `remote`, cloning it if there is nothing there yet.
///
/// **The repository must already exist.** The app never creates one: a creation flow would have to
/// choose a visibility, and choosing wrong is silent and permanent (ADR-PROJ-004). A remote it cannot
/// reach is reported with git's own words, where the URL was typed.
pub fn connect(clone_dir: &Path, remote: &str, branch: &str) -> Result<()> {
    if !valid_remote(remote) {
        return Err(AppError::Other(format!(
            "not a usable git remote: {remote}"
        )));
    }
    let parent = clone_dir
        .parent()
        .ok_or_else(|| AppError::Other("the clone has nowhere to live".into()))?;
    std::fs::create_dir_all(parent).map_err(|e| AppError::io(parent.display().to_string(), e))?;

    if clone_dir.join(".git").is_dir() {
        // Already a clone: point it at the remote the user named now, rather than the one they named
        // before. Changing the URL must never discard notes, so the working tree is left exactly as
        // it is — the local files are then offered to the new repository by the next push.
        let _ = run(clone_dir, &["remote", "remove", "origin"]);
        run(clone_dir, &["remote", "add", "origin", "--", remote])?;
        tracing::info!(remote, branch, "notes remote repointed");
        return Ok(());
    }

    // **A directory that already holds notes is ADOPTED, never cloned over.**
    //
    // Writing notes before naming a remote is the normal first path, not an edge case: the tool works
    // local-only until somebody types a URL, so by the time they do, the directory is full. `git
    // clone` refuses a non-empty destination — *"already exists and is not an empty directory"* — and
    // that error is what the maintainer saw the first time they connected.
    //
    // Adopting rather than cloning is also what keeps the promise that changing the remote never
    // discards notes: nothing is checked out over the working tree, so no local file is touched. The
    // local state becomes a commit, the remote's history is fetched, and ours is rebased on top —
    // where a conflict leaves both sides in the file, exactly as `pull` does.
    if clone_dir.exists() && std::fs::read_dir(clone_dir).is_ok_and(|mut d| d.next().is_some()) {
        return adopt(clone_dir, remote, branch);
    }

    let target = clone_dir.to_string_lossy().to_string();
    // `--` before the URL: the second half of the argument-injection defence in `valid_remote`.
    run(parent, &["clone", "--", remote, &target])?;
    if !branch.trim().is_empty() {
        // A branch that does not exist yet is not a failure — it is a repository being used for the
        // first time, and the first push creates it.
        let _ = run(clone_dir, &["checkout", branch]);
    }
    tracing::info!(remote, branch, "notes cloned");
    Ok(())
}

/// Turn a directory of existing local notes into a clone of `remote`, without touching a file.
///
/// The order matters and each step is there for a reason:
/// 1. `init` + `remote add` — the directory becomes a repository where it stands.
/// 2. commit what is there, so the local notes are *history* rather than uncommitted work that a
///    later operation could stash or discard.
/// 3. `fetch` — the remote's side, if it has one.
/// 4. `rebase` ours on top. Nothing is checked out over the working tree at any point, so a note
///    written here cannot be replaced by one written elsewhere without the user seeing both.
fn adopt(clone_dir: &Path, remote: &str, branch: &str) -> Result<()> {
    if !clone_dir.join(".git").is_dir() {
        run(clone_dir, &["init"])?;
    }
    union_merge(clone_dir)?;
    let _ = run(clone_dir, &["remote", "remove", "origin"]);
    run(clone_dir, &["remote", "add", "origin", "--", remote])?;

    run(clone_dir, &["add", "--all", "--", "."])?;
    let staged = run(clone_dir, &["status", "--porcelain"])?;
    if !staged.trim().is_empty() {
        run(
            clone_dir,
            &["commit", "--message", "notes: adopt local notes"],
        )?;
    }

    let target = if branch.trim().is_empty() {
        current_branch(clone_dir)
    } else {
        branch.trim().to_string()
    };
    let heads = run(clone_dir, &["ls-remote", "--heads", "origin", &target])?;
    if heads.trim().is_empty() {
        tracing::info!(remote, branch = %target, "notes adopted — the remote is empty");
        return Ok(());
    }

    run(clone_dir, &["fetch", "origin", &target])?;
    // A conflict here keeps BOTH sides' lines (see `union_merge`). If a rebase still stops for some
    // other reason, it is aborted rather than left standing: a repository frozen mid-rebase is a
    // state the user cannot get out of from inside this app, and the notes would silently stop
    // syncing until somebody opened a terminal in a directory they have never heard of.
    if let Err(error) = run(clone_dir, &["rebase", "FETCH_HEAD"]) {
        let _ = run(clone_dir, &["rebase", "--abort"]);
        return Err(error);
    }
    tracing::info!(remote, branch = %target, "notes adopted onto the remote's history");
    Ok(())
}

/// Keep BOTH sides of a conflicting note, without markers and without stopping.
///
/// `*.md merge=union` is git's own answer to exactly this shape of file: a list that grows at both
/// ends on two machines. The alternative behaviours are both worse here — "newest wins" silently
/// drops a paragraph written on the other machine, discovered only by going to look for it, and a
/// conflict that STOPS leaves the repository mid-rebase, which the user cannot get out of from inside
/// this app.
///
/// The cost is honest and small: a note that was edited on both machines briefly shows both versions'
/// lines, and the user deletes one. Briefly ugly, nothing ever lost (ADR-PROJ-004).
fn union_merge(clone_dir: &Path) -> Result<()> {
    let path = clone_dir.join(".gitattributes");
    let wanted = "*.md merge=union\n";
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    if !current.contains("merge=union") {
        std::fs::write(&path, format!("{current}{wanted}"))
            .map_err(|e| AppError::io(path.display().to_string(), e))?;
    }
    Ok(())
}

/// Pull, keeping both sides of a conflict rather than resolving one away.
///
/// Rebase, so the history stays linear; on a conflict the markers are left in the file and the sync
/// reports it. The file is briefly ugly and nothing is ever lost — where "newest wins" is clean and
/// silently drops a paragraph written on the other machine, discovered only by going to look for it.
///
/// **A branch the remote does not have yet is not a failure.** A repository being used for the first
/// time has no commits at all, and `git pull` answers that with *"Your configuration specifies to
/// merge with the ref 'refs/heads/main'"* — which would have been shown to the user as the sync's
/// error, for ever, on the one day it means nothing is wrong. Found by pushing to a real empty
/// repository; no unit test would have produced an unborn branch.
pub fn pull(clone_dir: &Path) -> Result<()> {
    union_merge(clone_dir)?;
    let branch = current_branch(clone_dir);
    let heads = run(clone_dir, &["ls-remote", "--heads", "origin", &branch])?;
    if heads.trim().is_empty() {
        tracing::info!(%branch, "nothing to pull — the remote has no such branch yet");
        return Ok(());
    }
    // **Name the remote and the branch.** A bare `git pull` needs tracking information, and a clone
    // that was ADOPTED rather than cloned has none — `connect` on a directory that already holds
    // notes does init + remote add + commit, and nothing there sets an upstream. Every sync then
    // failed with "There is no tracking information for the current branch", from the first day, so
    // notes written on another machine never arrived. The push side had been fixed with
    // `--set-upstream`; the pull runs first and never reached it.
    run(
        clone_dir,
        &["pull", "--rebase", "--autostash", "origin", &branch],
    )?;
    Ok(())
}

/// The branch the clone is on, or `main` when HEAD is unborn and git has no answer.
fn current_branch(clone_dir: &Path) -> String {
    run(clone_dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty() && name != "HEAD")
        .unwrap_or_else(|| "main".into())
}

/// Stage everything, commit if there is anything to commit, and push.
///
/// Returns `false` when there was nothing to send, so the caller can tell "up to date" from "sent".
pub fn push(clone_dir: &Path, message: &str) -> Result<bool> {
    run(clone_dir, &["add", "--all", "--", "."])?;
    let staged = run(clone_dir, &["status", "--porcelain"])?;
    let committed = !staged.trim().is_empty();
    if committed {
        run(clone_dir, &["commit", "--message", message])?;
    }
    // **Push even with nothing to commit.** The two are not the same question, and conflating them
    // was a real defect: after `connect` adopts a directory of existing notes, everything is already
    // committed — so an early return here left the notes sitting in a local commit that never went
    // anywhere, and the app reported success. Found by pushing to the real repository and looking.
    // A push with nothing to send answers "Everything up-to-date" and costs one cheap round trip.
    // `--set-upstream HEAD`, always. A fresh clone of an empty repository has no upstream to push
    // to, and a bare `git push` answers that with "has no upstream branch" — the same first-run
    // failure as the pull above, on the same day. Harmless once it is set.
    run(clone_dir, &["push", "--set-upstream", "origin", "HEAD"])?;
    tracing::info!("notes pushed");
    Ok(true)
}

/// How much of what is here has not reached the remote: `(commits ahead, uncommitted changes)`.
///
/// **The question the settings panel could not answer**: "woran kann ich erkennen ob das speichern
/// und syncen geklappt hat … sonst weiß ich ja nie ob mein stand auch remote liegt". A timestamp says
/// when something last worked, never whether *this* note is out there.
///
/// Two ways of not being there and both count: a commit nobody pushed, and an edit nobody committed.
/// Counted against the **local** `origin/<branch>` ref, so this costs no network and cannot raise a
/// keychain prompt — it is as fresh as the last sync, which is exactly the claim the badge makes.
///
/// Unreadable, unborn, not a clone at all: `(0, false)`. A badge must never invent an alarm, and the
/// "not connected" case is shown from the status it already has.
pub fn local_state(clone_dir: &Path) -> (u32, bool) {
    let dirty = run(clone_dir, &["status", "--porcelain"])
        .map(|out| !out.trim().is_empty())
        .unwrap_or(false);
    let branch = current_branch(clone_dir);
    let ahead = run(
        clone_dir,
        &["rev-list", "--count", &format!("origin/{branch}..HEAD")],
    )
    .ok()
    .and_then(|out| out.trim().parse::<u32>().ok())
    .unwrap_or(0);
    (ahead, dirty)
}

/// Whether the clone is there and looks like a git repository.
pub fn is_clone(clone_dir: &Path) -> bool {
    clone_dir.join(".git").is_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// git, run directly — the fixture builds the repositories the code under test then works on.
    fn git(cwd: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .current_dir(cwd)
            .args(args)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .expect("git");
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// A bare repository standing in for the remote, and a working clone pointing at it — with a
    /// commit on both sides, exactly like a repository that was adopted here and written to
    /// elsewhere. No network: the failure this reproduces is local.
    fn repos() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let remote = tmp.path().join("remote.git");
        let work = tmp.path().join("work");
        std::fs::create_dir_all(&remote).expect("mkdir");
        std::fs::create_dir_all(&work).expect("mkdir");
        git(
            tmp.path(),
            &["init", "--bare", "--initial-branch=main", "remote.git"],
        );

        // Something on the remote: a note written on the other machine.
        let seed = tmp.path().join("seed");
        std::fs::create_dir_all(&seed).expect("mkdir");
        git(&seed, &["init", "--initial-branch=main"]);
        std::fs::write(seed.join("theirs.md"), "over there\n").expect("write");
        git(&seed, &["add", "--all"]);
        git(&seed, &["commit", "--message", "theirs"]);
        git(
            &seed,
            &["remote", "add", "origin", &remote.display().to_string()],
        );
        git(&seed, &["push", "origin", "main"]);

        (tmp, remote, work)
    }

    #[test]
    fn pulls_a_clone_that_has_no_upstream_set() {
        // **The maintainer's repository, exactly.** `connect` on a directory that already holds
        // notes ADOPTS it — init, remote add, commit — and that leaves `main` with no tracking
        // information. A bare `git pull --rebase` then refuses ("There is no tracking information
        // for the current branch"), so every sync failed from the first day and the notes written
        // on the other machine never arrived. The push side had already been fixed with
        // `--set-upstream`; the pull runs FIRST, so it never got there.
        let (_tmp, remote, work) = repos();
        git(&work, &["init", "--initial-branch=main"]);
        std::fs::write(work.join("mine.md"), "over here\n").expect("write");
        git(&work, &["add", "--all"]);
        git(&work, &["commit", "--message", "adopt local notes"]);
        git(
            &work,
            &["remote", "add", "origin", &remote.display().to_string()],
        );
        // Nothing sets an upstream — the state `adopt` leaves behind, and the whole point of the
        // test. Asked for directly, git says so: "no upstream configured for branch 'main'".
        assert!(
            Command::new("git")
                .current_dir(&work)
                .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
                .output()
                .is_ok_and(|out| !out.status.success()),
            "the fixture must have NO upstream, or it proves nothing"
        );

        pull(&work).expect("pull");

        assert!(
            work.join("theirs.md").exists(),
            "the other machine's note arrived"
        );
        assert!(
            work.join("mine.md").exists(),
            "and nothing of ours was lost"
        );
    }

    #[test]
    fn counts_what_has_not_reached_the_remote_yet() {
        // "woran kann ich erkennen ob das speichern und syncen geklappt hat … sonst weiß ich ja nie
        // ob mein stand auch remote liegt". Two different ways of not being there, and both count:
        // a commit that has not been pushed, and an edit that has not been committed.
        let (_tmp, remote, work) = repos();
        git(&work, &["clone", &remote.display().to_string(), "."]);
        assert_eq!(
            local_state(&work),
            (0, false),
            "a fresh clone is level with the remote"
        );

        std::fs::write(work.join("mine.md"), "written just now\n").expect("write");
        assert!(
            local_state(&work).1,
            "an uncommitted edit is not saved anywhere else"
        );

        git(&work, &["add", "--all"]);
        git(&work, &["commit", "--message", "mine"]);
        assert_eq!(local_state(&work), (1, false), "committed, still only here");
    }

    #[test]
    fn is_not_alarmed_by_a_repository_it_cannot_read() {
        // The badge must never claim "everything is safe" on a guess. An empty directory is not a
        // clone, and the honest answer is zero pending changes, not an error the user cannot act on.
        let tmp = tempfile::tempdir().expect("tempdir");
        assert_eq!(local_state(tmp.path()), (0, false));
    }

    #[test]
    fn reports_what_git_refused_rather_than_its_first_line_of_chatter() {
        // What the maintainer was shown for a failing sync was "From github.com:kaoszwerg/notes" —
        // git's progress header, the first non-empty line of stderr, and completely silent about
        // what went wrong. The line that says something is further down, and it is the one with
        // `fatal:` or `error:` on it.
        let stderr = "From github.com:kaoszwerg/notes\n\
                      * branch            main       -> FETCH_HEAD\n\
                      fatal: refusing to merge unrelated histories\n";
        assert_eq!(reason(stderr), "refusing to merge unrelated histories");

        // No marker anywhere: the LAST line, because git puts its conclusion at the end.
        assert_eq!(
            reason("doing a thing\nit did not work\n"),
            "it did not work"
        );

        // Nothing at all still has to say something.
        assert_eq!(reason("   \n\n"), "git failed");
    }

    #[test]
    fn keeps_the_whole_message_when_it_is_all_one_line() {
        assert_eq!(
            reason("error: could not read Username for 'https://github.com'"),
            "could not read Username for 'https://github.com'"
        );
    }
}
