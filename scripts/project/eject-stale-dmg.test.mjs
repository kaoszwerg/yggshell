import { describe, it, expect } from "vitest";
import { isOurs } from "./eject-stale-dmg.mjs";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

describe("what a build is allowed to eject", () => {
  it("takes an image from this checkout's build output", () => {
    expect(
      isOurs(`${REPO}/src-tauri/target/release/bundle/dmg/YggShell_1.0.0.dmg`, "/Volumes/YggShell"),
    ).toBe(true);
  });

  it("takes the anonymous scratch volume a broken build leaves behind", () => {
    expect(isOurs("/private/tmp/whatever.dmg", "/Volumes/dmg.AbC123")).toBe(true);
  });

  it("leaves a DMG the user mounted from anywhere else alone", () => {
    // Even when it is called YggShell — especially then. It is the one they installed from, and
    // ejecting something out from under someone is the class of mistake rule:live-app prevents.
    expect(isOurs("/Users/steve/Downloads/YggShell_0.24.0_aarch64.dmg", "/Volumes/YggShell")).toBe(
      false,
    );
  });

  it("is not fooled by a volume that merely starts like the scratch one", () => {
    expect(isOurs("/elsewhere/x.dmg", "/Volumes/dmg.Ab")).toBe(false);
    expect(isOurs("/elsewhere/x.dmg", "/Volumes/dmg.AbC123/nested")).toBe(false);
  });

  it("is not fooled by a path that merely starts with the repo's name", () => {
    expect(isOurs(`${REPO}-other/build.dmg`, "/Volumes/Thing")).toBe(false);
  });
});
