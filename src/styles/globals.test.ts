import { describe, it, expect } from "vitest";
// `?raw` rather than `node:fs`: the frontend tsconfig deliberately carries no Node types, so that no
// component can reach for the filesystem. A test is not a reason to open that door — and Vite hands
// back the untransformed source text, which is exactly what is being asserted on.
import css from "./globals.css?raw";

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
    const frameRule = css.slice(css.indexOf(".window-frame {"));
    expect(frameRule.slice(0, frameRule.indexOf("}"))).not.toContain("conic-gradient");
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

  it("keeps the opaque shell above the glow", () => {
    // Without the stacking order the band is drawn over the application rather than around it.
    const inner = css.slice(css.indexOf(".window-frame > .window-frame-inner"));
    expect(inner.slice(0, inner.indexOf("}"))).toContain("z-index: 1");
  });
});
