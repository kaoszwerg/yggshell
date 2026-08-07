import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useContentFontSize, useToolFontSize } from "./useContentFontSize";

vi.mock("./useSettings", () => ({ useSettings: vi.fn() }));
import { useSettings } from "./useSettings";

describe("useToolFontSize", () => {
  it("is independent of the UI scale, because they are three separate questions", () => {
    // Reported from the running app: "aktuell ändert sich diff und commit mit der ui size und das
    // ist schlecht". `ui_scale` is native WebView zoom (ADR-APP-021) — it multiplies every DOM
    // pixel, so a tool that merely READS `tool_font_size` still grows when the chrome does, and the
    // size the user chose for its content is overridden by an unrelated setting.
    //
    // The emulator has divided since the day it was built, for exactly this reason. Tool content
    // does now too: UI is UI, terminal is terminal, everything else is tool, and each follows one.
    vi.mocked(useSettings).mockReturnValue({
      data: { tool_font_size: 16, ui_scale: 2 },
    } as unknown as ReturnType<typeof useSettings>);

    expect(renderHook(() => useToolFontSize()).result.current).toBe(8);
  });

  it("starts at the terminal's size, so introducing the control moved nothing", () => {
    vi.mocked(useSettings).mockReturnValue({
      data: { terminal_font_size: 17, ui_scale: 1 },
    } as unknown as ReturnType<typeof useSettings>);

    expect(renderHook(() => useToolFontSize()).result.current).toBe(17);
  });

  it("survives a zero or missing scale rather than dividing by it", () => {
    // A settings file edited by hand, or a first frame before defaults land. Dividing by zero would
    // render every tool at Infinity, which is a blank panel and no error anywhere.
    vi.mocked(useSettings).mockReturnValue({
      data: { tool_font_size: 14, ui_scale: 0 },
    } as unknown as ReturnType<typeof useSettings>);

    expect(renderHook(() => useToolFontSize()).result.current).toBe(14);
  });
});

describe("useContentFontSize", () => {
  it("follows the terminal's own text size", () => {
    // A reading surface — a diff, a commit, a note — is the same act as reading a terminal. Code is
    // code, and the size chosen for one is the size wanted for the other.
    vi.mocked(useSettings).mockReturnValue({
      data: { terminal_font_size: 17, ui_scale: 1 },
    } as unknown as ReturnType<typeof useSettings>);

    expect(renderHook(() => useContentFontSize()).result.current).toBe(17);
  });

  it("is independent of the UI scale, like every other text setting", () => {
    // Reported when the reading surfaces had been moved onto the tool size and came out too small:
    // "und das ist bei git commit, git diff, markdown edit und markdown view/render ebenfalls so".
    // Three questions, three answers, and none of them may quietly override another.
    vi.mocked(useSettings).mockReturnValue({
      data: { terminal_font_size: 16, ui_scale: 2 },
    } as unknown as ReturnType<typeof useSettings>);

    expect(renderHook(() => useContentFontSize()).result.current).toBe(8);
  });

  it("is NOT the tool column's size — reading and scanning are different", () => {
    // The line the second attempt got wrong. A dense column of paths wants to be smaller than the
    // thing you sat down to read, which is why the two settings hold different numbers at all.
    vi.mocked(useSettings).mockReturnValue({
      data: { terminal_font_size: 16, tool_font_size: 14, ui_scale: 1 },
    } as unknown as ReturnType<typeof useSettings>);

    expect(renderHook(() => useContentFontSize()).result.current).toBe(16);
    expect(renderHook(() => useToolFontSize()).result.current).toBe(14);
  });

  it("has a size before the settings have loaded", () => {
    // The panels render on the first frame; a zero or an undefined would collapse them.
    vi.mocked(useSettings).mockReturnValue({ data: undefined } as unknown as ReturnType<
      typeof useSettings
    >);

    expect(renderHook(() => useContentFontSize()).result.current).toBe(13);
  });
});
