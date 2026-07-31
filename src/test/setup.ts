// Vitest global setup: extends `expect` with jest-dom matchers and cleans up after each test.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// Web Storage, installed by us rather than by the runner — the environment is pinned by
// src/test/environment.test.ts.
//
// WHY (verified, not assumed — Node 22.22.2 + `--experimental-webstorage` reproduces it exactly):
// Node ships its own `localStorage`/`sessionStorage` globals, default-on from Node 26 (enabled in
// 25.0, reverted in 25.2.1, landed in 26.0). Vitest's jsdom environment copies window properties onto
// `globalThis`, but skips every key that ALREADY exists there and is not in its own fixed copy list
// (`getWindowKeys`) — and `localStorage` is not in that list. Node's global therefore survives and
// shadows jsdom's working Storage. Reading it then throws (Node <= 25) or yields `undefined`
// (Node >= 26, nodejs/node@fa70327) unless the process was started with `--localstorage-file`, so
// anything that persists — `zustand/persist` in src/store/ui.ts — dies inside the library.
//
// The fix is deliberately UNCONDITIONAL: whether the runner's storage works depends on the Node
// version, and that version-dependence IS the defect — a suite must not pass here and fail on the
// next machine. Probing the existing value first is not an option either, since the probe itself is
// what throws. `--no-webstorage` would fix the cause, but it does not exist before Node 25, and this
// project's engines allow node >= 20.19: passing it there kills every worker.
if (typeof document !== "undefined") {
  // Guarded on the DOM: the governance script tests opt into the `node` environment per file
  // (`// @vitest-environment node`), where a browser global has no business existing.
  for (const name of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, name, {
      value: createMemoryStorage(),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

/**
 * A Web Storage store held in memory — one per test file, since setup files run per file.
 *
 * Faithful to the API the app actually uses: string coercion of keys and values, `null` for a missing
 * key, insertion-ordered `key(index)`. Not faithful to quotas or `storage` events, which no test
 * asserts on and which never fire for same-window writes anyway.
 */
function createMemoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length(): number {
      return items.size;
    },
    clear(): void {
      items.clear();
    },
    getItem(key: string): string | null {
      return items.get(String(key)) ?? null;
    },
    key(index: number): string | null {
      // Walked rather than indexed: a computed index into an array is an object-injection sink that
      // `eslint-plugin-security` rejects, and the gate runs at --max-warnings 0. Suppressing the rule
      // to keep a one-liner would be exactly the "silence the finding" move rule:security forbids —
      // and the walk is the cheaper of the two anyway, since it copies no keys.
      if (index < 0) return null;
      let i = 0;
      for (const key of items.keys()) {
        if (i++ === index) return key;
      }
      return null;
    },
    removeItem(key: string): void {
      items.delete(String(key));
    },
    setItem(key: string, value: string): void {
      items.set(String(key), String(value));
    },
  };
}

// jsdom doesn't ship ResizeObserver. Any component that observes element size would crash without
// a stub. The bodies stay empty — jsdom has no real layout to observe and no test asserts on
// resize semantics.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  // Cast: the test stub doesn't implement the full ResizeObserver type (callback, options),
  // and we don't need it to — nothing under test reads those.
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
