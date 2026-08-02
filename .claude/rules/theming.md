---
id: rule:theming
title: Theming
tldr: "Colour SSOT: :root + @theme tokens in globals.css, hex mirrored in palette.ts. Every design-system rule lives in a @layer, or it beats the caller's utilities."
scope: frontend
load: conditional
triggers:
  [
    theme,
    color,
    hud,
    css,
    style,
    palette,
    layer,
    cascade,
    classname,
    override,
    utility,
    tailwind,
    specificity,
  ]
applies-to: ["src/styles/**", "src/**/theme*"]
---

# Theming (ADR-APP-020)

- **Colour SSOT (two mirrored places, nothing else):**
  - `src/styles/globals.css` `:root` holds the palette as CSS variables (`--saga-*`); an `@theme inline`
    block exposes them as Tailwind colour tokens (`text-fg`, `text-dim`, `text-cyan`, `bg-elevated`, ...).
    Use those tokens in `className`, never raw hex. Inline DOM styles use `var(--saga-*)`.
  - `src/styles/palette.ts` (`PALETTE`) mirrors the same hex for **JavaScript** use — canvas rendering
    and the few inline styles that cannot resolve CSS `var()`. Keep it in sync with `:root`. These are
    the **only two** files allowed to contain raw hex.
- HUD palette: bg `#0a0a0f`/`#12121a`/`#1a1a2e`; accents cyan `#00e5ff`, green `#00ff88`, gold `#ffd700`,
  purple `#b44aff`, danger `#ff3366`; text `#e0e0e0`/`#9aa4b2`. Fonts: Inter, JetBrains Mono, Orbitron.
- Chamfered corners (`clip-path`) and neon glow are CSS utilities (`.hud-clip*`, `.hud-panel`, `.hud-btn`) —
  reuse them, do not reinvent per component.

## Every design-system rule lives in a `@layer` (ADR-APP-026)

**A rule written outside a layer beats every Tailwind utility** — regardless of specificity, regardless
of source order. That is the cascade-layer spec, not a quirk. Since every primitive in
`src/components/ui/` accepts a `className`, an unlayered base class makes that prop a false promise:
for any property the base class declares, the caller's utility is not overridden, it is *unreachable*.

- **Component classes** (`.hud-panel`, `.hud-btn`, `.window-frame`, …) → `@layer components`.
- **Single-purpose helpers** (`.neon-glow-*`, `.text-glow-*`, `.no-scrollbar`) → `@layer utilities`,
  where they compete with Tailwind's own on equal terms instead of outranking them.
- **Element-level styling** (`input[type="range"]`, …) → `@layer base`.
- **`@keyframes` and `@property` go inside the layer that uses them**, not at column 0. Lightning CSS
  eliminates keyframes it believes are unused, and a usage inside `@layer components` does not reliably
  match a definition outside it — the production build then ships an `animation:` naming keyframes that
  are not in the file. `@property` fails worse: it silently loses its type, so the animation runs and
  does not animate. Nothing upstream of the built file can see either.
- Adding a rule at column 0 fails `src/styles/layers.test.ts`. Nothing else in the gate can see this —
  unlayered CSS is valid, lints clean and renders correctly in isolation.

## Nothing in the window chrome is sized from the viewport

A box sized in `vmax`/`vw`/`vh` grows a composited layer with the window. On WebKit that layer is not
re-rasterised correctly after a resize and the frame loses a corner; Blink tiles oversized layers and
hides it entirely, so it cannot be found by developing on Windows (docs/migrations/app-112). Anchor a
gradient with `background-size`/`background-position` instead and keep every *box* small and bounded.
`src/styles/window-frame.test.ts` rejects viewport-sized boxes in the frame.

**What layering does not fix, and must not be assumed to:** two Tailwind utilities that set the same
property are in the *same* layer, so the generated sheet's order decides — not the order in
`className`. `className="relative absolute"` still resolves by Tailwind's ordering. Pass one utility
per property, or wrap the element.
