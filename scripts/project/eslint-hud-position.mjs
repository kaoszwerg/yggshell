/**
 * ESLint rule: a floating HUD surface must not be built on `.hud-panel`.
 *
 * **The defect this exists for.** `.hud-panel` declares `position: relative` — it has to, so its
 * `::before` can inset by 1px and draw the chamfered border. That declaration is *unlayered*, and
 * unlayered CSS beats every `@layer`, including the one Tailwind's utilities live in. So
 * `className="hud-panel absolute inset-0"` reads as if the element floats and it does not: it stays
 * in the flow, `inset-0` does nothing, it has no height of its own, and an `overflow-auto` child that
 * needed a bounded height silently stops being a scroll container. Nothing reports any of it. It shows
 * up as a panel stuck below the thing it was supposed to cover — which is exactly how it shipped once.
 *
 * `.hud-popover` is the same chamfered border with `position` deliberately left to the caller, and is
 * what a floating surface wants.
 *
 * **Why a rule of our own rather than `no-restricted-syntax`.** The base config (app layer, pinned)
 * already uses `no-restricted-syntax` for the native-element bans, and ESLint's flat config *replaces*
 * a rule's options rather than merging them — adding our selector there would have silently switched
 * off the ban on native `<button>`, `<input>` and the `title` tooltip. That is precisely the "never
 * weaken a gate you do not own" failure (rule:code-quality), and it is invisible: the config still
 * loads, the lint still passes, and the other gate is simply gone.
 *
 * **Limit, stated rather than hidden:** this reads string literals and the static parts of a template
 * literal. A class name assembled at runtime slips past. It is a gate, not a proof.
 */

const FLOATING = /(^|\s)(absolute|fixed)(\s|$)/;
const PANEL = /(^|\s)hud-panel(\s|$)/;
const POPOVER = /(^|\s)hud-popover(\s|$)/;
/** Anything that makes an element a containing block for its own absolutely-positioned children. */
const POSITIONED = /(^|\s)(absolute|fixed|relative|sticky)(\s|$)/;

/** Every static string inside a className attribute value, whatever syntax it was written in. */
function staticText(value) {
  if (value === null) return [];
  if (value.type === "Literal") return typeof value.value === "string" ? [value.value] : [];
  if (value.type === "JSXExpressionContainer") {
    const expression = value.expression;
    if (expression.type === "Literal") {
      return typeof expression.value === "string" ? [expression.value] : [];
    }
    if (expression.type === "TemplateLiteral") {
      return expression.quasis.map((quasi) => quasi.value.cooked ?? "");
    }
  }
  return [];
}

export const floatingPanelPosition = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A floating surface must use hud-popover, not hud-panel, which pins position: relative",
    },
    schema: [],
    messages: {
      pinned:
        "`hud-panel` pins `position: relative` and silently beats `absolute`/`fixed` — the surface stays in the flow and its scroll container never bounds. Use `hud-popover` plus a `hud-accent-*` class (ADR-APP-026).",
      unpositioned:
        "`hud-popover` draws its interior with an `::before` at `inset: 1px` and sets NO position of its own, so without one here that interior resolves against the nearest positioned ancestor and spills across it. Add `relative` (or the `absolute`/`fixed` the surface floats with).",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;
        const parts = staticText(node.value);
        // Joined, because a template literal splits one class list across several quasis and the two
        // class names can land on either side of an interpolation.
        const text = parts.join(" ");
        if (PANEL.test(text) && FLOATING.test(text)) {
          context.report({ node, messageId: "pinned" });
        }
        // The mirror image of the same defect, and the half that shipped: `hud-popover` leaves
        // `position` to the caller, so a caller that gives none has an interior anchored to whatever
        // is positioned above it. Every floating caller got this right by accident — they carry
        // `absolute`/`fixed` anyway. The one that centres in flow (the toast) did not, and its dark
        // fill ran the whole width of the row on both sides of the message.
        if (POPOVER.test(text) && !POSITIONED.test(text)) {
          context.report({ node, messageId: "unpositioned" });
        }
      },
    };
  },
};

/** The plugin as the flat config consumes it. */
export const hudPlugin = {
  rules: { "floating-panel-position": floatingPanelPosition },
};
