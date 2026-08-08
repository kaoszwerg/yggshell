# Signing YggShell on macOS

`.envrc` points here, and for a while this file did not exist. It covers two different problems that
are easy to confuse, because both are answered by the word "signing" and only one of them is about
Gatekeeper.

| Problem | Whose | Answer |
| ------- | ----- | ------ |
| macOS re-asks for permission after **every** local build | yours, daily | a **stable** signing identity — any one |
| Gatekeeper warns on **somebody else's** machine | a release's | a **Developer ID** certificate **and notarisation** |

---

## 1. The daily one: permission prompts that never stay answered

**Symptom.** *"YggShell möchte auf Daten aus anderen Apps zugreifen"* — and again after the next
install, and the one after that.

**Cause, measured.** macOS records a TCC decision against the app's **code signature**. An unsigned
build is *ad-hoc* signed:

```
$ codesign -dv --verbose=2 /Applications/YggShell.app
Identifier=yggshell-40aa1ef1bdb6bd72
Signature=adhoc
TeamIdentifier=not set
```

There is no stable identity there, so the system falls back to the binary's `cdhash` — which changes
with **every build**. Five installs in one day were five different applications to TCC, and every
"Erlauben" was void with the next DMG. This is not a defect; it is the absence of a signature.

**Fix.** Any stable identity. It does *not* have to be a Developer ID — an Apple Development
certificate is enough, because what TCC stores is the designated requirement:

```
designated => identifier "com.kaoszwerg.yggshell"
              and anchor apple generic
              and certificate leaf[subject.CN] = "Apple Development: … (W8588UQ62P)"
```

Bundle identifier and certificate, both stable across rebuilds. No `cdhash`.

```bash
security find-identity -v -p codesigning     # what this machine has
```

Put the one you want into **`.envrc.local`** — git-ignored, machine-specific, and the file `.envrc`
already sources:

```bash
export APPLE_SIGNING_IDENTITY="Apple Development: … (XXXXXXXXXX)"
```

Then `npm run app:build` as usual. `scripts/project/build-release.mjs` copies the environment and
deletes only `TAURI_CONFIG` (rule:live-app), so this reaches `tauri build` unchanged.

**Expect exactly one more prompt**, because the identity has changed from ad-hoc to signed. After
that it stays answered, including across future builds.

**And answer it with "Nicht erlauben" unless you mean otherwise.** The prompt is about *other apps'*
data — `~/Library/Application Support/<another bundle id>`, `~/Library/Containers`. Nothing in this
app reads those. It is raised by **commands run inside a terminal**, because macOS attributes a file
access to the *responsible* process, which is the window rather than the shell. An agent running
`sqlite3` against another application's database is the ordinary case, and refusing it costs the app
nothing.

A signed build also gets `flags=0x10000(runtime)` — the hardened runtime, which an unsigned one
cannot have.

---

## 2. The release one: Gatekeeper on a machine that did not build it

**A development certificate does not help here.** Distribution outside the App Store needs a
**Developer ID Application** certificate *and* notarisation by Apple. Without both, a downloaded
build is quarantined on any machine but the one that produced it.

`release.yml` already does the whole thing at a version tag — when six secrets are present, and it
builds unsigned when they are not (ADR-APP-023, rule:stack-release):

| Secret | What it is |
| ------ | ---------- |
| `APPLE_CERTIFICATE` | the Developer ID **Application** certificate, base64 of a `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | its export password |
| `APPLE_SIGNING_IDENTITY` | the certificate's common name, verbatim |
| `APPLE_ID` | the Apple account the notarisation runs under |
| `APPLE_PASSWORD` | an **app-specific** password for it, never the account password |
| `APPLE_TEAM_ID` | the team the certificate belongs to |

**None of them is set today**, which is recorded in `mem:open-work-backlog` rather than left to be
rediscovered. Until they are, a release is unsigned and says so.

**Do not put these in `.envrc.local`.** They belong in the repository's secrets, where the release
build reads them; a notarisation password in a file on a laptop is a credential in the wrong place
(rule:security — credentials belong in the keyring or in the secret store, never in a data file).

---

## What to check when it goes wrong

```bash
codesign -dv --verbose=2 <path to .app>   # identity, team, flags
codesign -d -r- <path to .app>            # the designated requirement TCC stores
spctl -a -vvv <path to .app>              # what Gatekeeper makes of it
xattr -l <downloaded .dmg>                # com.apple.quarantine present?
```

**Why this file exists at all:** the recurrence was diagnosed three times before anyone measured the
signature, and each time the conclusion was "macOS is being odd". It is not — an ad-hoc build has no
identity to remember, and that is visible in one command.
