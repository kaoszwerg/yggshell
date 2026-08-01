/**
 * What a mark on a tab MEANS, and therefore what colour it is.
 *
 * One source for the mapping, because both halves of it are read in different places: the store
 * decides which kind a tab carries, the tab strip draws it, the status bar counts it. A colour picked
 * at the drawing site would drift from a meaning decided at the deciding site, and the two would then
 * disagree in front of the user (ADR-CORE-005).
 *
 * **The distinction is not decoration.** Every mark used to be gold, which said "something wants you"
 * about a harness that had merely gone quiet — its own wording, *"Claude is waiting for your input"*,
 * reads as a question and is not one (`hooks::is_idle`). A signal that cannot separate "answer me"
 * from "I am finished" makes the user open the tab to find out, which is the work the mark existed to
 * save.
 */
export type BellKind =
  /** Something is blocked on you: a permission request, or a bare `\a` whose meaning is unknowable. */
  | "action"
  /** Finished, and nobody came back to it. Informative, never blocking. */
  | "done";

/**
 * The dot's colour for a kind.
 *
 * Gold is the honest default for an ambiguous signal — a terminal `\a` carries nothing that could say
 * which of the two it is, so claiming "finished" would be a guess (rule:no-guessing). Green is only
 * used where the source actually said so.
 */
export function bellDotClass(kind: BellKind): string {
  return kind === "done" ? "bg-green" : "bg-gold";
}
