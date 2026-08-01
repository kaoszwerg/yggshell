import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useContentFontSize } from "./useContentFontSize";

vi.mock("./useSettings", () => ({ useSettings: vi.fn() }));
import { useSettings } from "./useSettings";

describe("useContentFontSize", () => {
  it("follows the terminal's own text size", () => {
    // Reported: the tools ignored the setting. Code is code — somebody who turned the terminal up
    // did so because that size is comfortable, and a panel beside it at a hard-coded 11px is the
    // app deciding it knows better.
    vi.mocked(useSettings).mockReturnValue({
      data: { terminal_font_size: 17 },
    } as unknown as ReturnType<typeof useSettings>);

    expect(renderHook(() => useContentFontSize()).result.current).toBe(17);
  });

  it("has a size before the settings have loaded", () => {
    // The panels render on the first frame; a zero or an undefined would collapse them.
    vi.mocked(useSettings).mockReturnValue({ data: undefined } as unknown as ReturnType<
      typeof useSettings
    >);

    expect(renderHook(() => useContentFontSize()).result.current).toBe(13);
  });
});
