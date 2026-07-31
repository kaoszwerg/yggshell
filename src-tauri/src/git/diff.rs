//! Turning two blobs into hunks the UI can draw.
//!
//! **Structured, not a unified-diff string.** git's textual `@@`-format exists because a terminal has
//! nowhere else to put the information; a UI that renders it would have to parse it straight back
//! apart to colour a line or highlight its syntax. So the line kind and both line numbers are carried
//! as data and the `@@` header is produced alongside for the one place it still belongs — the top of
//! a hunk, where a reader expects it.
//!
//! The comparison itself is `imara-diff` through `gix`, with git's own slider heuristics applied, so a
//! hunk lands where `git diff` would put it rather than merely somewhere defensible.

use crate::dto::{GitDiffLine, GitHunk};
use gix::diff::blob::{diff_with_slider_heuristics, Algorithm, InternedInput};

/// Lines of context around each change. Three is git's default and what everyone's eye expects.
const CONTEXT: u32 = 3;

/// A blob that is not text, and the size past which we stop pretending it might be.
///
/// A 5 MB minified bundle is *technically* diffable and would produce tens of thousands of lines the
/// user cannot read, after a wait they did not ask for. It is reported as binary instead — an honest
/// "there is no diff to show here" rather than a frozen window.
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;

/// Whether a blob should be treated as binary — the same test git uses: a NUL byte in the first 8 000.
pub fn is_binary(bytes: &[u8]) -> bool {
    bytes.len() > MAX_TEXT_BYTES || bytes.iter().take(8000).any(|b| *b == 0)
}

/// Compute the hunks between two blobs.
///
/// Returns an empty list when the two are identical — which is not the same as an empty file, and the
/// caller is expected to say so rather than showing a blank panel.
pub fn hunks(old: &[u8], new: &[u8]) -> Vec<GitHunk> {
    if old == new {
        return Vec::new();
    }
    let old_text = String::from_utf8_lossy(old);
    let new_text = String::from_utf8_lossy(new);
    let input = InternedInput::new(old_text.as_ref(), new_text.as_ref());
    let diff = diff_with_slider_heuristics(Algorithm::Histogram, &input);

    let before = |token| input.interner[token].to_string();
    let old_lines: Vec<String> = input.before.iter().map(|t| before(*t)).collect();
    let new_lines: Vec<String> = input.after.iter().map(|t| before(*t)).collect();

    // Changed regions first, then merged into hunks: two changes four lines apart share their context
    // and must become ONE hunk, or the reader sees the same lines printed twice.
    let mut regions: Vec<(u32, u32, u32, u32)> = Vec::new();
    for hunk in diff.hunks() {
        regions.push((
            hunk.before.start,
            hunk.before.end,
            hunk.after.start,
            hunk.after.end,
        ));
    }
    if regions.is_empty() {
        return Vec::new();
    }

    let mut out: Vec<GitHunk> = Vec::new();
    let mut group: Vec<(u32, u32, u32, u32)> = Vec::new();
    for region in regions {
        match group.last() {
            // Two regions whose context windows touch or overlap belong together.
            Some(previous) if region.0 <= previous.1 + CONTEXT * 2 => group.push(region),
            Some(_) => {
                out.push(render(&group, &old_lines, &new_lines));
                group = vec![region];
            }
            None => group.push(region),
        }
    }
    out.push(render(&group, &old_lines, &new_lines));
    out
}

