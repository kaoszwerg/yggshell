import { describe, it, expect } from "vitest";
import { css, code, declarations, atRule } from "./cssSource";

/**
 * The window frame, checked as text — the file `rule:theming` names.
 *
 * Three defects have come out of this one element, and none of them could be seen by a type, a lint
 * or a render test: a full-window repaint that cost measurable CPU, a reduced-motion query left
 * pointing at the element the animation had just left, and a composited layer that WebKit stopped
 * re-rasterising after a window resize (docs/migrations/app-112). Every one of them rendered as
 * *something* while the whole gate stayed green.
 */
describe("the animated window frame", () => {
  it("NEVER sizes any part of the frame to cover the window", () => {
    // THE invariant, and the reason this test exists at all. Both previous versions of the frame
    // produced a window-sized-or-larger image and threw 99.9% of it away through a clip:
    //   - v1 painted a conic-gradient across `.window-frame` — a full-window repaint at 60fps to show
    //     1.5px, measured at 45% of a core in the GPU process.
    //   - v2 (app-109) composited a 145vmax square instead — a layer growing with the SQUARE of the
    //     window, ~5650x5650 device px here — which WebKit stops re-rasterising correctly after a
    //     window resize, so a corner loses its band and flickers. Not reproducible on Blink, which is
    //     why it shipped.
    // A third round of this is somebody else's engine, so the shape itself is what gets pinned: no
    // BOX in the frame may be sized from the viewport. `background-size: 100vw 100vh` is deliberately
    // untouched by this — that is the image the strips sample, not a box anyone rasterises whole.
    const frame = css.slice(css.indexOf(".window-frame {"), css.indexOf(".hud-activity {"));
    expect(frame).not.toMatch(/(?:^|[^-])(?:width|height):[^;]*\bv(?:max|min|w|h)\b/);
    expect(frame).not.toContain("145vmax");
  });

  it("runs one gradient through four strips, in phase", () => {
    // The colour must run round the frame without a seam, and four strips could obviously produce
    // four seams. They do not, for two reasons, and both are pinned here because both are invisible
    // in the source until they break:
    //   - ONE image: every strip declares the same gradient at the same size (the window) and pushes
    //     it to the same absolute place, so a point resolves to one colour whichever strip covers it.
    //   - ONE animation: `--frame-angle` is animated on the container and INHERITED, so the strips
    //     cannot drift apart. Animating each strip would look identical on the first frame.
    const strip = declarations(".window-frame > .window-frame-band > .window-frame-edge");
    expect(strip).toContain("conic-gradient(");
    expect(strip).toContain("from var(--frame-angle)");
    expect(strip).toContain("background-size: 100vw 100vh");
    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(declarations(`.window-frame > .window-frame-band > .edge-${edge}`)).toContain(
        "background-position:",
      );
    }
    expect(declarations(".window-frame > .window-frame-band")).toContain(
      "animation: frame-rotate 12s linear infinite",
    );
    // Registered, and inheriting — an unregistered custom property has no type, so it does not
    // interpolate: the frame would jump 0deg → 360deg once per cycle and stand still in between.
    const prop = atRule("@property --frame-angle");
    expect(prop).toContain('syntax: "<angle>"');
    expect(prop).toContain("inherits: true");
    // Comment-stripped: the note above the keyframes still names `frame-spin` while explaining what
    // it cost, and that sentence is the thing stopping someone from rebuilding it.
    expect(code).not.toContain("frame-spin");
  });

  it("derives the strips from the chamfer, so they cannot be outgrown", () => {
    // Four strips are enough ONLY because no point of the eight-sided outline is further from a
    // border than the deepest chamfer. That is a coupling, and written as two literals it would be a
    // coupling held by memory: grow the chamfer past the strip and the band falls out of it at the
    // corners — a defect that renders as *something* and passes every other gate (rule:ui-design).
    const frame = declarations(".window-frame");
    expect(frame).toContain("--hud-chamfer-lg: 20px");
    expect(frame).toContain("--frame-strip: calc(var(--hud-chamfer-lg)");
    // The polygon must READ the same variable rather than repeating the number beside it.
    const clip = frame.slice(frame.indexOf("--hud-window-clip"));
    expect(clip.slice(0, clip.indexOf(");"))).not.toMatch(/\b20px\b/);
  });

  it("honours reduced motion on the element that actually animates", () => {
    // THE step that is silently wrong if skipped, and it has now been walked into twice: move the
    // animation to a different element, leave this query behind, and there is no error and no failing
    // style — the frame simply keeps spinning for every user who asked it not to.
    const query = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    const block = query.slice(0, query.indexOf("\n}\n") + 3);
    expect(block).toContain(".window-frame > .window-frame-band");
    expect(block).toContain("animation: none");
  });

  it("clips the glow with ONE closed contour, never an evenodd ring", () => {
    // A single polygon cannot have a hole. An `evenodd` list of outer-then-inner points is one path:
    // it traces the outer contour, jumps to the first inner point, traces that, and closes — and the
    // two connecting segments are real edges. They cut across a chamfer and the fill rule cancels
    // itself out there, leaving a gap in the border. Reported from a running build.
    //
    // No ring is needed: the frame's padding makes the band and the opaque inner shell covers the
    // rest. This is the check that stops somebody "restoring" the ring to be explicit about it.
    const rule = declarations(".window-frame > .window-frame-band");
    expect(rule).toContain("clip-path: var(--hud-window-clip)");
    expect(rule).not.toContain("evenodd");
    // The POSITIVE invariant too, upstream's improvement on this test: a seam can be reintroduced
    // without the keyword — any second contour does it — so what is pinned is that the clip is the
    // shared chamfer and nothing else.
    expect(rule).not.toContain("polygon(");
  });

  it("makes the band out of padding, which is what survives the minifier", () => {
    // The band's width comes from the frame's own padding — not from a second inset contour, and not
    // from a mask: a `mask` + `mask-composite` ring was silently broken by the production CSS
    // minifier once already and flooded the whole window.
    expect(declarations(".window-frame")).toContain("padding: var(--frame-band)");
    // The declaration, not the word: the comment above it names the mechanism it replaced.
    expect(css).not.toContain("mask-composite:");
  });

  it("keeps the opaque shell above the band", () => {
    // Without the stacking order the band is drawn over the application rather than around it.
    expect(declarations(".window-frame > .window-frame-inner")).toContain("z-index: 1");
  });
});
