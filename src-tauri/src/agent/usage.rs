//! How much of the subscription is used up, asked of Claude Code itself.
//!
//! **The maintainer found this, and it is better than anything derivable from the transcript.**
//! `claude -p "/usage" --output-format json` answers with the real figures — and answers them for
//! **free**: measured `total_cost_usd: 0`, `num_turns: 0`, `duration_api_ms: 0`. The slash command
//! is handled locally and never reaches a model.
//!
//! That matters because the transcript cannot answer this at all. It records how many tokens a turn
//! carried and never what the limits are, so anything shown from it would be a count without a
//! denominator — see `lib/tokens` for why no percentage is invented there.
//!
//! **The account is the tab's**, as everywhere in this module: the call runs with the
//! `CLAUDE_CONFIG_DIR` the project declares, or the figures would be another account's.
//!
//! **A text output, parsed defensively.** `result` is prose meant for a human, not an interface with
//! a promise attached. Every field here is optional, an unrecognised line is skipped, and the panel
//! goes quiet rather than showing something invented if the wording changes.

use crate::dto::{UsageLimit, UsageSummary};
use std::path::Path;
use std::process::{Command, Stdio};

/// Ask Claude Code for the current usage.
///
/// `None` when there is no `claude` on PATH, when it fails, or when its answer carries nothing this
/// understands — all of which mean "nothing to show" rather than an error.
pub fn read(home: Option<&Path>, cwd: &Path) -> Option<UsageSummary> {
    let claude = crate::terminal::environment::which("claude")?;
    let mut command = Command::new(claude);
    command
        .args(["-p", "/usage", "--output-format", "json"])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    if let Some(home) = home {
        // Which account's figures these are is decided here. Without it the call would inherit
        // whatever the app process has, which is not the tab's.
        command.env("CLAUDE_CONFIG_DIR", home);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        tracing::debug!("claude -p /usage returned non-zero — no usage to show");
        return None;
    }
    let summary = parse(&String::from_utf8_lossy(&output.stdout));
    tracing::debug!(found = summary.is_some(), "read the usage limits");
    summary
}

/// Pull the figures out of the command's JSON envelope.
pub fn parse(stdout: &str) -> Option<UsageSummary> {
    let value: serde_json::Value = serde_json::from_str(stdout).ok()?;
    let text = value.get("result")?.as_str()?;
    parse_text(text)
}

/// Read the human-readable report.
///
/// The shape, measured on a live account:
///
/// ```text
/// Current session: 58% used · resets Aug 1 at 12:30pm (Europe/Berlin)
/// Current week (all models): 25% used · resets Aug 5 at 10am (Europe/Berlin)
/// Current week (Fable): 0% used
///
/// Last 24h · 2131 requests · 2 sessions
/// ```
///
/// Kept as a list of `(label, percent, resets)` rather than as named fields: the categories are
/// Anthropic's to change — "Current week (Fable)" did not exist a year ago — and a struct with three
/// fixed fields would silently drop a fourth. A list shows whatever is there.
pub fn parse_text(text: &str) -> Option<UsageSummary> {
    let mut limits = Vec::new();
    let mut requests_24h = None;
    let mut sessions_24h = None;

    for line in text.lines().map(str::trim) {
        if let Some(limit) = parse_limit(line) {
            limits.push(limit);
            continue;
        }
        if let Some(rest) = line.strip_prefix("Last 24h") {
            requests_24h = number_before(rest, "requests");
            sessions_24h = number_before(rest, "sessions");
        }
    }

    if limits.is_empty() {
        return None;
    }
    Some(UsageSummary {
        limits,
        requests_24h,
        sessions_24h,
    })
}

