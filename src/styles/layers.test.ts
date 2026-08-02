import { describe, it, expect } from "vitest";
// `?raw` rather than `node:fs`: the frontend tsconfig deliberately carries no Node types so that no
// component can reach the filesystem, and a test is not a reason to open that door.
import css from "./globals.css?raw";

/**
 * Where every rule in the stylesheet lives in the cascade.
 *
 * **This is the only thing in the gate that can see the defect it exists for.** An unlayered rule is
 * valid CSS, lints clean, typechecks clean and renders correctly on its own; it goes wrong only when a
 * caller passes a Tailwind utility to a component — and then it goes wrong as *nothing happening*.
 * Unlayered rules outrank every `@layer`, so `.hud-panel` beat `absolute`, `.hud-btn` beat `static`,
 * and a `position: relative` added to `.hud-activity` for an unrelated reason silently took the
 * view's `absolute inset-x-0 top-0` away and dropped the line out of the window's top edge. That last
 * one was found by the maintainer looking at the screen, after the trap had already been written down
 * once (app-111, upstream).
 *
 * Ported from the template with the layering. Kept as text assertions because jsdom applies no
 * stylesheets: there is no computed style to ask, so the choice is this or nothing.
 */

/**
 * The stylesheet with comments removed.
 *
 * Everything below counts or matches braces, and a comment may contain one — this file's own do,
 * explaining a brace-counting bug. Counting them cost an hour of hunting a missing `}` that was
 * never missing: the CSS parsed fine and only the test's arithmetic did not.
 */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A block that starts in column 0 — `@layer base {`, `.hud-panel {`, `@media … {`. */
const TOP_LEVEL = /^(\S[^\n{]*)\{/gm;

/** The body of `@layer <name> { … }`, braces balanced. */
function layer(name: string): string {
  const start = code.indexOf(`@layer ${name} {`);
  if (start === -1) return "";
  let depth = 0;
  for (let at = start; at < code.length; at += 1) {
    // `charAt`, not `code[at]`: an indexed read with a computed key is what
    // `security/detect-object-injection` flags, and it is not worth an exception here.
    const char = code.charAt(at);
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(start, at + 1);
    }
  }
  return "";
}

describe("the cascade layers", () => {
  it("puts no style rule at column 0", () => {
    // The whole point. Anything here outranks every utility in the project, for ever, with no
    // warning at the call site.
    const offenders = [...code.matchAll(TOP_LEVEL)]
      .map((match) => match[1]?.trim() ?? "")
      // At-rules are not style rules: `@layer`, `@media`, `@keyframes`, `@theme`, `@font-face`,
      // `@property`. A `:root` block declares custom properties and has nothing to outrank.
      .filter((selector) => !selector.startsWith("@") && !selector.startsWith(":root"));

    expect(offenders).toEqual([]);
  });

  it("keeps the component classes where a caller can override them", () => {
    // These are what a `className` is passed to. In `components` a utility wins, which is what
    // accepting a `className` prop promises.
    const components = layer("components");
    for (const selector of [
      ".hud-panel",
      ".hud-popover",
      ".hud-btn",
      ".hud-strip",
      ".hud-clip",
      ".hud-activity",
      ".window-frame",
      ".scheme-surface",
    ]) {
      expect(components, selector).toContain(`${selector} {`);
    }
  });

  it("keeps the single-purpose helpers where they still beat a utility", () => {
    // The one adjustment the template made to our proposal, and it is right: a glow or a hidden
    // scrollbar is a helper you add ON TOP of utilities. In `components` it would lose to the very
    // thing it is meant to modify.
    const utilities = layer("utilities");
    for (const selector of [".neon-glow-cyan", ".text-glow-cyan", ".no-scrollbar"]) {
      expect(utilities, selector).toContain(`${selector} {`);
    }
  });

  it("keeps element-level styling in base", () => {
    // A styled `input[type="range"]` is not a component and not a helper: it replaces the browser's
    // own rendering, and everything else must be able to override it.
    expect(layer("base")).toContain('input[type="range"]');
  });

  it("declares the layers in the order the cascade needs", () => {
    const order = ["base", "components", "utilities"].map((name) =>
      code.indexOf(`@layer ${name} {`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((at) => at !== -1)).toBe(true);
  });

  it("keeps the rule that makes a hovered button legible", () => {
    // `.hud-btn` draws a 1px accent ring around a DARK core (`::before`, `inset: 1px`), and `:hover`
    // sets the label to `--saga-bg-deep` — which only works because the core turns transparent and
    // the accent fills the button. Lose that one rule and every tab and rail entry renders a black
    // icon on black the moment the pointer touches it. Reported exactly that way.
    //
    // It was lost by the layering itself: the selector is grouped across two lines and the block
    // parser doing the move keyed on the line carrying the `{`. Pinned here because the damage is
    // invisible to every other check — the CSS stays valid and only a hovered pointer shows it.
    expect(css).toContain(".hud-btn:hover::before");
    const core = css.slice(css.indexOf(".hud-btn:hover::before"));
    expect(core.slice(0, core.indexOf("}"))).toContain("background: transparent");
  });

  it("keeps both vendor thumbs on the disabled range input", () => {
    // The other grouped selector the same move truncated. WebKit is the one this app actually runs
    // on, and it was the half that disappeared.
    expect(css).toContain('input[type="range"]:disabled::-webkit-slider-thumb');
    expect(css).toContain('input[type="range"]:disabled::-moz-range-thumb');
  });

  it("defines every animation's keyframes in the layer that uses them", () => {
    // **A build-output defect with a source-level cause.** Lightning CSS eliminates keyframes it
    // believes are unused, and it does not match a usage inside `@layer components` against a
    // definition at column 0 — the production build shipped `animation: … frame-spin` with no
    // `@keyframes frame-spin`. With no keyframes there is no `translate(-50%, -50%)` either, since
    // that lives only in them, so the spun square sat with its CORNER at the window's centre and only
    // the bottom-right of the border was ever painted.
    //
    // Nothing else can see this: the CSS is valid, the animation is declared, the keyframes exist —
    // in the source. It appears only in a built stylesheet, and only as an animation that does not
    // run. Checking the cause is cheaper than building here and catches it at the same place.
    // Stated as the invariant rather than by parsing the `animation` shorthand: the name can sit
    // anywhere among the duration, timing and count, and the first version of this check happily
    // captured `infinite` and then verified nothing at all. Every keyframes block belongs in the
    // layer, full stop — there is no case for one outside it.
    const defined = [...code.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1] ?? "");
    expect(defined.length).toBeGreaterThan(0);

    const inLayer = layer("components");
    for (const name of defined) {
      expect(inLayer, `@keyframes ${name} must sit with its users`).toContain(`@keyframes ${name}`);
    }
  });

  it("leaves the reduced-motion overrides UNLAYERED, deliberately", () => {
    // The one exception, and it is not an oversight. An accessibility override has to outrank
    // everything — including a utility the caller passes — so it stays at column 0 as an at-rule.
    // Layering it would put it behind `utilities` and let a caller re-animate something the user
    // asked to hold still.
    const query = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(query).toBeGreaterThan(-1);
    expect(layer("components")).not.toContain("prefers-reduced-motion");
    expect(layer("utilities")).not.toContain("prefers-reduced-motion");
  });
});
