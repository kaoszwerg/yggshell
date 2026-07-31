// Vitest global setup: extends `expect` with jest-dom matchers and cleans up after each test.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// Node >= 26 defines its OWN `localStorage`/`sessionStorage` on globalThis — unavailable unless the
// process was started with `--localstorage-file`. It is a *non-enumerable* own property, and vitest's
// jsdom environment copies only the *enumerable* window keys onto globalThis (aliasing `window` to
// globalThis itself). Node's property therefore survives and shadows jsdom's working Storage: every
// read yields `undefined`, and anything built on Web Storage — zustand's `persist` middleware, for one —
// fails with "Cannot read properties of undefined (reading 'setItem')".
// Re-point both globals at the jsdom window's real Storage objects. Guarded, because the governance
// script tests run in the node environment, where there is no jsdom window and no DOM to restore.
function restoreStorage(
  name: "localStorage" | "sessionStorage",
  current: Storage | undefined,
  real: Storage | undefined,
): void {
  if (current !== undefined || real === undefined) return;
  Object.defineProperty(globalThis, name, { value: real, configurable: true, writable: true });
}

const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow) {
  restoreStorage("localStorage", globalThis.localStorage, jsdomWindow.localStorage);
  restoreStorage("sessionStorage", globalThis.sessionStorage, jsdomWindow.sessionStorage);
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
