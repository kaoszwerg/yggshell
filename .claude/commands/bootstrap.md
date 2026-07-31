---
description: Bootstrap a fresh saga-rust-template copy into a new project (identity, icons, reset)
argument-hint: "[app display name]"
---

You are bootstrapping a fresh copy of the `saga-rust-template` template into a NEW project. Work as a
senior release engineer and verify with `check:all` at the end. Do this in order.

## 1. Gather the new identity

Ask the maintainer (use AskUserQuestion if available) for anything not already given in `$ARGUMENTS`:

- **Display name** (e.g. "Acme Studio").
- **Vendor / org** for the bundle identifier (e.g. "acme").
- **Tagline** and a **one-paragraph description**.
- **Upstream template repo** slug (default `kaoszwerg/saga-rust-template`) so `governance:update` works.

## 2. Set the identity (single source of truth, ADR-APP-031)

Edit **`app.identity.json`** — the ONLY place the identity is defined — with derived, valid values:

- `displayName` — the display name (may contain spaces).
- `binaryName` — filesystem-safe (no spaces), for the Cargo bin / Tauri `mainBinaryName`.
- `packageName` — kebab-case (npm).
- `crateName` — snake_case, a valid Rust identifier (the lib crate is `<crateName>_lib`).
- `identifier` — reverse-DNS `com.<vendor>.<app>`, lowercase.
- `vendor`, `tagline`, `description`.

Then run, in order:

- `node scripts/bootstrap.mjs --upstream <upstream-slug>` — resets the version to 0.1.0, resets the
  CHANGELOG, and marks the repo a fork (enables `governance:update` + the drift-gate).
- `npm run identity:sync` — propagates the identity into `package.json`, `Cargo.toml`, the tauri
  configs, `src/lib/app.ts`, `index.html` and the crate references. Nothing else is hand-edited;
  `identity:check` (in `check:all`) guards against drift.

## 3. Generate icons

Design a new `src-tauri/icons/icon.svg` that fits the app (simple, high-contrast, legible at 32px),
rasterize it to a 1024×1024 PNG (e.g. via `npx sharp`/`resvg`, or ask the maintainer to export one),
then regenerate the full icon set: `npm run tauri icon <path-to-1024.png>`. A maintainer-supplied
1024px brand PNG takes precedence over the generated SVG.

## 4. Verify

Run `npm run gen:types`, then `npm run check:all`, and fix anything red. Start the app once
(`npm run app:dev`) and confirm it launches under the new name.

## 5. Clean up the template-creation artifacts

This project is no longer a template *creator*, so remove the create-from-template artifacts:

- delete `docs/howto/new-project-from-template.md`;
- remove the "Create a project from this template" section from `README.md` (the only place that links
  the howto);
- delete this command (`.claude/commands/bootstrap.md`).

The pinned `CLAUDE.md` deliberately does not link the howto, so removing it leaves the dead-link check
(`governance:check`) green. Keep all the governance tooling (`governance:sync`/`check`/`update`,
`identity:sync`) — it works in the project.

## 6. Project-specific governance

Add any project-specific rules/ADRs to the **project line** — `.claude/rules/project/` and
`docs/adr/project/` — never edit the template's core in place (the drift-gate blocks it; see
`rule:rule-maintenance` / ADR-CORE-030). Report what changed; do NOT commit — the maintainer reviews the
`git diff` and commits (`rule:git-workflow`).
