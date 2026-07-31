import { beforeEach, describe, expect, it } from "vitest";
import { makeItem } from "../lib/statusBar";
import { useUiStore } from "./ui";

describe("useUiStore", () => {
  beforeEach(() => {
    useUiStore.setState({ view: "terminal", aboutOpen: false, activeTool: null, toolWidth: 280 });
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

  it("starts with the tool column collapsed", () => {
    // A fresh install earns the terminal all its width; the column appears once a tool is asked for.
    expect(useUiStore.getState().activeTool).toBeNull();
  });

  it("toggles a tool open and closed from the same rail button", () => {
    useUiStore.getState().toggleTool("git");
    expect(useUiStore.getState().activeTool).toBe("git");

    useUiStore.getState().toggleTool("git");
    expect(useUiStore.getState().activeTool).toBeNull();
  });

  it("keeps the chosen width while the column is collapsed", () => {
    useUiStore.getState().setToolWidth(340);
    useUiStore.getState().toggleTool("git");
    useUiStore.getState().toggleTool("git");

    // Reopening must restore the size the user dragged to, not a default.
    expect(useUiStore.getState().toolWidth).toBe(340);
  });

  it("clamps a width to the usable range", () => {
    useUiStore.getState().setToolWidth(10);
    expect(useUiStore.getState().toolWidth).toBe(180);

    useUiStore.getState().setToolWidth(9999);
    expect(useUiStore.getState().toolWidth).toBe(560);
  });

  it("collapses a persisted tool that no longer exists", async () => {
    window.localStorage.setItem(
      "app-ui",
      JSON.stringify({ state: { view: "terminal", activeTool: "retired-tool" }, version: 1 }),
    );

    await useUiStore.persist.rehydrate();

    // Better an honest collapse than a column taking up space and rendering nothing.
    expect(useUiStore.getState().activeTool).toBeNull();
  });

  it("repairs a persisted width that is out of bounds", async () => {
    window.localStorage.setItem(
      "app-ui",
      JSON.stringify({ state: { view: "terminal", toolWidth: 4 }, version: 1 }),
    );

    await useUiStore.persist.rehydrate();

    expect(useUiStore.getState().toolWidth).toBe(180);
  });
});

describe("the status bar layout", () => {
  it("starts with the defaults", () => {
    expect(useUiStore.getState().statusLayout.map((i) => i.id)).toEqual([
      "version",
      "spacer",
      "command",
      "separator",
      "repository",
    ]);
  });

  it("stores a layout the editor produces", () => {
    const next = [makeItem("cwd"), makeItem("spacer")];
    useUiStore.getState().setStatusLayout(next);
    expect(useUiStore.getState().statusLayout.map((i) => i.id)).toEqual(["cwd", "spacer"]);
  });

  it("takes an empty bar, because removing everything is a choice", () => {
    useUiStore.getState().setStatusLayout([]);
    expect(useUiStore.getState().statusLayout).toEqual([]);
  });

  it("puts the defaults back", () => {
    useUiStore.getState().setStatusLayout([]);
    useUiStore.getState().resetStatusLayout();
    expect(useUiStore.getState().statusLayout.length).toBeGreaterThan(0);
  });

  it("refuses an id it does not know, rather than rendering a blank slot", () => {
    // The payload passes through localStorage, which anything can edit, and older builds knew fewer
    // items. Sanitising on the way IN means the renderer never has to defend itself.
    useUiStore.getState().setStatusLayout([
      { key: "a", id: "version" },
      { key: "b", id: "teleporter" },
    ] as never);
    expect(useUiStore.getState().statusLayout.map((i) => i.id)).toEqual(["version"]);
  });
});
