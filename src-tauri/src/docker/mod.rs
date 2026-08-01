//! What Docker is running, for a project that is developed against containers.
//!
//! **Read-only, and that is a decision rather than an omission.** Starting and stopping a container
//! is a *command*, and the rule this app holds to is that the webview never chooses what runs
//! (ADR-PROJ-001 §5). A referenced action — "stop the container with this id" — could be made to
//! satisfy that rule, but it is a change in what the app is allowed to do, and it belongs in an ADR
//! with the maintainer's name on it rather than in a widget that grew one. The terminal is beside
//! the panel and `docker` is on the PATH.
//!
//! **No Docker is not an error.** Plenty of machines have none, and plenty of projects do not use
//! it. The tool says so and gets out of the way, which is why every failure here returns an empty
//! list rather than propagating.

use crate::dto::ContainerInfo;
use std::process::{Command, Stdio};

/// Ask the daemon what exists, running or not.
///
/// `-a` deliberately: a container that *stopped* is exactly what you are looking for when something
/// that should be answering is not, and a list of only-running containers cannot show it.
pub fn containers() -> Vec<ContainerInfo> {
    let Some(docker) = crate::terminal::environment::which("docker") else {
        tracing::debug!("no docker on PATH — the container list will be empty");
        return Vec::new();
    };
    // A tab-separated format rather than `{{json .}}`: the JSON shape has changed between versions
    // and carries thirty fields, of which six are wanted. This is the documented, stable half.
    let format = "{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}\t{{.Label \"com.docker.compose.project\"}}";
    let Ok(output) = Command::new(docker)
        .args(["ps", "-a", "--no-trunc", "--format", format])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        // The daemon is not running, or this user may not talk to it. Both are "nothing to show".
        tracing::debug!("docker ps returned non-zero — the daemon is probably not running");
        return Vec::new();
    }
    parse(&String::from_utf8_lossy(&output.stdout))
}