/// `Current session: 58% used · resets Aug 1 at 12:30pm (Europe/Berlin)`
fn parse_limit(line: &str) -> Option<UsageLimit> {
    let (label, rest) = line.split_once(": ")?;
    let (percent, rest) = rest.split_once("% used")?;
    let percent: u8 = percent.trim().parse().ok()?;
    // A label with no percentage is prose, not a limit.
    if label.is_empty() {
        return None;
    }
    let resets = rest
        .split_once("resets ")
        .map(|(_, when)| when.trim().to_string())
        .filter(|when| !when.is_empty());
    Some(UsageLimit {
        label: label.to_string(),
        percent,
        resets,
    })
}

/// Pull the number that appears immediately before `word` in a `·`-separated line.
fn number_before(text: &str, word: &str) -> Option<u32> {
    text.split('·').find_map(|part| {
        let part = part.trim();
        let value = part.strip_suffix(word)?;
        value.trim().parse().ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verbatim from a live account, so the parser is tested against the real thing.
    const REPORT: &str = "You are currently using your subscription to power your Claude Code usage

Current session: 58% used · resets Aug 1 at 12:30pm (Europe/Berlin)
Current week (all models): 25% used · resets Aug 5 at 10am (Europe/Berlin)
Current week (Fable): 0% used

What's contributing to your limits usage?
Approximate, based on local sessions on this machine — does not include other devices or claude.ai.

Last 24h · 2131 requests · 2 sessions
  100% of your usage came from subagent-heavy sessions
  98% of your usage was at >150k context
";

    #[test]
    fn every_limit_is_read_with_its_reset_time() {
        let summary = parse_text(REPORT).expect("a summary");

        assert_eq!(summary.limits.len(), 3);
        assert_eq!(summary.limits[0].label, "Current session");
        assert_eq!(summary.limits[0].percent, 58);
        assert_eq!(
            summary.limits[0].resets.as_deref(),
            Some("Aug 1 at 12:30pm (Europe/Berlin)")
        );
    }

    #[test]
    fn a_limit_without_a_reset_time_is_still_a_limit() {
        // "Current week (Fable): 0% used" has no reset clause at all.
        let summary = parse_text(REPORT).expect("a summary");
        let fable = summary
            .limits
            .iter()
            .find(|l| l.label.contains("Fable"))
            .expect("listed");
        assert_eq!(fable.percent, 0);
        assert_eq!(fable.resets, None);
    }

    #[test]
    fn the_categories_are_not_hard_coded() {
        // Anthropic's to change — "Current week (Fable)" did not exist a year ago. A struct with
        // three named fields would silently drop a fourth; a list shows whatever is there.
        let summary = parse_text("Something New: 7% used\n").expect("a summary");
        assert_eq!(summary.limits.len(), 1);
        assert_eq!(summary.limits[0].label, "Something New");
    }

    #[test]
    fn the_request_and_session_counts_are_read() {
        let summary = parse_text(REPORT).expect("a summary");
        assert_eq!(summary.requests_24h, Some(2131));
        assert_eq!(summary.sessions_24h, Some(2));
    }

    #[test]
    fn prose_is_not_mistaken_for_a_figure() {
        // The report is mostly sentences, several of which contain a colon or a percentage.
        assert!(parse_limit("You are currently using your subscription").is_none());
        assert!(parse_limit("  100% of your usage came from subagent-heavy sessions").is_none());
        assert!(parse_limit("Approximate, based on local sessions: not a limit").is_none());
    }

    #[test]
    fn a_report_with_no_figures_at_all_is_nothing_to_show() {
        // Rather than an empty panel that reads as "0% used".
        assert!(parse_text("You are on a plan that does not report limits.\n").is_none());
        assert!(parse_text("").is_none());
    }

    #[test]
    fn the_json_envelope_is_unwrapped_and_a_broken_one_is_survived() {
        let json = serde_json::json!({ "result": "Current session: 12% used\n" }).to_string();
        assert_eq!(parse(&json).expect("a summary").limits[0].percent, 12);

        assert!(parse("not json").is_none());
        assert!(parse(r#"{"is_error":true}"#).is_none());
    }
}
