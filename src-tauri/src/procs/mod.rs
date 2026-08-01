//! What a terminal tab is actually running, and which ports it has open.
//!
//! **The question this answers.** A harness starts a dev server, a watcher, a build; you close the
//! tab, or it scrolls away, and nothing in the interface says any of it is still there. The next run
//! then fails on a port that is already taken, somewhere else entirely, with an error that names
//! neither the process nor the tab it came from.
//!
//! **Reading only.** Nothing here starts or stops anything, and no command line crosses the IPC
//! boundary (ADR-PROJ-001 §5): the frontend names a session, and the backend decides what to ask the
//! operating system.
//!
//! **Inside tmux the tree is somewhere else.** A tab attached to tmux has exactly one child — the
//! client — while the real work runs under the tmux *server*, which is nobody's child. So the roots
//! are taken from tmux itself (`list-panes -F '#{pane_pid}'`), and a tab that is not in tmux uses
//! its own PTY child. Without that, this tool would show a single line reading "tmux" to the one
//! kind of user most likely to have forgotten a background process.

use crate::dto::{PortInfo, ProcessInfo};
use std::collections::{HashMap, HashSet};
use std::process::{Command, Stdio};

/// One row of `ps`, before the tree is assembled.
struct Row {
    pid: u32,
    ppid: u32,
    state: String,
    elapsed: String,
    command: String,
}

/// Ask `ps` for every process, in a fixed field order.
///
/// `ps` rather than a platform API: the portable version needs a different call per platform, this
/// runs on a user-driven refresh rather than a timer, and the output format is a stable contract
/// that has outlived most APIs (the same reasoning as `terminal::attached`).
fn ps_rows() -> Vec<Row> {
    let Ok(output) = Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,state=,etime=,args="])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        tracing::warn!("could not run ps — the process list will be empty");
        return Vec::new();
    };
    parse_ps(&String::from_utf8_lossy(&output.stdout))
}

/// Parse `ps -axo pid=,ppid=,state=,etime=,args=`.
///
/// Split out from the command so the shape of that output — which is the contract here — can be
/// tested without spawning anything.
fn parse_ps(text: &str) -> Vec<Row> {
    text.lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse().ok()?;
            let ppid = fields.next()?.parse().ok()?;
            let state = fields.next()?.to_string();
            let elapsed = fields.next()?.to_string();
            // Everything left is the command line, spaces and all — so it is taken as the remainder
            // rather than as one more field.
            let command = fields.collect::<Vec<_>>().join(" ");
            if command.is_empty() {
                return None;
            }
            Some(Row {
                pid,
                ppid,
                state,
                elapsed,
                command,
            })
        })
        .collect()
}

/// Everything descended from `roots`, roots included, in depth order.
///
/// Depth is carried rather than nesting the structure: the view draws an indented list, and a tree
/// of owned children would have to be flattened again on the other side of the boundary for no gain.
pub fn tree(roots: &[u32]) -> Vec<ProcessInfo> {
    descendants(&ps_rows(), roots)
}

/// The tree-walk itself, over rows that are already in hand.
fn descendants(rows: &[Row], roots: &[u32]) -> Vec<ProcessInfo> {
    let mut children: HashMap<u32, Vec<&Row>> = HashMap::new();
    for row in rows {
        children.entry(row.ppid).or_default().push(row);
    }
    let by_pid: HashMap<u32, &Row> = rows.iter().map(|r| (r.pid, r)).collect();

    let mut out = Vec::new();
    // Guards against a cycle in the reported parent chain. `ps` should never produce one, but this
    // walk would loop forever if it did, and a hung backend is a worse answer than a short list.
    let mut seen: HashSet<u32> = HashSet::new();

    fn walk(
        pid: u32,
        depth: u32,
        children: &HashMap<u32, Vec<&Row>>,
        by_pid: &HashMap<u32, &Row>,
        seen: &mut HashSet<u32>,
        out: &mut Vec<ProcessInfo>,
    ) {
        if !seen.insert(pid) {
            return;
        }
        if let Some(row) = by_pid.get(&pid) {
            out.push(ProcessInfo {
                pid: row.pid,
                parent: row.ppid,
                depth,
                state: row.state.clone(),
                elapsed: row.elapsed.clone(),
                command: row.command.clone(),
            });
        }
        for child in children.get(&pid).into_iter().flatten() {
            walk(child.pid, depth + 1, children, by_pid, seen, out);
        }
    }

    for root in roots {
        walk(*root, 0, &children, &by_pid, &mut seen, &mut out);
    }
    out
}

/// The TCP ports these processes are listening on.
///
/// Only theirs: `lsof` without a pid filter lists every socket the user owns, and a tool claiming
/// "this tab is serving on 5173" when the number belongs to another window is worse than showing
/// nothing.
pub fn listening(pids: &[u32]) -> Vec<PortInfo> {
    if pids.is_empty() {
        return Vec::new();
    }
    let list = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let Ok(output) = Command::new("/usr/sbin/lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", &list])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        // Not an error: lsof is absent on plenty of systems, and the rest of the tool still works.
        tracing::debug!("lsof unavailable — no ports will be listed");
        return Vec::new();
    };
    parse_lsof(&String::from_utf8_lossy(&output.stdout))
}