/// Render one group of adjacent changed regions as a single hunk, with its context.
fn render(group: &[(u32, u32, u32, u32)], old_lines: &[String], new_lines: &[String]) -> GitHunk {
    let first = group.first().copied().unwrap_or_default();
    let last = group.last().copied().unwrap_or_default();

    let old_start = first.0.saturating_sub(CONTEXT);
    let new_start = first.2.saturating_sub(CONTEXT);
    let old_end = (last.1 + CONTEXT).min(count(old_lines));
    let new_end = (last.3 + CONTEXT).min(count(new_lines));

    let mut lines = Vec::new();
    let mut old_at = old_start;
    let mut new_at = new_start;

    for region in group {
        // Context before this region, taken from the old side — where the two agree, they are the
        // same text, so either side would do.
        while old_at < region.0 {
            lines.push(context_line(old_lines, old_at, new_at));
            old_at += 1;
            new_at += 1;
        }
        while old_at < region.1 {
            lines.push(GitDiffLine {
                kind: "removed".into(),
                old_line: Some(old_at + 1),
                new_line: None,
                text: at(old_lines, old_at),
            });
            old_at += 1;
        }
        while new_at < region.3 {
            lines.push(GitDiffLine {
                kind: "added".into(),
                old_line: None,
                new_line: Some(new_at + 1),
                text: at(new_lines, new_at),
            });
            new_at += 1;
        }
    }
    // Trailing context.
    while old_at < old_end && new_at < new_end {
        lines.push(context_line(old_lines, old_at, new_at));
        old_at += 1;
        new_at += 1;
    }

    GitHunk {
        header: format!(
            "@@ -{},{} +{},{} @@",
            old_start + 1,
            old_at.saturating_sub(old_start),
            new_start + 1,
            new_at.saturating_sub(new_start),
        ),
        old_start: old_start + 1,
        new_start: new_start + 1,
        lines,
    }
}

fn context_line(old_lines: &[String], old_at: u32, new_at: u32) -> GitDiffLine {
    GitDiffLine {
        kind: "context".into(),
        old_line: Some(old_at + 1),
        new_line: Some(new_at + 1),
        text: at(old_lines, old_at),
    }
}

/// Index a line list without ever panicking on a bad index — `noUncheckedIndexedAccess`'s Rust twin.
///
/// The line ending comes off here: the interner hands back the line *including* its terminator, and a
/// UI that renders that gets a stray blank line under every row. What the DTO promises is the text.
fn at(lines: &[String], index: u32) -> String {
    lines
        .get(index as usize)
        .map(|line| {
            line.trim_end_matches('\n')
                .trim_end_matches('\r')
                .to_string()
        })
        .unwrap_or_default()
}

fn count(lines: &[String]) -> u32 {
    u32::try_from(lines.len()).unwrap_or(u32::MAX)
}

