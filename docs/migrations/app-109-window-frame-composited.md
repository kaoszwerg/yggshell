# 109 — the animated window frame no longer repaints the whole window

> **Superseded in part by [app-110](app-110-window-frame-seam.md) — read it before porting this.**
> The ring clip given below leaves the top-left chamfer unfilled: `polygon()` describes one closed
> contour and cannot have a hole. The *reason* for this change, and everything else in it, still
> stands; only the `clip-path` on `.window-frame-glow` is wrong. app-110 has the one-line correction.

Audience: the agent working in a project **forked from this Tauri shell**.
Layer: **app** — but `src/styles/globals.css` and `src/App.tsx` are **your** files. `governance:update`
does **not** change them. Port this by hand.

## What was wrong

`.window-frame` animated a registered custom property (`--frame-angle`) that fed a `conic-gradient`.
That is a **paint**, not a composite: the gradient was re-rasterised across the element's full box — the
entire window — on every frame, forever, to display a 1.5 px border. It ran on an idle window, with
nobody typing, and it scaled with display size.

Measured on WebKit (Safari 26.5, macOS, 3898×2232 device pixels, 60 Hz), against an animation-off
control:

| Variant                       | Paint triggers/s | GPU CPU over control |
| ----------------------------- | ---------------- | -------------------- |
| old (`--frame-angle`, linear) | 60               | **+4.4 pp**          |
| new (`transform`-spun)        | 0                | **−0.2 pp** (at the control floor) |

Memory was unchanged (44 MB in both). The new version is **visually identical** — rotating a conic
gradient about its own centre is exactly equivalent to advancing its `from` angle, so it is still a
smooth 12 s revolution, not a stepped approximation.

## What to do

Your fork has the old rule. Take three things across:

**1. `src/App.tsx`** — add the glow layer as the first child of `.window-frame`, before the content
wrapper:

```jsx
<div className="window-frame h-full">
  <div className="window-frame-glow" aria-hidden="true" />
  <div className="window-frame-inner hud-grid-bg flex h-full flex-col">…</div>
</div>
```

**2. `src/styles/globals.css`** — replace the `@property --frame-angle` / `@keyframes frame-rotate`
block and the `background` + `animation` on `.window-frame` with `@keyframes frame-spin`, the
`.window-frame > .window-frame-glow` ring clip and its `::before` spun square. Copy the block from this
template's `globals.css`; it is commented with the two structural constraints.

**3. The reduced-motion query** — it must now target the element that actually carries the animation:

```css
@media (prefers-reduced-motion: reduce) {
  .window-frame > .window-frame-glow::before {
    animation: none;
  }
}
```

**This is the step that is silently wrong if you skip it.** If you move the animation but leave the
query pointing at `.window-frame`, nothing errors, no style fails, and the frame keeps spinning for
every user who asked it not to. Check it: emulate `prefers-reduced-motion: reduce` and confirm the
computed `animation-name` on `.window-frame-glow::before` is `none`.

Also give `.window-frame > .window-frame-inner` a `z-index: 1`, so the opaque shell stays above the glow.

## What is now forbidden

- **Do not put a `clip-path` or `mask` on `.window-frame` itself.** Both apply to an element **and its
  descendants**, and `.window-frame` is the container your entire application renders inside — you would
  erase the app, not the covered gradient. That is why the band lives on its own element.
- **Do not "fix" this with a ring-clipped repaint.** Clipping the gradient to the band while still
  animating the property was measured at **27.2 % GPU against 9.9 % for the old rule** — roughly three
  times the cost of the problem it was meant to solve. A complex even-odd clip re-applied per frame is
  more expensive than the full-window fill it replaces.
- **Do not step the animation** (`steps(60)` and friends). It works, but it trades the design system's
  smoothness for a saving the composited version gets for free.
- **Do not make the spun element non-square or smaller than the window diagonal.** A rotated non-square
  box deforms the gradient instead of advancing its phase, and an undersized one uncovers the corners.

## Verified, and what is not

Verified: renders correctly and survives production minification on Blink (the `evenodd` polygon and the
keyframes come through `lightningcss` intact); reduced-motion confirmed by emulating the media feature;
the cost figures above are from WebKit on Apple silicon.

**Not verified: WebKitGTK.** No measurement covers Linux. The change moves work off the paint path, which
is the universally optimised direction, but if you ship to Linux, look at it there (rule:cross-platform).
