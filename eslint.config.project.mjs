// Project-owned ESLint overlay (ADR-CORE-032). Appended AFTER the pinned base in `eslint.config.mjs`,
// which is app-layer config and must never be edited in place.
//
// Everything here states a fact the base config cannot know about this project. Nothing here relaxes a
// finding to make the gate green — that is the regression rule:security exists to prevent.
//
// NOT here, and deliberately: `@typescript-eslint/no-floating-promises` with `ignoreVoid: false`.
// `void somePromise` discards the rejection, which in this app becomes a fatal screen over the whole
// interface — so the rule would be worth having. It is type-aware, the base config runs no type-aware
// linting at all, and enabling that for `src/**` from an overlay makes the rule crash rather than
// report. Catching every rejection at the call site is held by review until the base config grows a
// typed parser; the reasoning lives here so the next attempt starts from what was already learned.

export default [
  {
    files: ["src/components/ui/Splitter.tsx"],
    rules: {
      // A focusable `separator` carrying `aria-valuenow` is the WAI-ARIA **Window Splitter** pattern —
      // it IS interactive, by definition, and the APG requires it to be in the tab order. jsx-a11y's
      // built-in list of interactive roles predates that and does not include `separator`, so it reads
      // the correct implementation as a violation.
      //
      // Scoped to the one file that implements the pattern rather than switched off globally: a
      // non-focusable separator anywhere else is still a real finding, and this file is the only place
      // in the app allowed to build a drag handle (ADR-APP-026).
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/no-noninteractive-tabindex": "off",
    },
  },
];
