// The test environment itself, pinned (rule:testing — "contracts are pinned on both sides").
//
// Web Storage is the one browser API the runner does NOT reliably provide: Node ships its own
// `localStorage`/`sessionStorage` globals (default-on from Node 26), and Vitest's jsdom environment
// skips any window key that already exists on `globalThis` and is not in its own copy list — so
// jsdom's working Storage is shadowed by Node's, which is unusable without `--localstorage-file`.
// Everything that persists (the UI store's `zustand/persist`) then dies inside a third-party library
// with a message that names neither Node nor jsdom.
//
// These tests exist so that a regression here fails as ITSELF — "the test environment has no working
// localStorage" — instead of as a cryptic error in whichever dependency touched storage first.
// `src/test/setup.ts` is what keeps them green.
import { describe, it, expect, beforeEach } from "vitest";

describe.each([
  ["localStorage", () => localStorage],
  ["sessionStorage", () => sessionStorage],
])("%s", (name, storage) => {
  beforeEach(() => {
    storage().clear();
  });

  it("is defined and reachable both bare and through window", () => {
    expect(storage()).toBeDefined();
    // jsdom under Vitest makes `window` the global object, so these must be the very same store —
    // two different objects would mean a test that writes through one and reads through the other
    // sees nothing.
    expect(window[name as "localStorage" | "sessionStorage"]).toBe(storage());
  });

  it("round-trips a value", () => {
    storage().setItem("key", "value");

    expect(storage().getItem("key")).toBe("value");
  });

  it("returns null for a key it does not have", () => {
    expect(storage().getItem("absent")).toBeNull();
  });

  it("removes a single key without touching the rest", () => {
    storage().setItem("keep", "1");
    storage().setItem("drop", "2");

    storage().removeItem("drop");

    expect(storage().getItem("drop")).toBeNull();
    expect(storage().getItem("keep")).toBe("1");
  });

  it("reports its length, enumerates by index, and clears", () => {
    storage().setItem("a", "1");
    storage().setItem("b", "2");

    expect(storage().length).toBe(2);
    expect([storage().key(0), storage().key(1)]).toEqual(["a", "b"]);
    expect(storage().key(2)).toBeNull();

    storage().clear();

    expect(storage().length).toBe(0);
    expect(storage().getItem("a")).toBeNull();
  });

  it("stores keys and values as strings, as the Web Storage API requires", () => {
    // zustand/persist and friends hand in whatever they were given; the store must not keep a number
    // as a number, or a `JSON.parse` on read explodes on a type that never came out of a real browser.
    storage().setItem(1 as unknown as string, 2 as unknown as string);

    expect(storage().getItem("1")).toBe("2");
  });
});

describe("Web Storage ownership", () => {
  // Without these two, everything above would still pass on a Node that has no Web Storage of its own
  // — jsdom's Storage would carry it — so the setup block could be "tidied away" here and only break
  // the suite for everyone on Node >= 26. The ownership is therefore pinned, not just the behaviour:
  // the runner (Vitest's `populateGlobal`) and Node both install an ACCESSOR, our setup installs a
  // plain value. The property names are spelled out literally rather than looped over, because a
  // computed member access is an object-injection sink and the gate runs at --max-warnings 0.
  const expectOwnedBySetup = (descriptor: PropertyDescriptor | undefined, store: Storage): void => {
    expect(descriptor).toBeDefined();
    expect(descriptor?.get).toBeUndefined();
    expect(descriptor?.value).toBe(store);
  };

  it("localStorage comes from src/test/setup.ts, not from the runner", () => {
    expectOwnedBySetup(Object.getOwnPropertyDescriptor(globalThis, "localStorage"), localStorage);
  });

  it("sessionStorage comes from src/test/setup.ts, not from the runner", () => {
    expectOwnedBySetup(
      Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
      sessionStorage,
    );
  });
});

describe("localStorage and sessionStorage", () => {
  it("are separate stores", () => {
    localStorage.clear();
    sessionStorage.clear();

    localStorage.setItem("only-local", "1");

    expect(sessionStorage.getItem("only-local")).toBeNull();
  });
});
