import { describe, it, expect } from "vitest";
// `?raw` rather than `node:fs`: the frontend tsconfig deliberately carries no Node types, so that no
// component can reach for the filesystem. A test is not a reason to open that door — and Vite hands
// back the untransformed source text, which is exactly what is being asserted on.
import css from "./globals.css?raw";

/**
 * An at-rule's body, comments stripped — same reasoning as {@link declarations}.
 *
 * The body is found by COUNTING braces, not by looking for one in column 0. That shortcut worked
 * only while these at-rules sat at the top level; once they moved inside `@layer components` (they
 * had to — Lightning CSS drops keyframes it cannot see used from the same layer) the first column-0
 * brace became the layer's own, hundreds of lines later, and every at-rule body silently grew to
 * include every rule after it. The test that noticed was a NEGATIVE one, which is the only kind that
 * can be broken by a body that is too big.
 */
function atRule(prelude: string): string {
  const from = css.slice(css.indexOf(prelude));
  const open = from.indexOf("{");
  let depth = 0;
  for (let i = open; i < from.length; i += 1) {
    const ch = from.charAt(i);
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return from.slice(0, i + 1).replace(/\/\*[\s\S]*?\*\//g, "");
    }
  }
  throw new Error(`unbalanced at-rule: ${prelude}`);
}

/**
 * The stylesheet with every `@media` block removed.
 *
 * A rule inside one is an override of the rule outside it, so a selector lookup that finds the
 * media-query copy first reads the exception as if it were the rule — which is what happened the
 * moment the layers went in and the reduced-motion block stayed at column 0. Deliberately: an
 * accessibility override has to outrank everything, including a utility the caller passes, and a
 * layered one would not.
 */
const unconditional = withoutMediaBlocks(css);

/**
 * The stylesheet with every comment removed.
 *
 * For the file-wide negative assertions. Scoping a check to one rule is not always possible — "this
 * name appears NOWHERE any more" is a statement about the file — and every such check in here has at
 * some point matched the very sentence that documents why the thing is gone.
 */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * `text` with every `@media { … }` removed, by counting braces rather than matching them.
 *
 * A regex for a balanced block needs a nested quantifier, and `security/detect-unsafe-regex` rejects
 * that on sight — rightly: the same pattern is how a linear input becomes an exponential match. This
 * is longer and cannot backtrack at all.
 */
function withoutMediaBlocks(text: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const start = text.indexOf("@media", at);
    if (start === -1) return out + text.slice(at);
    out += text.slice(at, start);
    const open = text.indexOf("{", start);
    if (open === -1) return out + text.slice(start);
    let depth = 0;
    let cursor = open;
    for (; cursor < text.length; cursor += 1) {
      const char = text.charAt(cursor);
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    at = cursor + 1;
  }
}

/**
 * A rule's declarations, with its comments stripped.
 *
 * Not fussiness: the comment inside a rule is usually the sentence explaining what must NOT be there,
 * so it contains every word a negative assertion looks for. Two of the checks below matched their own
 * documentation before this existed — the same trap `environment.rs` and the kill-session scan both
 * hit, and it is worth solving once rather than by wording each comment around its test.
 */
function declarations(selector: string): string {
  const from = unconditional.slice(unconditional.indexOf(`${selector} {`));
  return from.slice(0, from.indexOf("}")).replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The window frame's animation, checked as text.
 *
 * **A stylesheet is the one part of this app no test would otherwise touch**, and the frame has now
 * produced two defects that no type, lint or render test could have caught: a full-window repaint that
 * cost measurable CPU, and — in the migration away from it — a reduced-motion rule that keeps pointing
 * at the element the animation just left. The second is the dangerous one: nothing errors, no style
 * fails, and the frame simply keeps spinning for every user who asked it not to.
 *
 * Reading the file is crude and deliberate. jsdom does not apply stylesheets, so there is no computed
 * style to assert against; the choice is this or nothing.
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

describe("the activity line", () => {
  it("moves its OWN background, with no travelling child", () => {
    // The element paints the gradient and slides it. It was ported to a composited `transform` on an
    // oversized `::before` for one release, by analogy with the window frame — where animating a
    // position had been a full-window repaint costing 45% of a core. The analogy was never checked
    // against THIS element: the frame is the whole window, this is a 2px strip, and at a 1500px
    // terminal the repaint is 3000 pixels a frame against the frame's 2.2 million.
    //
    // Five defects were reported against that port and none against this: the sweep ran backwards;
    // the period was halved so the line read as not reaching its ends; a `position` needed for the
    // child knocked the line out of the top edge; the tiled background's seams opened and closed with
    // the fractional part of the terminal's width; and the loop visibly restarted with the left end
    // one or two pixels short — worse the NARROWER the strip, because the child was six times its
    // width, so the rounding error stayed put while the visible part shrank.
    //
    // Re-port it if a measurement of this element ever justifies it. Not by analogy.
    expect(atRule("@keyframes activity-sweep")).toContain("background-position:");
    expect(code).not.toContain(".hud-activity-running::before");
  });

  it("travels LEFT to RIGHT, which is why the number is NEGATIVE", () => {
    // The trap that reversed it for one version. A percentage `background-position` resolves against
    // `element width − image width`; the image is twice the element, so that bracket is negative and
    // the sign flips — `-200%` moves the gradient RIGHT. It reads backwards, someone "corrected" it,
    // and the reversal was reported from a running build.
    //
    // Pinned as the relationship rather than as the number: the shift that lands exactly one image
    // width along is `100 · S / (1 − S)` for a background-size fraction S, which is −200% at S = 2 and
    // a different number the moment the period changes. Seamless loop and correct direction are the
    // same equation, so they are checked as one.
    const block = atRule("@keyframes activity-sweep");
    const from = Number(/from\s*\{[^}]*background-position:\s*(-?[\d.]+)%?/.exec(block)?.[1]);
    const to = Number(/to\s*\{[^}]*background-position:\s*(-?[\d.]+)%?/.exec(block)?.[1]);
    const size = Number(
      /background-size:\s*([\d.]+)%/.exec(declarations(".hud-activity-running"))?.[1],
    );
    expect(Number.isNaN(from)).toBe(false);
    const s = size / 100;
    expect(to - from).toBeCloseTo((100 * s) / (1 - s), 3);
    // …and that formula only yields a rightward sweep while the image is WIDER than the element.
    expect(s).toBeGreaterThan(1);
  });

  it("keeps the period two strip-widths long, so the line is lit at its edges", () => {
    // One period spans two strip widths, so the visible strip shows half a period — one smooth ramp,
    // brightest in the middle, never dark at an edge. Halving it puts the gradient's faint ends AT
    // both edges and the line reads as not reaching them. Reported that way once, and nearly
    // re-introduced twice while fixing something else; it is not a free parameter.
    expect(declarations(".hud-activity-running")).toContain("background-size: 200% 100%");
  });

  it("honours reduced motion on the element that actually animates", () => {
    // Move the animation, leave the query behind, and nothing errors while the preference is silently
    // ignored. Both this and the window frame have walked into it.
    const query = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(query).toContain(".hud-activity-running");
    expect(query).toContain("animation: none");
  });

  it("leaves positioning to whoever places it", () => {
    // The view places the line with `absolute inset-x-0 top-0`. A `position: relative` in the base
    // class won over it and the line dropped out of the top edge into normal flow. Reported. The
    // class is layered now, so a utility would win — but the design system still has no business
    // deciding where the caller puts this.
    expect(declarations(".hud-activity")).not.toContain("position:");
  });
});
