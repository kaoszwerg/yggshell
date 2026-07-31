import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./ui";

describe("useUiStore", () => {
  beforeEach(() => {
    useUiStore.setState({ view: "terminal", aboutOpen: false });
    window.localStorage.clear();
  });

  it("setView updates the active sidebar view", () => {
    useUiStore.getState().setView("logs");
    expect(useUiStore.getState().view).toBe("logs");

    useUiStore.getState().setView("settings");
    expect(useUiStore.getState().view).toBe("settings");
  });

  it("setAboutOpen toggles the transient About dialog flag", () => {
    expect(useUiStore.getState().aboutOpen).toBe(false);

    useUiStore.getState().setAboutOpen(true);
    expect(useUiStore.getState().aboutOpen).toBe(true);

    useUiStore.getState().setAboutOpen(false);
    expect(useUiStore.getState().aboutOpen).toBe(false);
  });

  it("onRehydrateStorage resets an invalid persisted view to the terminal", async () => {
    window.localStorage.setItem(
      "app-ui",
      JSON.stringify({ state: { view: "not-a-real-view" }, version: 1 }),
    );

    await useUiStore.persist.rehydrate();

    expect(useUiStore.getState().view).toBe("terminal");
  });

  it("falls back to the terminal for a view that used to exist", async () => {
    // "home" was a real view until the Home page was removed. A persisted one must not leave the
    // user staring at a blank pane.
    window.localStorage.setItem("app-ui", JSON.stringify({ state: { view: "home" }, version: 1 }));

    await useUiStore.persist.rehydrate();

    expect(useUiStore.getState().view).toBe("terminal");
  });

  it("onRehydrateStorage keeps a valid persisted view", async () => {
    window.localStorage.setItem(
      "app-ui",
      JSON.stringify({ state: { view: "settings" }, version: 1 }),
    );

    await useUiStore.persist.rehydrate();

    expect(useUiStore.getState().view).toBe("settings");
  });
});