/// Parse `lsof -nP -iTCP -sTCP:LISTEN` output into one entry per port.
///
/// A process listening on both IPv4 and IPv6 produces two identical-looking rows; they are collapsed
/// so the view shows "3000" once rather than twice.
pub fn parse_lsof(text: &str) -> Vec<PortInfo> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for line in text.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        let (Some(command), Some(pid), Some(name)) = (fields.first(), fields.get(1), fields.get(8))
        else {
            continue;
        };
        let Ok(pid) = pid.parse::<u32>() else {
            continue;
        };
        // `*:5173`, `127.0.0.1:5173`, `[::1]:5173` — the port is what follows the last colon.
        let Some((address, port)) = name.rsplit_once(':') else {
            continue;
        };
        let Ok(port) = port.trim_end_matches(" (LISTEN)").parse::<u16>() else {
            continue;
        };
        if !seen.insert((pid, port)) {
            continue;
        }
        out.push(PortInfo {
            port,
            pid,
            command: (*command).to_string(),
            // Kept because it is the difference between "anyone on the network can reach this" and
            // "only this machine can", which is worth seeing at a glance.
            address: address.to_string(),
        });
    }
    out.sort_by_key(|p| p.port);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const PS: &str = "\
    1     0 Ss   07-03:23:24 /sbin/launchd
  100     1 S    01:00:00 /bin/zsh
  101   100 S    00:30:00 npm run dev
  102   101 R    00:29:59 node vite --port 5173
  200     1 S    02:00:00 /usr/bin/something-else
";

    #[test]
    fn a_tree_carries_everything_under_its_root_and_nothing_else() {
        let rows = parse_ps(PS);
        let tree = descendants(&rows, &[100]);
        let pids: Vec<_> = tree.iter().map(|p| p.pid).collect();

        assert_eq!(pids, vec![100, 101, 102]);
        // 200 is the user's other window. A tool that claimed it belonged to this tab would be
        // pointing at the wrong process, which is worse than pointing at none.
        assert!(!pids.contains(&200));
    }

    #[test]
    fn depth_is_reported_so_the_view_can_indent() {
        let rows = parse_ps(PS);
        let tree = descendants(&rows, &[100]);
        assert_eq!(
            tree.iter().map(|p| p.depth).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
    }

    #[test]
    fn a_command_line_keeps_its_spaces() {
        // `node vite --port 5173` is the whole answer; `node` alone is not.
        let rows = parse_ps(PS);
        let tree = descendants(&rows, &[100]);
        assert_eq!(
            tree.iter()
                .find(|p| p.pid == 102)
                .map(|p| p.command.as_str()),
            Some("node vite --port 5173")
        );
    }

    #[test]
    fn a_root_that_has_gone_yields_nothing_rather_than_erroring() {
        // A tab can close between the click and the read.
        assert!(descendants(&parse_ps(PS), &[9999]).is_empty());
    }

    #[test]
    fn several_roots_are_walked_without_repeating_a_shared_child() {
        // tmux hands back one pid per pane, and two panes can share an ancestor.
        let tree = descendants(&parse_ps(PS), &[100, 101]);
        assert_eq!(tree.iter().filter(|p| p.pid == 101).count(), 1);
    }

    #[test]
    fn a_parent_cycle_does_not_hang_the_backend() {
        // `ps` should never report one; if it ever does, a short answer beats a frozen app.
        let rows = parse_ps("  1     2 S 00:01 a\n  2     1 S 00:01 b\n");
        assert_eq!(descendants(&rows, &[1]).len(), 2);
    }

    const LSOF: &str = "\
COMMAND   PID  USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    12345 steve   23u  IPv4  0x123      0t0  TCP *:5173 (LISTEN)
node    12345 steve   24u  IPv6  0x456      0t0  TCP *:5173 (LISTEN)
postgres  777 steve    7u  IPv4  0x789      0t0  TCP 127.0.0.1:5432 (LISTEN)
";

    #[test]
    fn ports_are_listed_once_each_with_their_address() {
        let ports = parse_lsof(LSOF);

        assert_eq!(
            ports.len(),
            2,
            "IPv4 and IPv6 on one port is still one port"
        );
        assert_eq!(ports[0].port, 5173);
        assert_eq!(ports[0].address, "*");
        assert_eq!(ports[1].port, 5432);
        // Local-only versus reachable from the network is the distinction worth seeing.
        assert_eq!(ports[1].address, "127.0.0.1");
    }

    #[test]
    fn ports_come_back_in_numeric_order() {
        assert!(parse_lsof(LSOF).windows(2).all(|w| w[0].port <= w[1].port));
    }

    #[test]
    fn nothing_listening_is_an_empty_list_not_a_failure() {
        assert!(parse_lsof("COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n").is_empty());
        assert!(listening(&[]).is_empty());
    }
}
