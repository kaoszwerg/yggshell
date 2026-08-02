# 110 — the ring clip in app-109 leaves a gap in the border (fix)

Audience: the agent working in a project **forked from this Tauri shell**.
Layer: **app** — `src/styles/globals.css` is **your** file. `governance:update` does **not** fix this
for you. Port it by hand.

**This corrects [app-109](app-109-window-frame-composited.md).** If you have not ported that one yet,
read it for the *why* and take the CSS from here instead. If you have, you have the defect — apply the
one-line change below.

## The symptom

The neon border goes dark across the **top-left chamfer**. The animation is fine; the composited spin
performs exactly as app-109 reported. It is the clip.

## The cause

app-109 built the visible band as a single even-odd polygon: the outer contour, followed by the same
contour inset by the band width, in one point list.

```css
clip-path: polygon(
  evenodd,
  20px 0, …, 0 20px,                                 /* outer contour ends here */
  calc(20px + var(--frame-band)) var(--frame-band),  /* …and the inner one starts here */
  …
);
```

**`polygon()` describes exactly one closed contour, so it cannot have a hole.** The path traces the
outer contour, jumps straight to the first inner point, traces the inner contour, and closes back to
where it started. Those two connecting segments are real edges. Both run across the top-left chamfer —
they even cross each other at (10.75, 10.75) — and the even-odd rule cancels along them, so that stretch
of border is never filled.

The seam is always present; *where* it lands depends only on which points happen to be first and last.
`20px 0` → `0 20px` puts it squarely on the chamfer, the most visible edge of the window.

Measured on Blink by hit-testing the clipped area (`clip-path` clips pointer events too, so
`elementFromPoint` reports the clipped shape directly):

| Version                        | Chamfer points on the band |
| ------------------------------ | -------------------------- |
| app-109 (even-odd ring)        | **4 / 20**                 |
| this fix (outer chamfer only)  | **20 / 20**                |

Straight edges were unaffected in both. Reported against WebKit, reproduced here on Blink — it is a
fill-rule consequence, not an engine quirk.

## The fix

No ring is needed. `.window-frame` already has `padding: var(--frame-band)`, and `.window-frame-inner`
is opaque and sits above the glow on `z-index: 1` — the shell already covers everything except the band.
The ring was doing a second time, wrongly, what the padding does correctly.

```css
.window-frame > .window-frame-glow {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  clip-path: var(--hud-window-clip); /* the outer chamfer only — one closed contour */
}
```

Delete the whole `polygon(evenodd, …)` declaration. Nothing else changes: same `frame-spin`, same square
`::before`, same reduced-motion query, same measurements.

## What is now forbidden

- **Never express a ring as one `polygon()`.** Not here, not anywhere: outer-plus-inset in a single point
  list is not a shape with a hole, whatever the fill rule.
- **The band's width belongs to the layout, not to a second contour.** It is `padding` on
  `.window-frame` plus the opaque inner above it — one number, in one place, that no minifier and no
  `calc()` can desynchronise from the outer chamfer.

This generalises the note the pre-animation version already carried in `globals.css`: *"NO CSS `mask` —
the earlier mask + mask-composite ring was silently broken by the production CSS minifier and flooded
the whole window. Padding survives minification."* That was about `mask`, but the conclusion is the same
one, and this change is a return to it.

## The gate

`src/styles/window-frame.test.ts` pins it: the glow's `clip-path` must be exactly
`var(--hud-window-clip)`, with no `polygon(` and no `evenodd`. It also pins that the reduced-motion query
targets `.window-frame-glow::before` and that the spun square stays square and ≥ 142vmax.

They are text assertions on the stylesheet, deliberately. jsdom applies no stylesheets, so no rendering
test can reach this, and both a type checker and a linter see a perfectly valid `clip-path` either way —
a wrong polygon ships silently and is found by a human looking at one corner of the window. **Port that
test with the fix**, or the next agent re-derives the ring and the gate stays green.
