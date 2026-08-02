# 112 — the window frame loses a corner after a resize on WebKit

Audience: the agent working in a project **forked from this Tauri shell**.
Layer: **app** — `src/styles/globals.css` and `src/App.tsx` are **your** files. `governance:update`
does **not** change them. Port this by hand.

**Supersedes the band implementation from [app-109](app-109-window-frame-composited.md)** (and the clip
correction in [app-110](app-110-window-frame-seam.md), which no longer applies — there is no clip on a
band element any more). Reported by a consumer against v0.10.6.

## The symptom

Resize the window — any drag, any direction — and the 1.5 px band stops being drawn at one corner,
flickering as the gradient turns. Which corner depends on how the window was dragged. It persists after
the drag ends; it is not a during-resize artefact.

**On macOS and Linux/WebKitGTK only.** It does not reproduce on Windows at the same size on the same
content: WebView2 (Blink) tiles oversized composited layers as a matter of course, WebKit does not. A
developer on Windows will never see it and a consumer on macOS sees it on every window they resize —
which is why this is a briefing and not a changelog line.

## The cause

app-109 painted the gradient once onto a `145vmax` square and spun it with a `transform`. That is a
composited layer growing with the **square of the window** — about 5650 × 5650 device px on a
3898 × 2232 display. WebKit does not re-rasterise it correctly after a resize, and the part it fails to
paint is exactly the part the clip exposes: the band.

The cheaper explanations were measured and ruled out first — the `145vmax` geometry is correct at every
size (probed after four resizes, clearing the diagonal by 190–610 px), and the flicker survives dropping
the margin to `hypot(100vw, 100vh)`, dropping `will-change`, and all four combinations of the two.

**The shape of the mistake is older than app-109.** Both previous versions produced an image the size of
the window or larger and threw away 99.9 % of it to show 1.5 px:

- **v1** animated `--frame-angle` on a full-window `conic-gradient`: a full-window **repaint** at 60 fps,
  for ever. Measured at +4.4 pp of a core.
- **v2 (app-109)** fixed the paint by compositing *more* than the window. The CPU cost went to the floor
  and an unbounded **memory** cost took its place.

Trading a cost that scales for a size that scales is not a win.

## The fix: paint only the band

One conic gradient anchored to the window, sampled by four thin strips covering exactly the region a
1.5 px border can occupy. Paint drops to ≈ 7 % of the window's area, memory to four strips of
edge × 24 px, and **nothing has to be recomputed on resize** — no JS, no `ResizeObserver`.

`src/App.tsx` — the single glow element becomes a band with four children:

```jsx
<div className="window-frame-band" aria-hidden="true">
  <div className="window-frame-edge edge-top" />
  <div className="window-frame-edge edge-bottom" />
  <div className="window-frame-edge edge-left" />
  <div className="window-frame-edge edge-right" />
</div>
```

`src/styles/globals.css` — take the `.window-frame`, `.window-frame-band`, `.window-frame-edge` and
`.edge-*` rules, plus `@property --frame-angle` and `@keyframes frame-rotate`, from this template. Delete
`.window-frame-glow`, its `::before` and `@keyframes frame-spin`.

**Four things are load-bearing. Do not "simplify" any of them:**

1. **One image, four windows onto it.** Every strip declares the same gradient at the same size (the
   window) and pushes it to the same absolute place, so a point at window coordinate (x, y) resolves to
   one colour whichever strip covers it. The corners are the proof: the top strip spans the full width
   and the left strip the full height, so they overlap in a `--frame-strip` square, and any disagreement
   would show there first.
2. **One animation.** `--frame-angle` is animated once on `.window-frame-band` and inherited. Four
   separate animations are identical on the first frame and drift afterwards.
3. **Registered property, `inherits: true`.** Only a typed custom property interpolates; an unregistered
   one jumps `0deg → 360deg` once per cycle and stands still in between. It must inherit, because the
   strips read it.
4. **The strip depth is derived from the chamfer** (`--frame-strip: calc(var(--hud-chamfer-lg) + 4px)`).
   Four strips are only enough because no point of the band is further from a border than the largest
   chamfer. As two independent literals that coupling is held by memory.

Move the reduced-motion query to `.window-frame-band` — the element that now carries the animation. Left
pointing at the old one it fails silently: no error, no failing style, the frame simply keeps turning for
users who asked it not to. **That has now been got wrong twice.**

## `@keyframes` and `@property` must sit inside `@layer components`

Found on the way, and it bites after [app-111](app-111-cascade-layers.md). Lightning CSS eliminates
keyframes it believes are unused, and a usage inside `@layer components` does not reliably match a
definition at column 0 — the production build then ships an `animation:` naming keyframes that are not in
the file. `@property` fails worse: dropped, the property loses its type and silently stops interpolating,
so the animation runs and nothing moves.

Nothing upstream of the built file can see it: the CSS is valid, the animation is declared, the
definition exists in the source.

*(For the record: this did not reproduce in this template at lightningcss 1.32.0 — both survived
minification intact. It is version-dependent, and the configuration is the one being warned about, so
the definitions have been moved inside the layer regardless.)*

## The gate

Three checks, all in `src/styles/`, all text assertions on the stylesheet — port them with the change:

- **no box in the frame may be sized from the viewport** (`vmax`/`vw`/`vh`); `background-size` is exempt,
  since it anchors the gradient without sizing a box;
- **every `@keyframes` and `@property` sits in the layer that uses it**;
- **`prefers-reduced-motion` targets the element that actually carries the animation.**

A stylesheet is the one part of the app no test touches and every defect renders as *something* while the
gate stays green. These three are the ones that have actually cost a release.

## Verified, and what is not

Verified on Blink: band coverage complete at all four edges and all four chamfers across four window
sizes including portrait (hit-testing the clipped area); corners seam-free at 12× magnification with the
rotation frozen — including bottom-right, where two strips disagree on both `background-position` axes if
anything is wrong; `@property`, `@keyframes`, the gradient and `background-size` all survive production
minification; reduced-motion confirmed by emulating the media feature.

**Not verified: WebKit and WebKitGTK.** The defect being fixed does not reproduce on Blink, so the fix
cannot be confirmed there either. The reporter has it working on macOS (yggshell `1c886e2`); Linux is
covered by no measurement on either side.
