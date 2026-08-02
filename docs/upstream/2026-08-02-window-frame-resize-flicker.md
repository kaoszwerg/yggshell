# The animated window frame loses a corner after a resize — on WebKit only

**Affects:** every app built on the template, on **macOS and Linux/WebKitGTK**. Not reproducible on
Windows. Introduced by app-109 (`transform`-spun square), unchanged by app-110 and app-111.

**Downstream fix:** yggshell `1c886e2`, recorded as ADR-PROJ-003.

## Symptom

Resize the window — any drag, any direction — and the 1.5 px band stops being drawn at one corner,
flickering as the gradient rotates. Which corner is affected depends on how the window was dragged. It
persists after the drag ends; it is not a transient during-resize artefact.

Reported from a running build as *"sobald man ein resize macht zeichnet der äußere Rand die Animation
nicht mehr richtig"*.

## Why it is invisible to you

It does **not** reproduce on Windows at the same window size, on the same content. WebView2 (Blink)
tiles oversized composited layers as a matter of course; WebKit does not. So a developer on Windows
will never see it, and a consumer on macOS or Linux sees it on every window they resize.

That asymmetry is the reason this is worth a briefing rather than a changelog line: the defect is in the
published layer, and the layer's own CI cannot see it either.

## Diagnosis

`.window-frame > .window-frame-glow::before` is `145vmax` square, carries the conic gradient, is spun by
a `transform`, and is pinned with `will-change: transform`. That is a composited layer growing with the
**square** of the window — ≈ 5650 × 5650 device px on a 3898 × 2232 display. After a resize, WebKit
stops re-rasterising it correctly, and the part it fails to paint is exactly the part the clip exposes:
the band.

Everything cheaper was measured and ruled out first, so as not to send you after the wrong thing:

- **`145vmax` does not go stale.** Probed the computed `::before` width after each of four resizes: it
  is exactly `1.45 × vmax` every time, clearing the window diagonal by 190–610 px. The geometry is
  correct at every size.
- **It is not the margin.** Sizing the square to the exact diagonal with `hypot(100vw, 100vh)` — the
  smallest square that can work — still flickers.
- **It is not the promotion hint.** Dropping `will-change: transform` still flickers.
- **Nor the two together.** All four combinations of {145vmax, hypot} × {will-change, none} were put
  side by side in one page and resized: all four flicker.

It is the covering layer itself.

## The shape of the mistake, which is older than app-109

Both versions of this frame produce an image the size of the window — or larger — and throw 99.9 % of it
away through a `clip-path`, in order to show 1.5 px:

- **v1** painted a conic gradient across `.window-frame` and animated its `from` angle. A gradient is a
  paint, so that is a full-window repaint at 60 fps, for ever. Measured at 45 % of a core in the WebKit
  GPU process; cut to `steps(60)` it was still +4.4 pp, and the motion became visibly stepped.
- **v2** (app-109) fixed the paint by compositing *more* than the window. The CPU cost went to the floor
  and the memory cost took its place, unbounded and unmentioned.

Trading a cost that scales for a *size* that scales is not a win; it is a different scaling problem with
no counter attached to it.

## The fix: paint only the band

One conic gradient, anchored to the window, sampled by **four thin strips** that between them cover
exactly the region a 1.5 px border can occupy.

```css
.window-frame {
  --hud-chamfer-lg: 20px;
  --hud-chamfer-sm: 10px;
  --hud-window-clip: polygon(var(--hud-chamfer-lg) 0, …); /* reads the variables */
  --frame-strip: calc(var(--hud-chamfer-lg) + 4px);
}

@property --frame-angle {
  syntax: "<angle>";
  initial-value: 0deg;
  inherits: true;
}
@keyframes frame-rotate {
  to {
    --frame-angle: 360deg;
  }
}

.window-frame > .window-frame-band {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  clip-path: var(--hud-window-clip);
  animation: frame-rotate 12s linear infinite;
}

.window-frame > .window-frame-band > .window-frame-edge {
  position: absolute;
  background-image: conic-gradient(from var(--frame-angle), …);
  background-size: 100vw 100vh;
  background-repeat: no-repeat;
}
.edge-top    { inset: 0 0 auto 0; height: var(--frame-strip); background-position: 0 0; }
.edge-bottom { inset: auto 0 0 0; height: var(--frame-strip); background-position: 0 100%; }
.edge-left   { inset: 0 auto 0 0;  width:  var(--frame-strip); background-position: 0 0; }
.edge-right  { inset: 0 0 0 auto;  width:  var(--frame-strip); background-position: 100% 0; }
```

