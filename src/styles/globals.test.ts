import { describe, it, expect } from "vitest";
// `?raw` rather than `node:fs`: the frontend tsconfig deliberately carries no Node types, so that no
// component can reach for the filesystem. A test is not a reason to open that door — and Vite hands
// back the untransformed source text, which is exactly what is being asserted on.
import css from "./globals.css?raw";

/**
 * A rule's declarations, with its comments stripped.
 *
 * Not fussiness: the comment inside a rule is usually the sentence explaining what must NOT be there,
 * so it contains every word a negative assertion looks for. Two of the checks below matched their own
 * documentation before this existed — the same trap `environment.rs` and the kill-session scan both
 * hit, and it is worth solving once rather than by wording each comment around its test.
 */
/** An at-rule's body, comments stripped — same reasoning as {@link declarations}. */
function atRule(prelude: string): string {
  const from = css.slice(css.indexOf(prelude));
  // To the closing brace in column 0: the body has nested blocks of its own.
  return from.slice(0, from.indexOf("\n}")).replace(/\/\*[\s\S]*?\*\//g, "");
}

function declarations(selector: string): string {
  const from = css.slice(css.indexOf(`${selector} {`));
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
  it("spins a composited layer rather than repainting the window", () => {
    // The old rule animated `--frame-angle` into a conic-gradient on `.window-frame` itself — a paint
    // across the whole window, 60 times a second, to show a 1.5px band (app-109, measured at +4.4pp
    // of a core). The replacement paints once and rotates with a transform.
    expect(css).toContain("@keyframes frame-spin");
    // The DECLARATION, not the string: the file still names `--frame-angle` in the comment that
    // explains why it is gone, and that sentence is the thing stopping someone from rebuilding it.
    expect(css).not.toContain("@property --frame-angle");
    expect(css).not.toContain("@keyframes frame-rotate");
    expect(css).not.toMatch(/animation:\s*frame-rotate/);
  });

  it("keeps the gradient on its own element, not on the app container", () => {
    // `clip-path` applies to an element AND its descendants, and `.window-frame` is what the whole
    // application renders inside. Clipping it to the band would erase the app, not the covered
    // gradient — this is why the glow is a sibling layer.
    expect(css).toContain(".window-frame > .window-frame-glow::before");
    expect(css).toMatch(/\.window-frame\s*\{[^}]*\}/);
    expect(declarations(".window-frame")).not.toContain("conic-gradient");
  });

  it("honours reduced motion on the element that actually animates", () => {
    // THE step that is silently wrong if skipped. Moving the animation to the glow layer while
    // leaving this query on `.window-frame` produces no error and no failing style — it just ignores
    // the user's preference, permanently and invisibly.
    const query = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    const block = query.slice(0, query.indexOf("\n}\n") + 3);
    expect(block).toContain(".window-frame-glow::before");
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
    const rule = declarations(".window-frame > .window-frame-glow");
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

  it("keeps the opaque shell above the glow", () => {
    // Without the stacking order the band is drawn over the application rather than around it.
    expect(declarations(".window-frame > .window-frame-inner")).toContain("z-index: 1");
  });

  it("keeps the spun square square, and wide enough to cover the diagonal", () => {
    // A rotated non-square box deforms the gradient instead of advancing its phase, and one narrower
    // than the window's diagonal sweeps its own corner across the band. `vmax` keeps it square
    // without a second length.
    const rule = declarations(".window-frame > .window-frame-glow::before");
    const width = /width:\s*(\d+)vmax/.exec(rule);
    const height = /height:\s*(\d+)vmax/.exec(rule);
    expect(width?.[1]).toBe(height?.[1]);
    expect(Number(width?.[1])).toBeGreaterThanOrEqual(142);
  });
});

describe("the activity line", () => {
  it("travels by transform, not by background-position", () => {
    // The same defect as the window frame, one component over, reached the same way: the property
    // reads as a position and behaves as a repaint. A 2px strip is cheaper than a whole window, but
    // it is paid at 60fps for as long as anything is running, in every terminal that is running it.
    const block = atRule("@keyframes activity-sweep");
    expect(block).toContain("transform: translateX(");
    expect(block).not.toContain("background-position");
  });

  it("travels LEFT to RIGHT, the way it always did", () => {
    // Reversed for exactly one version, and reported. `background-position: -200%` reads as "move
    // left" and moved right: a percentage position resolves against `element − image`, the image was
    // twice the element, so the bracket is negative and the sign flips. A translate says what it
    // does — which is why porting one has to state a direction, and why getting it backwards is
    // silent. Rightward means starting shifted left and ending at zero.
    const block = atRule("@keyframes activity-sweep");
    const from = block.slice(block.indexOf("from"), block.indexOf("  to {"));
    const to = block.slice(block.indexOf("  to {"));
    expect(from).toContain("translateX(-50%)");
    expect(to).toContain("translateX(0)");
  });

  it("moves a strip that is two periods wide, so the loop has no seam", () => {
    // Shifting by exactly one period lands on an identical frame. A strip only one period wide would
    // run out and snap back.
    const rule = declarations(".hud-activity-running::before");
    expect(rule).toContain("width: 400%");
    expect(rule).toContain("background-size: 50% 100%");
    expect(rule).toContain("repeat-x");
  });

  it("keeps the period two window-widths long, so the line is lit at its edges", () => {
    // The original put `background-size: 200%` on the ELEMENT: one period spanned two window widths,
    // so the visible strip showed half a period — one smooth ramp, brightest in the middle, never
    // dark at an edge. Halving that to a one-width period puts the gradient's faint ends AT both
    // edges and the line reads as not reaching them. Reported that way after the first port.
    //
    // Child 400% wide, gradient 50% of the child = 200% of the element. The two numbers only mean
    // anything together, which is why they are asserted together.
    const rule = declarations(".hud-activity-running::before");
    const width = /width:\s*(\d+)%/.exec(rule);
    const size = /background-size:\s*(\d+)%/.exec(rule);
    const periodInWindows = (Number(width?.[1]) / 100) * (Number(size?.[1]) / 100);
    expect(periodInWindows).toBe(2);
  });

  it("honours reduced motion on the element that actually animates", () => {
    // The trap the window frame walked into first: move the animation to a child, leave the query on
    // the parent, and nothing errors while the preference is silently ignored.
    const query = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(query).toContain(".hud-activity-running::before");
  });

  it("leaves positioning to whoever places it", () => {
    // Every `.hud-*` class in this file sits OUTSIDE `@layer`, so it beats every Tailwind utility.
    // A `position` here therefore overrides the caller's — which is exactly what happened: the view
    // places the line with `absolute inset-x-0 top-0`, a `position: relative` in the base class won,
    // and the line dropped out of the top edge into normal flow. The travelling child does not need
    // a positioned ancestor; it overflows in normal flow and `overflow: hidden` clips it.
    const rule = declarations(".hud-activity");
    expect(rule).toContain("overflow: hidden");
    expect(rule).not.toContain("position:");
    expect(declarations(".hud-activity-running::before")).not.toContain("position:");
  });

  it("does not promote a layer per terminal", () => {
    // `will-change: transform` was here for a day, and it was cargo-cult: an animated transform is
    // composited without it. The frame's spun square exists ONCE and may carry the hint; this exists
    // once per terminal, so every pane running something would hold a permanently promoted
    // full-width layer. Over-promotion costs memory and is a documented cause of the artefacts it
    // looks like it prevents.
    expect(declarations(".hud-activity-running::before")).not.toContain("will-change");
  });
});