/// How many lines the hunks add and remove — the `+n −m` a file row shows.
pub fn totals(hunks: &[GitHunk]) -> (u32, u32) {
    let mut added = 0;
    let mut removed = 0;
    for hunk in hunks {
        for line in &hunk.lines {
            match line.kind.as_str() {
                "added" => added += 1,
                "removed" => removed += 1,
                _ => {}
            }
        }
    }
    (added, removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(hunk: &GitHunk) -> Vec<&str> {
        hunk.lines.iter().map(|l| l.kind.as_str()).collect()
    }

    #[test]
    fn identical_blobs_produce_no_hunks() {
        assert!(hunks(b"a\nb\nc\n", b"a\nb\nc\n").is_empty());
    }

    #[test]
    fn a_changed_line_is_a_removal_followed_by_an_addition() {
        let result = hunks(b"one\ntwo\nthree\n", b"one\nTWO\nthree\n");
        assert_eq!(result.len(), 1);
        let hunk = result.first().expect("one hunk");
        assert_eq!(kinds(hunk), ["context", "removed", "added", "context"]);
        assert_eq!(totals(&result), (1, 1));
    }

    #[test]
    fn both_line_numbers_are_carried_so_the_ui_never_recomputes_them() {
        let result = hunks(b"a\nb\nc\nd\n", b"a\nB\nc\nd\n");
        let hunk = result.first().expect("one hunk");
        let removed = hunk
            .lines
            .iter()
            .find(|l| l.kind == "removed")
            .expect("a removal");
        assert_eq!(removed.old_line, Some(2));
        assert_eq!(removed.new_line, None, "a removed line has no new number");
        let added = hunk
            .lines
            .iter()
            .find(|l| l.kind == "added")
            .expect("an addition");
        assert_eq!(added.old_line, None);
        assert_eq!(added.new_line, Some(2));
        let context = hunk.lines.first().expect("context first");
        assert_eq!((context.old_line, context.new_line), (Some(1), Some(1)));
    }

    #[test]
    fn context_is_limited_to_three_lines_on_each_side() {
        let old: String = (1..=20).map(|n| format!("line {n}\n")).collect();
        let new = old.replace("line 10\n", "LINE 10\n");
        let result = hunks(old.as_bytes(), new.as_bytes());
        let hunk = result.first().expect("one hunk");

        // 3 context + 1 removed + 1 added + 3 context.
        assert_eq!(hunk.lines.len(), 8);
        assert_eq!(hunk.old_start, 7, "starts three lines before the change");
        assert_eq!(hunk.header, "@@ -7,7 +7,7 @@");
    }

    #[test]
    fn two_nearby_changes_become_one_hunk_rather_than_two_overlapping_ones() {
        // Four lines apart: their context windows overlap, so printing them separately would show the
        // same lines twice — which is exactly what a reader reads as a bug in the diff.
        let old: String = (1..=20).map(|n| format!("line {n}\n")).collect();
        let new = old
            .replace("line 8\n", "LINE 8\n")
            .replace("line 12\n", "LINE 12\n");
        let result = hunks(old.as_bytes(), new.as_bytes());
        assert_eq!(result.len(), 1, "one merged hunk, got {result:#?}");
        assert_eq!(totals(&result), (2, 2));
    }

    #[test]
    fn two_distant_changes_stay_two_hunks() {
        let old: String = (1..=60).map(|n| format!("line {n}\n")).collect();
        let new = old
            .replace("line 5\n", "LINE 5\n")
            .replace("line 50\n", "LINE 50\n");
        let result = hunks(old.as_bytes(), new.as_bytes());
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn a_new_file_is_all_additions() {
        let result = hunks(b"", b"first\nsecond\n");
        assert_eq!(totals(&result), (2, 0));
        let hunk = result.first().expect("one hunk");
        assert_eq!(kinds(hunk), ["added", "added"]);
        assert_eq!(hunk.new_start, 1);
    }

    #[test]
    fn a_deleted_file_is_all_removals() {
        let result = hunks(b"first\nsecond\n", b"");
        assert_eq!(totals(&result), (0, 2));
    }

    #[test]
    fn a_line_carries_its_text_without_the_line_ending() {
        // The DTO promises text, not text-plus-newline, and a UI that renders the terminator gets a
        // blank line under every row.
        let result = hunks(b"one\ntwo\n", b"one\nTWO\n");
        let hunk = result.first().expect("one hunk");
        let texts: Vec<&str> = hunk.lines.iter().map(|l| l.text.as_str()).collect();
        assert_eq!(texts, ["one", "two", "TWO"]);
    }

    #[test]
    fn crlf_line_endings_do_not_leak_into_the_text_either() {
        let result = hunks(b"one\r\ntwo\r\n", b"one\r\nTWO\r\n");
        let hunk = result.first().expect("one hunk");
        assert!(hunk.lines.iter().all(|l| !l.text.contains('\r')));
        assert!(hunk.lines.iter().any(|l| l.text == "TWO"));
    }

    #[test]
    fn a_nul_byte_marks_a_blob_binary() {
        assert!(is_binary(b"\x89PNG\r\n\x1a\n\x00\x00"));
        assert!(!is_binary(b"fn main() {}\n"));
    }

    #[test]
    fn something_far_too_large_is_treated_as_binary_however_textual_it_is() {
        // A minified bundle is diffable in principle and unreadable in practice; the wait is the
        // real cost, and it buys the user nothing.
        let huge = vec![b'a'; MAX_TEXT_BYTES + 1];
        assert!(is_binary(&huge));
    }

    #[test]
    fn invalid_utf8_still_produces_a_diff_rather_than_an_error() {
        // A latin-1 file is not binary and the user still wants to see what changed in it.
        let result = hunks(b"caf\xe9\n", b"caf\xe9 au lait\n");
        assert_eq!(totals(&result), (1, 1));
    }
}
