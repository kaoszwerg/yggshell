import { describe, expect, it } from "vitest";
import { toDataUrl } from "./dataUrl";

describe("toDataUrl", () => {
  it("carries the type the caller was given", () => {
    // The type comes from the backend's sniff, never from a file name — so it has to survive intact
    // rather than being normalised to something friendlier here.
    expect(toDataUrl([71, 73, 70, 56, 57, 97], "image/gif")).toBe("data:image/gif;base64,R0lGODlh");
    expect(toDataUrl([1], "image/*")).toMatch(/^data:image\/\*;base64,/);
  });

  it("takes bytes as an array or as a view, because both arrive", () => {
    // IPC hands over a plain array; a caller that already has a `Uint8Array` should not have to
    // convert it back and forth to use this.
    const bytes = [104, 105];
    expect(toDataUrl(bytes, "text/plain")).toBe(toDataUrl(Uint8Array.from(bytes), "text/plain"));
  });

  it("survives a picture far larger than the argument limit", () => {
    // **The reason this is chunked at all.** `String.fromCharCode(...bytes)` spreads every byte as an
    // argument, and a multi-megabyte image is millions of them — which is a stack overflow, not a
    // slow path. 200k bytes is well past any engine's limit and well under a real picture.
    const big = new Uint8Array(200_000).fill(65);

    const url = toDataUrl(big, "image/png");

    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    // Base64 is 4 characters per 3 bytes, so the payload length is the arithmetic — a truncated
    // conversion would still start correctly and be silently short.
    expect(url.length - "data:image/png;base64,".length).toBe(Math.ceil(200_000 / 3) * 4);
  });

  it("makes an empty file an empty payload rather than a failure", () => {
    expect(toDataUrl([], "application/octet-stream")).toBe("data:application/octet-stream;base64,");
  });
});
