import { describe, it, expect } from "vitest";
import { contrast } from "./contrast";
import { HUD_TERMINAL_THEME } from "./terminalTheme";

/**
 * Yggdrasil is the scheme this app ships as its own, and the one every terminal starts on. The
 * bundled thirteen are other people's palettes and are not judged here — their scores are theirs,
 * and recolouring them would make them no longer their themes.
 *
 * The defect that prompted this: `brightBlack` scored 1.78:1, invisible on the background, and it is
 * the slot every program uses for comments and the diff uses for line numbers.
 */
describe("the Yggdrasil palette is readable", () => {
  const bg = HUD_TERMINAL_THEME.background ?? "";
  // Through a Map rather than an index: the gate runs at zero warnings and a computed member access
  // is an object-injection sink to it. The keys are ours, but arguing costs more than avoiding.
  const slots = new Map(Object.entries(HUD_TERMINAL_THEME));
  const ratio = (slot: string) => contrast(String(slots.get(slot) ?? ""), bg) ?? 0;

  it("puts body text well clear of the AA threshold", () => {
    expect(ratio("foreground")).toBeGreaterThan(7);
  });

  it("keeps the quiet slot dim but legible", () => {
    // Not AA: this slot is *meant* to recede, and pushing it to 4.5 would stop it reading as
    // secondary. 3 is the large-text floor and more than double what it used to be.
    expect(ratio("brightBlack")).toBeGreaterThan(3);
  });

  it("keeps white legible ON the quiet slot, which is also a surface", () => {
    // A prompt fills this slot as a Powerline segment and writes on it. Raising it far enough for
    // comments must not make that unreadable — the two pull in opposite directions.
    expect(contrast("#ffffff", String(slots.get("brightBlack") ?? "")) ?? 0).toBeGreaterThan(4.5);
  });

  it("keeps every bright slot usable as text", () => {
    // The bright half is what a program reaches for when it wants to be seen.
    for (const slot of ["brightRed", "brightGreen", "brightYellow", "brightBlue", "brightCyan"]) {
      expect(ratio(slot), slot).toBeGreaterThan(4.5);
    }
  });
});
