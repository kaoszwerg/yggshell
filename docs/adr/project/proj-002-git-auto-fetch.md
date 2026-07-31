---
id: ADR-PROJ-002
title: The Git tool may fetch, and nothing else may reach the network
tldr: "The one outbound connection this app makes: git fetch, to refresh ahead/behind. Switchable, non-interactive, bounded, and it cannot touch the working tree."
scope: project
load: conditional
status: accepted
date: 2026-07-31
triggers:
  [git, fetch, remote, network, egress, ahead, behind, upstream, privacy, offline, credentials]
applies-to:
  ["src-tauri/src/git/**", "src/components/tools/**", "src/hooks/useGitSnapshot.ts"]
---

# ADR-PROJ-002 — The Git tool may fetch, and nothing else may reach the network

## Context

`rule:privacy` is unambiguous: **no egress by default**, and any outbound flow is "an explicit, opt-in
feature with its own ADR, off unless the user turns it on". This is that ADR, and it argues for a
default of **on** — so the reasoning has to carry that weight rather than assume it.

The Git tool shows `↑2 ↓0` beside the branch. Those numbers come from the *local* remote-tracking ref
(`refs/remotes/origin/main`), and that ref only moves when something fetches. Nothing in this app
fetched. So the tool did not show a stale number — it showed a **wrong** one, and confidently: not
"unknown", but "zero commits behind", while upstream had moved on. The error grows silently with time,
which is the property that makes it worth fixing rather than documenting.

Two ways out were considered:

1. **Say how old the numbers are** — grey them out, add "as of 3 h ago". No network, no setting, no
   ADR. Honest, and useless: the maintainer's answer to it was *"I need to know what's going on with
   the remote"*, which a timestamp does not tell them.
2. **Fetch.** Correct numbers, at the cost of the first outbound connection this app has ever made.

## Decision

**The Git tool fetches, on a timer while it is open and on the refresh button that already exists.
Nothing else in the app reaches the network.**

It is a setting (`git_auto_fetch`), and it defaults to **on**.

### Why on by default, against the rule's grain

The rule exists to stop an application phoning **its author** — telemetry, analytics, crash uploads,
update pings. Every clause of it is about data leaving the user's machine for someone else's benefit.
This is a different thing on every count:

- the host is one **the user configured**, in a repository they chose to open;
- nothing of ours is transmitted — it is git's own protocol, with git's own credentials;
- the app learns nothing it did not already have; it refreshes a number it was already showing;
- it happens *because* a repository is being displayed, and stops when the tool is closed.

A default of off would mean the tool ships showing a wrong number until someone finds a setting that
explains why. That is a worse outcome than the traffic, and the traffic is one request every five
minutes to a host the user's own `git` talks to anyway.

The setting remains, because the judgement above is ours and the machine is theirs.

### Why `git fetch` and not gix's network client

`gix` can fetch. The hard part is not the protocol, it is **authentication**: an SSH agent, a
credential helper, a hardware key, a per-host entry in the user's own config, an organisation's SSO.
`git` has all of it already, configured by the user, working today. Shipping a second network and TLS
stack to reimplement it would be a large amount of code whose *best possible outcome* is behaving like
the tool already on the machine. Same reasoning as `tmux` (ADR-PROJ-001): use the program the user has.

The cost is a dependency on `git` being on `PATH`. When it is not, the counts simply are not refreshed
and the tool says so — nothing breaks.

### The constraints that make this safe

- **`fetch` cannot touch the working tree.** It writes remote-tracking refs and objects: no merge, no
  checkout, no index. This is exactly why it is the one network operation permitted here, and why
  `pull` is not — a pull can produce a conflict in a tree an agent is editing.
- **Never interactive.** `GIT_TERMINAL_PROMPT=0`, empty `GIT_ASKPASS`/`SSH_ASKPASS`, and
  `ssh -o BatchMode=yes`. This runs on a timer with no terminal attached; a credential prompt would
  block until the timeout with nothing on screen to explain it. A remote needing credentials we do not
  have fails, and the failure is shown.
- **Bounded.** Twenty seconds, then abandoned — a VPN that is down or a host that blackholes the
  connection must not leave the counts frozen with no explanation.
- **Read-only, still.** The rest of `git/` remains what ADR-PROJ-001 made it: nothing stages, commits,
  pushes or checks out. This ADR widens that by one verb, and names the verb.

## Consequences

- The counts are true, or the tool says why they are not.
- One outbound request per open Git tool per interval. It is visible in the log, like everything else.
- Anyone who wants zero egress turns one setting off and gets exactly the previous behaviour.
- **Actions are still not on the table.** `commit`, `push` and `pull` were discussed and declined: in a
  terminal they are one word each, and a second actor writing to a tree an agent is working in is a
  combination nobody asked for (ADR-PROJ-001). If that is ever revisited, it is a new ADR, not an
  extension of this one.
