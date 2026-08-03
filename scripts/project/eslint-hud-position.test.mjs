// @vitest-environment node
import { describe, it } from "vitest";
import { RuleTester } from "eslint";
// Through the meta package we already depend on, rather than reaching into the transitive
// `@typescript-eslint/parser` — an unlisted dependency is a build that works until it does not.
import tseslint from "typescript-eslint";
import { floatingPanelPosition } from "./eslint-hud-position.mjs";

// RuleTester drives a test runner of its own; point it at vitest's.
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run("floating-panel-position", floatingPanelPosition, {
  valid: [
    // The correct way to build a floating surface.
    { code: 'const a = <div className="hud-popover hud-accent-cyan absolute inset-0" />;' },
    // A panel that is not floating is exactly what hud-panel is for.
    { code: 'const a = <div className="hud-panel flex flex-col p-2" />;' },
    // Neither half on its own is a problem.
    { code: 'const a = <div className="absolute inset-0" />;' },
    // A class whose name merely CONTAINS the words must not trip it.
    { code: 'const a = <div className="hud-panel-header absolutely-not" />;' },
    { code: 'const a = <div className="my-hud-panel absolute" />;' },
    // Not a className at all.
    { code: 'const a = <div data-x="hud-panel absolute" />;' },
    // `hud-popover` with a position of its own — every legitimate use has one.
    { code: 'const a = <div className="hud-popover hud-clip-sm relative px-3" />;' },
    { code: 'const a = <div className="hud-popover hud-accent-cyan fixed z-30" />;' },
    { code: 'const a = <div className="hud-popover sticky top-0" />;' },
    // A class that merely contains the word.
    { code: 'const a = <div className="hud-popover-x" />;' },
  ],
  invalid: [
    {
      code: 'const a = <div className="hud-panel absolute inset-0" />;',
      errors: [{ messageId: "pinned" }],
    },
    {
      code: 'const a = <div className="fixed hud-panel z-30" />;',
      errors: [{ messageId: "pinned" }],
    },
    // Written as an expression rather than a bare string.
    {
      code: 'const a = <div className={"hud-panel absolute"} />;',
      errors: [{ messageId: "pinned" }],
    },
    // A template literal: the two class names sit on either side of an interpolation, which is how
    // this gets written in practice and exactly where a naive check would miss it.
    {
      code: "const a = <div className={`hud-panel ${extra} absolute inset-0`} />;",
      errors: [{ messageId: "pinned" }],
    },
    // The defect as it actually shipped: a popover that centres in flow, so nobody thought to give
    // it a position, and its `::before` anchored to the full-width row above instead.
    {
      code: 'const a = <div className="hud-popover hud-clip-sm px-3 py-1" />;',
      errors: [{ messageId: "unpositioned" }],
    },
    // …and written the way the toast writes it, with the accent interpolated in.
    {
      code: "const a = <div className={`hud-popover hud-clip-sm ${accent} px-3 py-1`} />;",
      errors: [{ messageId: "unpositioned" }],
    },
  ],
});
