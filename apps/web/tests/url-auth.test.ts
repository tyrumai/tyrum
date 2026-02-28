import { describe, expect, it } from "vitest";
import { readAuthTokenFromUrl, stripAuthTokenFromUrl } from "../src/url-auth.js";

describe("apps/web url-auth", () => {
  describe("readAuthTokenFromUrl", () => {
    it("returns the trimmed token from the token query param", () => {
      expect(readAuthTokenFromUrl("https://example.test/ui?token=test")).toBe("test");
      expect(readAuthTokenFromUrl("https://example.test/ui?token=%20test%20")).toBe("test");
    });

    it("returns undefined when token is missing or blank", () => {
      expect(readAuthTokenFromUrl("https://example.test/ui")).toBeUndefined();
      expect(readAuthTokenFromUrl("https://example.test/ui?token=")).toBeUndefined();
      expect(readAuthTokenFromUrl("https://example.test/ui?token=%20%20")).toBeUndefined();
    });

    it("returns undefined for malformed URLs", () => {
      expect(readAuthTokenFromUrl("http://[")).toBeUndefined();
    });
  });

  describe("stripAuthTokenFromUrl", () => {
    it("removes only the token query param while preserving others", () => {
      expect(stripAuthTokenFromUrl("https://example.test/ui?token=test&x=1")).toBe("/ui?x=1");
      expect(stripAuthTokenFromUrl("https://example.test/ui?x=1&token=test#hash")).toBe(
        "/ui?x=1#hash",
      );
    });

    it("removes the entire query string when token is the only param", () => {
      expect(stripAuthTokenFromUrl("https://example.test/ui?token=test")).toBe("/ui");
      expect(stripAuthTokenFromUrl("https://example.test/ui?token=test#hash")).toBe("/ui#hash");
    });

    it("returns the input unchanged for malformed URLs", () => {
      expect(stripAuthTokenFromUrl("http://[")).toBe("http://[");
    });

    it("returns the normalized path when token is not present", () => {
      expect(stripAuthTokenFromUrl("https://example.test/ui?x=1#hash")).toBe("/ui?x=1#hash");
    });
  });
});
