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
    const keyframes = css.slice(css.indexOf("@keyframes activity-sweep"));
    const block = keyframes.slice(0, keyframes.indexOf("\n}"));
    expect(block).toContain("transform: translateX(");
    expect(block).not.toContain("background-position");
  });

  it("moves a strip that is two periods wide, so the loop has no seam", () => {
    // Shifting by exactly one period lands on an identical frame. A strip only one period wide would
    // run out and snap back.
    const rule = declarations(".hud-activity-running::before");
    expect(rule).toContain("width: 200%");
    expect(rule).toContain("background-size: 50% 100%");
    expect(rule).toContain("repeat-x");
  });

  it("honours reduced motion on the element that actually animates", () => {
    // The trap the window frame walked into first: move the animation to a child, leave the query on
    // the parent, and nothing errors while the preference is silently ignored.
    const query = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(query).toContain(".hud-activity-running::before");
  });
});
