import { act, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Toast } from "./Toast";
import { useToastStore, TOAST_MS } from "../../store/toast";
import { useUiStore } from "../../store/ui";

describe("Toast", () => {
  beforeEach(() => {
    useUiStore.setState({ locale: "en" });
    useToastStore.setState({ toast: null });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says WHAT was copied, not merely that something was", () => {
    // The whole reason the message exists is that copying is invisible. "Copied" leaves the user
    // asking "copied what?" the moment two controls sit next to each other, which in the Activity
    // tool they do — a port and a pid, one row apart.
    render(<Toast />);
    act(() => {
      useToastStore.getState().notify("clipboard.port");
    });

    expect(screen.getByRole("status").textContent).toBe("Port copied");
  });

  it("clears itself, so nothing has to be dismissed", () => {
    render(<Toast />);
    act(() => {
      useToastStore.getState().notify("clipboard.path");
    });
    expect(screen.queryByRole("status")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 50);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("restarts the clock for a second message instead of inheriting the first one's", () => {
    // Two copies in quick succession. Keyed on the id rather than on the message, the second toast
    // would otherwise carry whatever was left of the first one's timer and could vanish almost at
    // once — the failure being confirmed for the copy the user just made.
    render(<Toast />);
    act(() => {
      useToastStore.getState().notify("clipboard.path");
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 100);
    });
    act(() => {
      useToastStore.getState().notify("clipboard.port");
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });
    // The first one's deadline has now passed; the second must still be there.
    expect(screen.getByRole("status").textContent).toBe("Port copied");
  });

  it("reports a failure in the danger accent, and a success in green", () => {
    // The two outcomes must not look alike: a copy that failed and one that worked are the exact
    // pair this message exists to tell apart.
    const { container } = render(<Toast />);
    act(() => {
      useToastStore.getState().notify("clipboard.failed", "error");
    });
    expect(container.querySelector(".hud-accent-danger")).not.toBeNull();

    act(() => {
      useToastStore.getState().notify("clipboard.selection");
    });
    expect(container.querySelector(".hud-accent-green")).not.toBeNull();
    expect(container.querySelector(".hud-accent-danger")).toBeNull();
  });

  it("cannot swallow a click on what is underneath it", () => {
    // It sits over the terminal. A confirmation that eats a click is worse than no confirmation.
    const { container } = render(<Toast />);
    act(() => {
      useToastStore.getState().notify("clipboard.selection");
    });
    expect(container.firstElementChild?.className).toContain("pointer-events-none");
  });

  it("announces politely rather than interrupting", () => {
    // `status`/`polite`, never `alert`: this confirms something the user just did, and an alert cuts
    // a screen reader off mid-sentence — louder than the thing being reported.
    render(<Toast />);
    act(() => {
      useToastStore.getState().notify("clipboard.selection");
    });
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});