/// Parse the tab-separated listing.
///
/// Split from the command so the format string — which is the contract with `docker` — can be tested
/// against real output without a daemon.
pub fn parse(text: &str) -> Vec<ContainerInfo> {
    let mut out: Vec<ContainerInfo> = text
        .lines()
        .filter_map(|line| {
            let mut f = line.split('\t');
            let id = f.next()?.trim().to_string();
            let name = f.next()?.trim().to_string();
            let state = f.next()?.trim().to_string();
            let status = f.next()?.trim().to_string();
            let image = f.next()?.trim().to_string();
            let ports = f.next().unwrap_or("").trim().to_string();
            let project = f.next().unwrap_or("").trim().to_string();
            if id.is_empty() || name.is_empty() {
                return None;
            }
            Some(ContainerInfo {
                // Twelve characters is what every docker command accepts and what `docker ps` shows
                // without `--no-trunc`; the full id is unreadable and nobody types it.
                id: id.chars().take(12).collect(),
                name,
                state,
                // `Up 3 hours (healthy)` — the health check's verdict is in here and nowhere else in
                // this output, so it is kept verbatim rather than parsed into a flag that would lose
                // "starting" and "unhealthy".
                status,
                image,
                ports: published(&ports),
                project: if project.is_empty() {
                    None
                } else {
                    Some(project)
                },
            })
        })
        .collect();
    // Grouped by project, then by name, so a compose stack reads as one block.
    out.sort_by(|a, b| {
        a.project
            .cmp(&b.project)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

/// Keep only the ports actually reachable from the host, deduplicated.
///
/// `docker ps` reports `0.0.0.0:3000->80/tcp, [::]:3000->80/tcp, 8000/tcp`. The first two are the
/// same published port twice (IPv4 and IPv6); the third is exposed inside the network and reachable
/// from nowhere the user can type. Showing all three implies three ways in, two of which do not
/// exist.
fn published(ports: &str) -> Vec<String> {
    let mut seen = Vec::new();
    for part in ports.split(',') {
        let part = part.trim();
        let Some((host, container)) = part.split_once("->") else {
            continue;
        };
        let Some((_, port)) = host.rsplit_once(':') else {
            continue;
        };
        let entry = format!(
            "{port}→{}",
            container.split('/').next().unwrap_or(container)
        );
        if !seen.contains(&entry) {
            seen.push(entry);
        }
    }
    seen
}

/// The last lines of a container's log.
///
/// Bounded on purpose: a container that has been up for a week has a log nobody wants in a panel,
/// and an unbounded read would cross the IPC boundary in full before anything appeared.
pub fn logs(id: &str, lines: u32) -> String {
    if !is_container_id(id) {
        tracing::warn!(id, "refused a container id that is not one");
        return String::new();
    }
    let Some(docker) = crate::terminal::environment::which("docker") else {
        return String::new();
    };
    let Ok(output) = Command::new(docker)
        .args(["logs", "--tail", &lines.to_string(), id])
        .stdin(Stdio::null())
        .output()
    else {
        return String::new();
    };
    // Containers write to both, and which one carries the interesting line is the application's
    // choice, not ours.
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

/// Whether a string is a container id and nothing else.
///
/// The id arrives from the webview and is handed to a process. It is not a shell string — there is
/// no shell here — but "hex only" is cheap, and an id that is not one means the frontend is confused
/// or somebody is trying something (rule:security: validate at the boundary, treat the client as
/// hostile even when you wrote it).
pub fn is_container_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit())
}

/// What the running containers are consuming right now.
///
/// **Deliberately separate from [`containers`], because it is not free.** `docker stats` computes a
/// CPU percentage from a delta, so it samples twice and returns after ~2 s no matter how many
/// containers exist — measured at 1.9–2.0 s for six. The listing costs milliseconds. Joining them
/// into one call would make opening the panel feel broken and would keep paying that price for a
/// panel nobody has open, so the caller fetches this only while the tool is on screen and at an
/// interval well above the call's own duration (`components/tools/DockerTool`).
///
/// `--no-stream` is what makes it a single answer instead of a live feed: a feed would be a process
/// running for as long as the app is open, which is the kind of permanent cost this app measures
/// before it accepts (mem:open-work-backlog).
pub fn stats() -> Vec<crate::dto::ContainerStats> {
    let Some(docker) = crate::terminal::environment::which("docker") else {
        return Vec::new();
    };
    let format = "{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}";
    let Ok(output) = Command::new(docker)
        .args(["stats", "--no-stream", "--no-trunc", "--format", format])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        tracing::debug!("docker stats returned non-zero — the daemon is probably not running");
        return Vec::new();
    }
    let stats = parse_stats(&String::from_utf8_lossy(&output.stdout));
    tracing::debug!(count = stats.len(), "read docker container stats");
    stats
}

/// Parse the tab-separated stats listing.
///
/// Split from the command for the same reason as [`parse`]: the format string is the contract with
/// `docker`, and it can be checked against real output without a daemon.
pub fn parse_stats(text: &str) -> Vec<crate::dto::ContainerStats> {
    text.lines()
        .filter_map(|line| {
            let mut f = line.split('\t');
            let id: String = f.next()?.trim().chars().take(12).collect();
            if id.is_empty() {
                return None;
            }
            let cpu_percent = percent(f.next()?)?;
            // `679.5MiB / 2GiB` — the limit is the host's total when the container has none.
            let usage = f.next()?;
            let (used, limit) = usage.split_once('/')?;
            let mem_percent = percent(f.next().unwrap_or("0%")).unwrap_or(0.0);
            Some(crate::dto::ContainerStats {
                id,
                cpu_percent,
                mem_used: bytes(used)?,
                mem_limit: bytes(limit)?,
                mem_percent,
            })
        })
        .collect()
}

/// `23.47%` -> `23.47`. A value docker could not compute (`--`) is not a zero, it is no value.
fn percent(text: &str) -> Option<f64> {
    text.trim().trim_end_matches('%').trim().parse().ok()
}

/// `679.5MiB` -> bytes. Docker writes binary units here; the decimal spellings are accepted too
/// because the same field has used them, and being wrong by 2.4 % is better than showing nothing.
fn bytes(text: &str) -> Option<f64> {
    let text = text.trim();
    let split = text.find(|c: char| !c.is_ascii_digit() && c != '.')?;
    let (number, unit) = text.split_at(split);
    let value: f64 = number.trim().parse().ok()?;
    let scale = match unit.trim().to_ascii_lowercase().as_str() {
        "b" => 1.0,
        "kib" => 1024.0,
        "kb" => 1000.0,
        "mib" => 1024.0 * 1024.0,
        "mb" => 1_000_000.0,
        "gib" => 1024.0 * 1024.0 * 1024.0,
        "gb" => 1_000_000_000.0,
        "tib" => 1024.0_f64.powi(4),
        "tb" => 1e12,
        _ => return None,
    };
    Some(value * scale)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PS: &str = "e7297b70bd2a\tapp-backend\trunning\tUp 3 hours (healthy)\tapp-backend\t8000/tcp\tapp\n9f3c822e8334\tapp-nginx\trunning\tUp 3 hours\tnginx:alpine\t0.0.0.0:3000->80/tcp, [::]:3000->80/tcp\tapp\ncca7acd39014\tloose-one\texited\tExited (0) 2 days ago\tredis\t\t\n";

    #[test]
    fn a_stopped_container_is_listed_too() {
        // The one you are looking for when something that should answer does not.
        let list = parse(PS);
        let stopped = list.iter().find(|c| c.name == "loose-one").expect("listed");
        assert_eq!(stopped.state, "exited");
        assert!(stopped.status.starts_with("Exited"));
    }

    #[test]
    fn the_health_verdict_survives() {
        // `(healthy)`, `(unhealthy)` and `(health: starting)` live only in this string. Reducing it
        // to a boolean would throw away the two states worth acting on.
        let list = parse(PS);
        assert!(list
            .iter()
            .any(|c| c.status.contains("healthy") && c.name == "app-backend"));
    }

    #[test]
    fn only_published_ports_are_shown_and_only_once() {
        // `0.0.0.0:3000->80/tcp, [::]:3000->80/tcp` is ONE way in, listed twice; `8000/tcp` is not a
        // way in at all. Showing all three implies three, two of which do not exist.
        let list = parse(PS);
        let nginx = list.iter().find(|c| c.name == "app-nginx").expect("listed");
        assert_eq!(nginx.ports, vec!["3000→80"]);

        let backend = list
            .iter()
            .find(|c| c.name == "app-backend")
            .expect("listed");
        assert!(backend.ports.is_empty(), "8000/tcp is not published");
    }

    #[test]
    fn containers_are_grouped_by_project() {
        let list = parse(PS);
        // The unlabelled one sorts apart from the compose stack rather than between its members.
        assert_eq!(
            list.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["loose-one", "app-backend", "app-nginx"]
        );
        assert_eq!(list[0].project, None);
        assert_eq!(list[1].project.as_deref(), Some("app"));
    }

    #[test]
    fn the_id_is_shortened_to_what_a_person_can_use() {
        assert_eq!(parse(PS)[1].id, "e7297b70bd2a");
    }

    #[test]
    fn a_malformed_line_is_skipped_rather_than_half_read() {
        assert!(parse("nonsense\n\t\t\n").is_empty());
    }

    #[test]
    fn nothing_at_all_is_an_empty_list() {
        assert!(parse("").is_empty());
    }

    #[test]
    fn only_a_real_container_id_is_accepted() {
        // It arrives from the webview and is handed to a process.
        assert!(is_container_id("e7297b70bd2a"));
        assert!(!is_container_id(""));
        assert!(!is_container_id("../etc/passwd"));
        assert!(!is_container_id("e7297b70bd2a; rm -rf /"));
        assert!(!is_container_id(&"a".repeat(65)));
    }

    #[test]
    fn logs_refuse_an_id_that_is_not_one() {
        assert_eq!(logs("not an id", 10), "");
    }

    /// Verbatim from `docker stats --no-stream --no-trunc` on this machine.
    const STATS: &str = "e7297b70bd2a1f4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4\t23.47%\t679.5MiB / 2GiB\t33.18%
b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f900\t0.00%\t12.5MiB / 7.654GiB\t0.16%";

    #[test]
    fn cpu_and_memory_are_read_from_the_real_format() {
        let s = parse_stats(STATS);

        assert_eq!(s.len(), 2);
        assert_eq!(s[0].cpu_percent, 23.47);
        assert_eq!(s[0].mem_used, 679.5 * 1024.0 * 1024.0);
        assert_eq!(s[0].mem_limit, 2.0 * 1024.0 * 1024.0 * 1024.0);
        assert_eq!(s[0].mem_percent, 33.18);
    }

    #[test]
    fn the_id_is_shortened_the_same_way_the_listing_shortens_it() {
        // The two are joined on this in the frontend. Different lengths would mean no container ever
        // shows a figure, and nothing would look broken enough to investigate.
        assert_eq!(parse_stats(STATS)[0].id, "e7297b70bd2a");
        assert_eq!(parse_stats(STATS)[0].id, parse(PS)[1].id);
    }

    #[test]
    fn a_cpu_docker_could_not_compute_is_dropped_rather_than_shown_as_zero() {
        // `--` appears for a container that is starting or has just stopped. Zero would be a claim.
        assert!(parse_stats("abc\t--\t0B / 0B\t--").is_empty());
    }

    #[test]
    fn both_binary_and_decimal_units_are_read() {
        let s = parse_stats("abc\t1%\t1KiB / 1MB\t1%");
        assert_eq!(s[0].mem_used, 1024.0);
        assert_eq!(s[0].mem_limit, 1_000_000.0);
    }

    #[test]
    fn a_malformed_stats_line_costs_that_line_and_nothing_else() {
        let s = parse_stats(&format!("rubbish\n{STATS}"));
        assert_eq!(s.len(), 2);
    }

    #[test]
    fn no_containers_is_an_empty_list_not_a_failure() {
        assert!(parse_stats("").is_empty());
    }
}
