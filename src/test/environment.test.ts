// Pins the DOM environment the component tests rely on. Without this, a regression in `setup.ts`
// would only surface as a confusing "Cannot read properties of undefined (reading 'setItem')" deep
// inside a third-party middleware — see the Web Storage note in setup.ts.
import { describe, expect, it } from "vitest";

function expectWorkingStorage(storage: Storage | undefined): void {
  expect(storage).toBeDefined();

  const store = storage as Storage;
  store.setItem("probe", "value");
  expect(store.getItem("probe")).toBe("value");
  store.removeItem("probe");
  expect(store.getItem("probe")).toBeNull();
}

describe("test environment", () => {
  it("exposes a working localStorage", () => {
    expectWorkingStorage(globalThis.localStorage);
  });

  it("exposes a working sessionStorage", () => {
    expectWorkingStorage(globalThis.sessionStorage);
  });
});
