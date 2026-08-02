---
id: ADR-PROJ-003
title: The window frame paints only the band
status: accepted
tldr: "The frame is one conic gradient sampled by four thin strips — never a window-sized element clipped to 1.5px. Both earlier designs did that; both failed."
scope: frontend
load: conditional
triggers:
  [
    frame,
    window-frame,
    border,
    band,
    glow,
    conic,
    conic-gradient,
    gradient,
    chamfer,
    clip-path,
    animation,
    animated,
    spin,
    rotate,
    resize,
    flicker,
    flickering,
    corner,
    repaint,
    composite,
    compositing,
    layer,
    will-change,
    vmax,
    texture,
    webkit,
    blink,
    gpu,
  ]
applies-to:
  - src/styles/globals.css
  - src/styles/globals.test.ts
  - src/App.tsx
---

# The window frame paints only the band

## Context

The HUD shell is drawn inside a frameless, transparent window whose entire outline is a **1.5 px
chamfered band** with a colour that travels around it. Three designs have now been built for it. The
first two failed in production, in opposite directions, and **both failures came from the same
decision**: produce an image the size of the window (or larger) and throw away 99.9 % of it through a
`clip-path`.

**v1 — paint the window.** A `conic-gradient` on `.window-frame` itself, with its `from` angle
animated through a registered `--frame-angle`. A gradient is a **paint**, so this re-rasterised the
whole window on every frame, for ever, to show 1.5 px. Measured on WebKit (Safari 26.5, 3898×2232
device px): **45 % of a core** in the GPU process at `linear`, with `CA::OGL::MetalContext::draw_elements`
at the top of the sample. Cutting it to `steps(60)` brought it to +4.4 pp and made the motion visibly
stepped. Reported as *"tab switches feel sluggish"*.

**v2 — composite a bigger window** (upstream app-109, adopted here). One square of `145vmax` carrying
the gradient, spun by a `transform`. The paint cost went to the floor, and the **memory** went up
instead: a composited layer that grows with the **square** of the window — ≈ 5650 × 5650 device px on
this display, far past the 4096 px per side that a texture is commonly limited to.

After a window resize, WebKit stops re-rasterising that layer correctly. A corner loses its band and
flickers, and **which** corner depends on how the window was dragged. Measured here:

- `145vmax` is **not** stale after a resize — the computed `::before` width is exactly `1.45 × vmax`
  at every size, covering the window diagonal with 190–610 px to spare. The geometry was never wrong.
- Shrinking the square to the exact diagonal (`hypot(100vw, 100vh)`) and dropping `will-change`, in
  every combination, **did not help**. It is not the margin and not the promotion hint.
- It does **not** reproduce on Windows at the same window size, on the same content, in the upstream
  project — WebView2 (Blink) tiles such layers as a matter of course. It is therefore a defect for
  **every** app on this template on **macOS and Linux/WebKitGTK**, and invisible to anyone developing
  on Windows. That is why it shipped.

## Decision

**The frame paints only the band.**

One `conic-gradient`, anchored to the window (`background-size: 100vw 100vh`), is sampled by **four
strips** — top, right, bottom, left — each `--frame-strip` thick, which between them contain every
place a 1.5 px border can appear.

- **The strips are not the outline's edges.** The outline has eight sides — four straight, four
  chamfers — and `clip-path` draws all of them, as before. The strips only supply colour.
- **Four are enough because of the chamfer**, and that is a coupling, so it is bound to one source:
  `--frame-strip: calc(var(--hud-chamfer-lg) + 4px)`, and the clip polygon reads the same variable
  instead of repeating the number beside it. Grow the chamfer and the strips grow with it.
- **One image, four windows onto it.** Every strip declares the same gradient at the same size and
  pushes it to the same absolute place, so a point at window coordinate (x, y) resolves to one colour
  whichever strip covers it. That is the CSS painting model, not a tuning — which is what makes the
  run round the frame seamless where four independent gradients would meet at four seams. The corners
  are the proof: the top strip spans the full width and the left strip the full height, so they
  overlap in a `--frame-strip` square and any disagreement would show there first.
