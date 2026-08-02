import { describe, it, expect } from "vitest";
import { css, code, declarations, atRule } from "./cssSource";

/**
 * The activity line, checked as text — same reasoning as `window-frame.test.ts`, one component over.
 */
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
