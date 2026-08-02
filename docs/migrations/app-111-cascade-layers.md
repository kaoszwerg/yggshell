# 111 — `.hud-*` classes are now in `@layer components`, so `className` can override them

Audience: the agent working in a project **forked from this Tauri shell**.
Layer: **app** — `src/styles/globals.css` is **your** file. `governance:update` does **not** change it.
Port this by hand.

**This flips a behaviour, silently, in the direction you probably want — but check first.** Read the
"before you port" section below.

## What was wrong

Every design-system class in `globals.css` — `.hud-panel`, `.hud-btn`, `.hud-clip*`, `.window-frame`,
the glow helpers — was defined **outside any `@layer`**. Only `@layer base` existed.

Unlayered rules beat layered ones **regardless of specificity and regardless of source order**. That is
the cascade-layer spec, not a quirk. Tailwind's utilities live in `@layer utilities`. So a `.hud-*`
class won over every utility, always.

Every primitive in `src/components/ui/` accepts a `className`. Accepting one is a promise that the
caller can adjust the result — and for any property the base class also declared, that promise was
false. Not overridden with a warning, not last-one-wins: **structurally unreachable.**

Measured against the shipped stylesheet, before and after:

| Markup                            | before      | after       |
| --------------------------------- | ----------- | ----------- |
| `.hud-panel` + `absolute`         | `relative`  | `absolute`  |
| `.hud-btn` + `static`             | `relative`  | `static`    |
| `.hud-panel` + `bg-elevated`      | HUD accent  | `#1a1a2e`   |

The properties that were unreachable: `position`, `background`, `color`, `isolation`, `clip-path`,
`transition`.

## Before you port

**This flips the cascade for anything that currently relies on the override.** Nothing warns you. Look
for places where you pass a utility to a primitive and *expected it to lose* — most likely somewhere the
base class's `position`, `background` or `color` is doing the real work and a leftover utility was
harmless until now.

In this template the flip was a no-op: the only utilities passed to primitives were
`max-w-2xl mt-1 px-2.5 px-4 py-1 py-1.5 text-xs tracking-wider uppercase w-full`, none of which collides
with a base declaration. Your fork may differ — that check is the whole cost of this migration.

## What to do

Wrap the rules in `globals.css`, by kind:

- **Component classes** → `@layer components`: `.hud-clip`, `.hud-clip-sm`, `.hud-panel` (+ `::before`,
  `::after`), `.hud-popover`, `.hud-label`, `.hud-divider`, `.hud-accent-*`, `.hud-grid-bg`,
  `.hud-strip`, `.hud-strip-bottom`, `.hud-btn` (+ pseudo/hover), `.hud-btn-active`, `.window-frame`
  and its children, and the `prefers-reduced-motion` query that goes with them.
- **Single-purpose helpers** → `@layer utilities`: `.neon-glow-*`, `.text-glow-*`, `.no-scrollbar`.
  Not `components` — they should compete with Tailwind's utilities on equal terms, not sit below them.
- **Element-level styling** → `@layer base`: `input[type="range"]` and friends.
- `@keyframes` is not subject to the cascade; leave it at top level.

Layer order comes from `@import "tailwindcss"` (theme, base, components, utilities). Joining those
existing layers is what makes this work — do not invent new layer names.

## What is now forbidden

- **No rule at column 0 in `globals.css`.** An unlayered rule outranks every utility in the project,
  which is never what you want for a class a caller can be handed.
- **Do not "fix" a lost override with `!important` or a raised selector.** That re-creates the same
  unreachability one level up. Put the rule in the right layer.

## The gate

`src/styles/layers.test.ts` fails on any unlayered class or element rule, checks that the component
classes are in `components` and the helpers in `utilities`, and checks the layer order. Port it with
the change — **it is the only thing in the gate that can see this.** Unlayered CSS is valid, lints
clean, typechecks clean and renders correctly in isolation; the defect appears only when a caller
passes a utility, and then it appears as nothing happening.

Verified as a negative control: the suite goes red against the pre-refactor stylesheet.

## What this does NOT fix

Two Tailwind utilities setting the same property are in the **same** layer, so the generated sheet's
order decides — not the order in `className`. `className="relative absolute"` still resolves to
whichever Tailwind emits last (`relative`, as it happens). Layering makes the *caller* beat the
*design system*; it does not make the caller's last class win over their own earlier one. Pass one
utility per property, or wrap the element.
