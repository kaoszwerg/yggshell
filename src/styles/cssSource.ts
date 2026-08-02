// `?raw` rather than `node:fs`: the frontend tsconfig deliberately carries no Node types, so that no
// component can reach for the filesystem. A test is not a reason to open that door — and Vite hands
// back the untransformed source text, which is exactly what is being asserted on.
import css from "./globals.css?raw";

/**
 * Reading the stylesheet as text, for the tests that have no other way to see it.
 *
 * **A stylesheet is the one part of this app no other test touches.** jsdom applies none of it, so
 * there is no computed style to assert against, and every defect the frame and the activity line have
 * produced rendered as *something* while the whole gate stayed green. Crude, and deliberate.
 *
 * Shared by `globals.test.ts` and `window-frame.test.ts` rather than copied into both: the helpers
 * below each encode a trap that was paid for once, and two copies would drift apart at the first fix
 * (`rule:reusability`).
 */
export { css };

/**
 * The stylesheet with every comment removed.
 *
 * For the file-wide negative assertions. Scoping a check to one rule is not always possible — "this
 * name appears NOWHERE any more" is a statement about the file — and every such check has at some
 * point matched the very sentence that documents why the thing is gone.
 */
export const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * `text` with every `@media { … }` removed, by counting braces rather than matching them.
 *
 * A regex for a balanced block needs a nested quantifier, and `security/detect-unsafe-regex` rejects
 * that on sight — rightly: the same pattern is how a linear input becomes an exponential match. This
 * is longer and cannot backtrack at all.
 */
function withoutMediaBlocks(text: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const start = text.indexOf("@media", at);
    if (start === -1) return out + text.slice(at);
    out += text.slice(at, start);
    const open = text.indexOf("{", start);
    if (open === -1) return out + text.slice(start);
    let depth = 0;
    let cursor = open;
    for (; cursor < text.length; cursor += 1) {
      const char = text.charAt(cursor);
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    at = cursor + 1;
  }
}

/**
 * The stylesheet with every `@media` block removed.
 *
 * A rule inside one is an override of the rule outside it, so a selector lookup that finds the
 * media-query copy first reads the exception as if it were the rule — which is what happened the
 * moment the layers went in and the reduced-motion block stayed at column 0. Deliberately: an
 * accessibility override has to outrank everything, including a utility the caller passes, and a
 * layered one would not.
 */
const unconditional = withoutMediaBlocks(css);

/**
 * A rule's declarations, with its comments stripped.
 *
 * Not fussiness: the comment inside a rule is usually the sentence explaining what must NOT be there,
 * so it contains every word a negative assertion looks for. Two of the checks matched their own
 * documentation before this existed — the same trap `environment.rs` and the kill-session scan both
 * hit, and it is worth solving once rather than by wording each comment around its test.
 */
export function declarations(selector: string): string {
  const from = unconditional.slice(unconditional.indexOf(`${selector} {`));
  return from.slice(0, from.indexOf("}")).replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * An at-rule's body, comments stripped — same reasoning as {@link declarations}.
 *
 * The body is found by COUNTING braces, not by looking for one in column 0. That shortcut worked only
 * while these at-rules sat at the top level; once they moved inside `@layer components` (they had to —
 * Lightning CSS drops keyframes it cannot see used from the same layer) the first column-0 brace
 * became the layer's own, hundreds of lines later, and every at-rule body silently grew to include
 * every rule after it. The test that noticed was a NEGATIVE one, which is the only kind that can be
 * broken by a body that is too big.
 */
export function atRule(prelude: string): string {
  const from = css.slice(css.indexOf(prelude));
  const open = from.indexOf("{");
  let depth = 0;
  for (let i = open; i < from.length; i += 1) {
    const ch = from.charAt(i);
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return from.slice(0, i + 1).replace(/\/\*[\s\S]*?\*\//g, "");
    }
  }
  throw new Error(`unbalanced at-rule: ${prelude}`);
}
