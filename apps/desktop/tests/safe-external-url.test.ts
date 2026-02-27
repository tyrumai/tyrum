import { describe, expect, it } from "vitest";
import { isSafeExternalUrl } from "../src/main/safe-external-url.js";

describe("isSafeExternalUrl", () => {
  it("accepts http(s) URLs and rejects other/invalid protocols", () => {
    expect(isSafeExternalUrl("https://example.com")).toBe(true);
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
    expect(isSafeExternalUrl("file:///tmp/readme.txt")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
});
