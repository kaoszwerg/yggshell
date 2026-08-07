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

import { hudPlugin } from "./scripts/project/eslint-hud-position.mjs";
import { i18nPlugin } from "./scripts/project/eslint-no-untranslated.mjs";

export default [
  {
    // A design folder that belongs to no repository, kept out of the tree by `.git/info/exclude`.
    // It carries a measurement rig — plain Node scripts that spawn agent sessions and drive an HTTP
    // room — which is neither this app's source nor governed by its lint: the browser globals the
    // base config assumes are absent, and `process` and `setTimeout` are exactly what it is made of.
    //
    // **Ignored rather than configured as a Node environment on purpose.** It is not this project's
    // code; it is evidence, kept beside the design it measured so a future reader can re-run it. The
    // day it becomes a product it gets a repository, and that repository brings its own gate.
    ignores: ["blueprint-mot/**"],
  },
  {
    files: ["src/**/*.tsx"],
    plugins: { hud: hudPlugin },
    rules: {
      // A floating surface must not be built on `.hud-panel` — see the rule's own file for the
      // defect and, more importantly, for why this is a rule of our own instead of another
      // `no-restricted-syntax` entry: flat config REPLACES a rule's options rather than merging
      // them, so adding a selector to the base config's entry here would have silently switched
      // off its bans on native <button>, <input> and the `title` tooltip. Verified by trying it.
      "hud/floating-panel-position": "error",
    },
  },
  {
    // `<details>`/`<summary>` are stock UI, and the base config does not name them.
    //
    // It bans `button`, `input`, `select`, `textarea` and the `title` tooltip — the list was written
    // from the controls that existed then. A disclosure is exactly as much an interactive control a
    // view touches (ADR-APP-026), and styling the native one means deleting its marker and rebuilding
    // its focus ring, which is the "fighting its skin" the rule names. `ui/Disclosure` is the
    // primitive; this is what keeps callers on it.
    //
    // Its OWN entry, not an addition to the base config's `no-restricted-syntax`: flat config
    // REPLACES a rule's options instead of merging them, so extending that entry here would silently
    // switch off its existing bans. Two other overlays in this file carry the same warning, learned
    // the same way.
    files: ["src/**/*.tsx"],
    ignores: ["src/**/*.test.tsx", "src/components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='details']",
          message:
            "No native <details> outside src/components/ui — use the Disclosure primitive (ADR-APP-026).",
        },
        {
          selector: "JSXOpeningElement[name.name='summary']",
          message:
            "No native <summary> outside src/components/ui — use the Disclosure primitive (ADR-APP-026).",
        },
      ],
    },
  },
  {
    // Every user-facing string comes from the catalogue. Two languages are easy to ship and hard to
    // KEEP: without this, the interface drifts back into English one new button at a time, and the
    // type system cannot object — an English word in JSX is a perfectly good string.
    files: ["src/**/*.tsx"],
    ignores: ["src/**/*.test.tsx"],
    plugins: { i18n: i18nPlugin },
    rules: {
      "i18n/no-untranslated-text": "error",
    },
  },
  {
    // Every copy goes through `lib/clipboard`, and this is what keeps it that way.
    //
    // Copying is invisible: the selection looks identical before and after, so a copy that silently
    // did nothing cannot be told from one that worked. Six call sites each had their own
    // `writeText(…).catch(console.warn)` — a failure reported to a console the user does not have
    // open, which `rule:logging` calls a swallowed error however carefully it was caught. The helper
    // shows a confirmation and shows the failure; a raw call would quietly do neither.
    //
    // **And `lib/clipboard.ts` is no longer exempt, which is the point of this being a gate at all.**
    // The helper itself used to be allowed the raw call, and that exemption is where the defect lived:
    // WebKit gates `writeText` on a user gesture, and the terminal's copy-on-select has none — xterm
    // calls `preventDefault()` on `mousedown`, so the activation is gone by the `mouseup` that copies.
    // WebKit then refused the write WITHOUT settling the promise, so nothing was copied and not even
    // the failure toast appeared (0.47.1). Copying from a note kept working, because a button click IS
    // a gesture. The write now goes through the backend like the read, so there is no call site left
    // that legitimately needs this API and the ban can be absolute.
    //
    // Its own entry rather than an addition to the base config's `no-restricted-syntax`: flat config
    // REPLACES a rule's options instead of merging them, so extending that entry here would silently
    // switch off its bans on native <button>, <input> and the `title` tooltip (verified by trying it).
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          // The PROPERTY alone, with no `object`. `no-restricted-properties` only matches an `object`
          // that is a plain identifier, and the call is `navigator.clipboard.writeText` — the object
          // there is a member expression, so naming it matches nothing at all (verified against a
          // deliberate offender before this comment was written). `writeText` exists on nothing else
          // this app touches, so the property on its own is precise enough.
          property: "writeText",
          message:
            "Use copyText() from lib/clipboard, which writes through the backend (terminalApi.writeClipboard). navigator.clipboard.writeText is gated on a user gesture in WebKit and fails SILENTLY without one — it never settles, so not even the failure is reported.",
        },
      ],
    },
  },
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