- **One animation.** `--frame-angle` is animated once on `.window-frame-band` and **inherited** by the
  strips, so they cannot drift out of phase. It stays a **registered** property: only a typed custom
  property interpolates — an unregistered one would jump 0deg → 360deg once per cycle and stand still
  in between.

## Consequences

- **Memory is bounded and small**: four layers of `edge × 24px` instead of one of `window²`. The
  WebKit failure is unreachable by construction, because nothing is larger than its own strip and
  nothing rotates.
- **The painted area is ≈ 7 % of the window**, so the angle animation is affordable at `linear` again —
  a fraction of v1's cost *and* smoother than v1 ever was, since `steps(60)` is gone.
- **No JS, no canvas, no `ResizeObserver`.** Nothing has to be re-derived when the window changes size,
  which is the property that made v2 fragile in the first place.
- **`prefers-reduced-motion` moves with the animation**, to `.window-frame-band`. This trap has now
  been walked into twice: relocate the animation, leave the query behind, and there is no error and no
  failing style — the frame simply keeps spinning for everyone who asked it not to.
- **The shape is gated, not remembered.** `globals.test.ts` fails the build if any *box* in the frame
  is sized from the viewport (`vmax`/`vw`/`vh`). `background-size: 100vw 100vh` is deliberately
  exempt — that is the image the strips sample, not a box anyone rasterises whole. A third round of
  "cover the window and clip it down" would be somebody else's engine, and this is what stops it.
- **This supersedes the upstream design for this project.** `docs/migrations/app-109` and `app-110`
  describe v2 as delivered and are left exactly as published (ADR-CORE-035 — a briefing is history and
  is never rewritten). An agent reading them will be told to keep the spun square; this ADR is what
  says otherwise, and it is reachable from the same vocabulary.
- **It is worth upstreaming**, because every consumer on macOS or Linux has the same defect and no way
  to notice it on Windows. That is a proposal to the maintainer, not something to commit into the
  template unasked (rule:upstream-changes).

## Postscript: the activity line, and porting by analogy

The same session reverted the terminal's activity line to the mechanism it had before app-109 —
`background-position` animated on the element itself — and the reason belongs here, because it is the
other half of the same lesson.

The line had been ported to a composited `transform` on an oversized `::before` **by analogy** with the
frame: animating a position had been proven expensive there, so it was assumed expensive here. **It was
never measured on this element.** The frame is the whole window; the line is a 2 px strip. At a 1500 px
terminal the repaint is 3 000 pixels a frame against the frame's 2 200 000 — three orders of magnitude,
and never once shown to cost anything.

The port cost five defects, every one of them reported from a running build: the sweep ran backwards;
the period was halved so the line read as not reaching its ends; a `position` the child needed knocked
the line out of the top edge; the tiled background's seams opened and closed with the fractional part of
the terminal's width — *"faster or slower depending on the size"*; and the loop visibly restarted with
the left end one or two pixels short, **worse the narrower the strip**, because the child was six times
its width, so the rounding error stayed the same size while the visible part shrank.

An element painting its own background has none of those failure modes: it is its own size, it is
rasterised at exact device positions every frame, and its repeats are resolved inside one paint instead
of being composited as independently rounded tiles.

**The rule to carry:** a performance technique is justified by a measurement **of the thing it is
applied to**. "It was expensive over there" is a hypothesis, and here it was a wrong one that cost five
regressions to buy a saving nobody has ever quantified. Re-port it if a measurement of *that element*
ever justifies it — the CSS says so at the rule, so the next person weighs the trade with the evidence
instead of with the analogy.

## Alternatives considered

- **Shrink the square / drop `will-change`.** Measured, in all four combinations. Still flickers — the
  problem is the covering layer itself, not its margin.
- **SVG stroke along the chamfer path.** The band genuinely *is* a stroke, and the repaint would be
  small. Rejected because the chamfer geometry would then exist twice — once as a CSS `clip-path` and
  once as an SVG path that has to be recomputed on every resize in JS, since a non-uniform `viewBox`
  scale would deform the 45° chamfers and the stroke width. That trades a bounded CSS problem for an
  unbounded synchronisation one (ADR-CORE-005).
- **Canvas.** Full control and bounded memory, but it brings DPR handling, resize handling,
  reduced-motion handling and theme changes back into hand-written code — all of which the CSS version
  gets from the platform.
