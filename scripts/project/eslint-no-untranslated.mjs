/**
 * Refuse a user-facing string written straight into a component.
 *
 * **The failure this prevents.** Two languages are easy to ship and hard to keep: the catalogue is
 * complete today, and then somebody adds a button. The type system cannot help — an English word in
 * JSX is a perfectly good string — so without a check the interface drifts back into English one
 * feature at a time, and nobody notices until a German-speaking user does (rule:knowledge-handover:
 * if it can be checked, check it).
 *
 * **What counts as user-facing**, and the reasoning behind each:
 *
 *  - JSX text nodes — what the user reads.
 *  - `label`, `tooltip`, `placeholder`, `aria-label`, `emptyHint`, `description`, `addLabel` — the
 *    props of this app's own primitives that end up on screen or in a screen reader. Listed by name
 *    rather than "every string prop", because `className`, `id`, `accent` and `variant` are strings
 *    too and none of them are words.
 *
 * **What does not**: a single symbol or number (`↑`, `·`, `12px`), anything inside `<code>`, and the
 * files that are allowed to hold the words in the first place. A proper noun is not exempt — put it
 * in the catalogue identically in both languages, so the decision is visible instead of implicit.
 */

/** Props whose value is read by a person. */
const TEXT_PROPS = new Set([
  "label",
  "tooltip",
  "placeholder",
  "aria-label",
  "emptyHint",
  "description",
  "addLabel",
  "title",
]);

/** Elements whose text is not prose: code samples, shell paths, key names. */
const VERBATIM_ELEMENTS = new Set(["code", "pre", "kbd"]);

/**
 * Whether a string is a word rather than a symbol.
 *
 * Two letters minimum and at least one space or three letters: `OK` stays, `↑` and `·` and `12px`
 * do not trip it, and neither does a single capitalised token that is almost always a proper noun in
 * a template — those are caught by review, not by a rule that would cry wolf on `Git`.
 */
function looksLikeProse(text) {
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;
  if (!/[A-Za-z]{3}/.test(trimmed)) return false;
  // A single word with no spaces: too likely to be an identifier, a unit or a proper noun.
  return /\s/.test(trimmed);
}

/** Whether this JSX element renders its children verbatim. */
function insideVerbatim(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "JSXElement") {
      const name = current.openingElement?.name?.name;
      if (typeof name === "string" && VERBATIM_ELEMENTS.has(name.toLowerCase())) return true;
    }
  }
  return false;
}

export const noUntranslatedText = {
  meta: {
    type: "problem",
    docs: {
      description:
        "User-facing text must come from the message catalogue (src/i18n), not be written into a component",
    },
    schema: [],
    messages: {
      jsxText:
        'Untranslated text: "{{text}}". Add a message to src/i18n/en.ts (and de.ts — the compiler will insist) and render it with t("key").',
      prop: 'Untranslated `{{prop}}`: "{{text}}". Add a message to src/i18n/en.ts and pass t("key").',
    },
  },
  create(context) {
    return {
      JSXText(node) {
        if (!looksLikeProse(node.value)) return;
        if (insideVerbatim(node)) return;
        context.report({
          node,
          messageId: "jsxText",
          data: { text: node.value.trim().slice(0, 60) },
        });
      },
      JSXAttribute(node) {
        const name = node.name?.name;
        if (typeof name !== "string" || !TEXT_PROPS.has(name)) return;
        const value = node.value;
        if (!value) return;
        // `label="Save"` — a literal. `label={t("…")}` and `label={variable}` are fine.
        if (value.type === "Literal" && typeof value.value === "string") {
          if (!looksLikeProse(value.value)) return;
          context.report({
            node,
            messageId: "prop",
            data: { prop: name, text: value.value.slice(0, 60) },
          });
        }
      },
    };
  },
};

/** The plugin as the flat config consumes it. */
export const i18nPlugin = {
  rules: { "no-untranslated-text": noUntranslatedText },
};