Markup: the single `.window-frame-glow` becomes `.window-frame-band` with four `.window-frame-edge`
children. Reduced motion moves to `.window-frame-band`.

Four points that are easy to get wrong, and all four are load-bearing:

1. **One image, four windows onto it.** Every strip declares the same gradient at the same size (the
   window) and pushes it to the same absolute place, so a point at window coordinate (x, y) resolves to
   one colour whichever strip covers it. That is the CSS painting model, not a tuning — it is why the
   colour runs round the frame without four seams. The corners are the proof: the top strip spans the
   full width and the left strip the full height, so they overlap in a `--frame-strip` square, and any
   disagreement would show there first.
2. **One animation.** `--frame-angle` is animated once on the container and **inherited**. Animating each
   strip would look identical on the first frame and drift afterwards.
3. **Registered property, `inherits: true`.** Only a typed custom property interpolates; an unregistered
   one jumps 0deg → 360deg once per cycle and stands still in between.
4. **The strips are DERIVED from the chamfer.** Four strips are only enough because no point of the
   eight-sided outline is further than `--hud-chamfer-lg` from a border. As two literals that is a
   coupling held by memory; bound to one variable it cannot drift.

## What it costs

- **Memory:** four layers of `edge × 24px`, instead of one of `window²`. Bounded, and small.
- **Paint:** ≈ 7 % of the window's area, versus v1's 100 %. Cheap enough that `linear` is affordable
  again — so it is both cheaper than v1 *and* smoother than v1 ever was, since `steps(60)` is gone.
- **Nothing to re-derive on resize.** No JS, no `ResizeObserver`, no canvas — which is the property v2
  lacked and the reason it was fragile.

## One more, found on the way — it will bite you after app-111

`@keyframes` and `@property` **must sit inside `@layer components`**, beside the rules that use them.

Lightning CSS eliminates keyframes it believes are unused, and it does **not** match a usage inside
`@layer components` against a definition at column 0. In `saga-rust-template@main`,
`.window-frame … animation: frame-spin` is inside the layer (line 431) and `@keyframes frame-spin` is at
column 0 (line 532). Our production build shipped the animation with **no keyframes at all**: the frame
stood still with only its bottom-right corner painted, because `translate(-50%, -50%)` lives only in the
keyframes. Reported here as *"man sieht nur die Ecke rechts unten und es passiert gar nichts"*.

Nothing upstream of the built file can see it — the CSS is valid, the animation is declared, the
keyframes exist in the source. The same applies to `@property`: dropped, `--frame-angle` loses its type
and silently stops interpolating.

We gate both:

```ts
const defined = [...code.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
for (const name of defined) expect(layer("components")).toContain(`@keyframes ${name}`);
// …and the same loop for /@property\s+(--[\w-]+)/
```

## A suggestion for the layer, not just the file

Both defects here are the same class: **a stylesheet is the one part of the app no test touches**, and
every one of these renders as *something* while the gate stays green. The three checks worth publishing
with the fix are the ones that would have caught all of it:

- no **box** in the frame may be sized from the viewport (`vmax`/`vw`/`vh`) — `background-size` exempt;
- every `@keyframes` and `@property` sits in the layer that uses it;
- `prefers-reduced-motion` targets the element that actually carries the animation — this has now been
  walked into twice, and it fails silently both times.
