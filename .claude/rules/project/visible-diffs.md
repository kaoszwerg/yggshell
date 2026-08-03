---
id: rule:visible-diffs
title: Every file change goes through Edit/Write — the diff must be reviewable
tldr: "Change repository files with Edit/Write only. A heredoc, python3 -, sed -i or cat > edits the file just as well and leaves the maintainer no diff to review."
scope: workflow
load: core
triggers:
  - edit
  - write
  - file
  - heredoc
  - script
  - sed
  - python
  - cat
  - printf
  - patch
  - bulk
  - rename
  - refactor
  - diff
  - review
applies-to:
  - "**/*"
---

# Every file change goes through Edit/Write

**Change a file in this repository with the Edit or Write tool. Never with a shell command that
writes it** — no `cat > file <<'EOF'`, no `python3 - <<'PY'`, no `sed -i`, no `printf >`, no
`> file` redirect.

## Why this is a rule and not a preference

A tool edit is rendered to the maintainer as a **diff, in place, as it happens**: old text, new text,
reviewable while the work is going on. A shell command that produces the identical file is an opaque
blob — the result is the same, the *review* is not. What is left is reconstructing the change from
`git diff` afterwards, which is precisely the position the maintainer should never be in on work they
are watching.

Demanded verbatim, in capitals, after a session in which several files were rewritten by
`python3 - <<'PY'`:

> **DU SOLLST DAS EDIT TOOL BENUTZEN!!! ICH MUSS DEINE DIFFS SEHEN KÖNNEN!!!**

The agent that wrote those scripts was not being careless — each one was small and correct, and the
gate stayed green. That is the trap: **nothing about a scripted edit fails.** It costs only the
maintainer's ability to see what happened, which no check in `check:all` can notice.

## What this does and does not cover

- **A repetitive change is a reason for MORE tool calls, never for a loop in a script.** `Edit` with
  `replace_all: true` covers the genuinely mechanical case; a whole-file rewrite is `Write`. Twenty
  edits are twenty diffs, and twenty diffs are the point.
- **"It is trivial" does not exempt it.** Whether a change is trivial is a judgement the maintainer
  makes *from the diff*. An agent that decides this in advance has decided not to be reviewed.
- **Shell keeps everything it is for: running things.** The gate, tests, builds, `git`, measurements,
  reading a log, `grep`, `ls`. The line is *writing repository files* — not shell as such.
- **A file produced by one of the project's own tools is fine** — `governance:sync`, `gen:types`,
  `npm version`, a formatter. That is the tool's output, not an edit made by hand behind a script.
- **A scratchpad file is not a repository file.** Temporary work outside the repo is unaffected.

## The one exception, and its price

If a change genuinely cannot be expressed with Edit/Write — a binary, a file too large to hold — say
so **before** doing it and name what you are about to run. The maintainer can then ask for the diff
in another form. Doing it quietly is the thing this rule forbids.
