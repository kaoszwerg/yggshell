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

/** A block that starts in column 0 — `@layer base {`, `.hud-panel {`, `@media … {`. */
const TOP_LEVEL = /^(\S[^\n{]*)\{/gm;

/** The body of `@layer <name> { … }`, braces balanced. */
function layer(name: string): string {
  const start = css.indexOf(`@layer ${name} {`);
  if (start === -1) return "";
  let depth = 0;
  for (let at = start; at < css.length; at += 1) {
    // `charAt`, not `css[at]`: an indexed read with a computed key is what
    // `security/detect-object-injection` flags, and it is not worth an exception here.
    const char = css.charAt(at);
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, at + 1);
    }
  }
  return "";
}

describe("the cascade layers", () => {
  it("puts no style rule at column 0", () => {
    // The whole point. Anything here outranks every utility in the project, for ever, with no
    // warning at the call site.
    const offenders = [...css.matchAll(TOP_LEVEL)]
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
      css.indexOf(`@layer ${name} {`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((at) => at !== -1)).toBe(true);
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
