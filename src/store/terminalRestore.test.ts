// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

/**
 * What survives a restart, and — more importantly — what must not.
 *
 * A PTY dies with the app: the shell gets its SIGHUP and no bookkeeping brings it back. So restoring
 * the WORKSPACE (which tabs, where each was, its profile and scheme) is honest, and restoring
 * anything that describes a live process would be a lie the user reads as truth.
 */
const KEY = "app-terminals";

/** Write a persisted payload the way the middleware does, then load the store fresh. */
async function restoreFrom(state: unknown) {
  localStorage.setItem(KEY, JSON.stringify({ state, version: 1 }));
  const mod = await import(`./terminal?restore=${Math.random().toString(36).slice(2)}`);
  return mod.useTerminalStore as typeof import("./terminal").useTerminalStore;
}

describe("restoring the workspace", () => {
  beforeEach(() => localStorage.clear());

  it("brings back the tabs, their directories, profiles and schemes", async () => {
    const store = await restoreFrom({
      panes: [
        { key: "term-0", cwd: "/repo", profileId: "work", themeId: "nord", tmuxSession: null },
        { key: "term-1", cwd: "/other", profileId: null, themeId: null, tmuxSession: "yggshell-2" },
      ],
      activeKey: "term-1",
    });

    const panes = store.getState().panes;
    expect(panes).toHaveLength(2);
    expect(panes[0]).toMatchObject({ cwd: "/repo", profileId: "work", themeId: "nord" });
    expect(panes[1]).toMatchObject({ cwd: "/other", tmuxSession: "yggshell-2" });
  });

  it("keeps the tab that was in front, in front", async () => {
    const store = await restoreFrom({
      panes: [
        { key: "term-0", cwd: null, profileId: null, themeId: null, tmuxSession: null },
        { key: "term-1", cwd: null, profileId: null, themeId: null, tmuxSession: null },
      ],
      activeKey: "term-1",
    });
    expect(store.getState().activeKey).toBe(store.getState().panes[1]?.key);
  });

  it("does NOT bring back a title the shell set", async () => {
    // `cargo watch` is not running any more. A tab still labelled that is a claim about a process
    // that does not exist.
    const store = await restoreFrom({
      panes: [{ key: "term-0", title: "cargo watch", cwd: null, profileId: null, themeId: null }],
      activeKey: "term-0",
    });
    expect(store.getState().panes[0]?.title).toBe("Terminal");
  });

  it("does NOT bring back an open diff", async () => {
    // A view of a moment that has passed — the file may not even have those lines any more.
    const store = await restoreFrom({
      panes: [
        {
          key: "term-0",
          cwd: null,
          profileId: null,
          themeId: null,
          detail: { kind: "file", path: "a.ts", staged: false },
        },
      ],
      activeKey: "term-0",
    });
    expect(store.getState().panes[0]?.detail).toBeNull();
  });

  it("does NOT bring back a tab's detached state — its profile decides again", async () => {
    const store = await restoreFrom({
      panes: [
        { key: "term-0", cwd: null, profileId: null, themeId: null, plain: true, generation: 4 },
      ],
      activeKey: "term-0",
    });
    expect(store.getState().panes[0]?.plain).toBe(false);
    expect(store.getState().panes[0]?.generation).toBe(0);
  });

  it("counts restored tabs as the bootstrap, so none is opened on top of them", async () => {
    const store = await restoreFrom({
      panes: [{ key: "term-0", cwd: null, profileId: null, themeId: null }],
      activeKey: "term-0",
    });
    store.getState().bootstrap();
    expect(store.getState().panes).toHaveLength(1);
  });

  it("still opens one terminal when there is nothing to restore", async () => {
    const store = await restoreFrom({ panes: [], activeKey: null });
    store.getState().bootstrap();
    expect(store.getState().panes).toHaveLength(1);
  });

  it("renumbers keys, so a restored tab and a new one are never the same tab", async () => {
    // Keys come from a counter that restarts at zero. A restored `term-0` colliding with a fresh one
    // would confuse the map that decides which backend session to close.
    const store = await restoreFrom({
      panes: [{ key: "term-7", cwd: null, profileId: null, themeId: null }],
      activeKey: "term-7",
    });
    const restored = store.getState().panes[0]?.key;
    const fresh = store.getState().openPane();
    expect(fresh).not.toBe(restored);
    expect(new Set(store.getState().panes.map((p) => p.key)).size).toBe(2);
  });

  it("survives a payload that has been tampered with", async () => {
    // localStorage is an ordinary file a user (or anything else) can edit.
    const store = await restoreFrom({
      panes: [
        { key: "term-0", cwd: 42, profileId: [], themeId: {}, tmuxSession: 7 },
        { nonsense: true },
        null,
      ],
      activeKey: "term-9",
    });
    const panes = store.getState().panes;
    expect(panes).toHaveLength(1);
    expect(panes[0]).toMatchObject({
      cwd: null,
      profileId: null,
      themeId: null,
      tmuxSession: null,
    });
    expect(store.getState().activeKey).toBe(panes[0]?.key);
  });

  it("starts empty when there is no stored payload at all", async () => {
    const mod = await import(`./terminal?fresh=${Math.random().toString(36).slice(2)}`);
    expect(mod.useTerminalStore.getState().panes).toEqual([]);
  });

  describe("what gets written", () => {
    it("stores a tab's place, and nothing that describes a live process", async () => {
      const mod = await import(`./terminal?write=${Math.random().toString(36).slice(2)}`);
      const store = mod.useTerminalStore as typeof import("./terminal").useTerminalStore;

      const key = store.getState().openPane("work");
      store.getState().setCwd(key, "/repo");
      store.getState().setPaneTheme(key, "nord");
      store.getState().setPaneTmuxSession(key, "yggshell");
      // The three that must never come back.
      store.getState().setTitle(key, "cargo watch");
      store.getState().setPaneDetail(key, { kind: "file", path: "a.ts", staged: false });
      store.getState().detachToShell(key);

      const written = JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
        state?: { panes?: Record<string, unknown>[] };
      };
      const pane = written.state?.panes?.[0];

      expect(pane).toMatchObject({
        cwd: "/repo",
        profileId: "work",
        themeId: "nord",
        tmuxSession: "yggshell",
      });
      expect(pane).not.toHaveProperty("title");
      expect(pane).not.toHaveProperty("detail");
      expect(pane).not.toHaveProperty("plain");
      expect(pane).not.toHaveProperty("generation");
    });
  });
});
