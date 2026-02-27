import { describe, expect, it } from "vitest";

import { getPageIdForDeepLink } from "../src/renderer/deep-links.js";

describe("desktop renderer deep link routing", () => {
  it("routes tyrum:// URLs to a helpful page", () => {
    expect(getPageIdForDeepLink("tyrum://open?x=1")).toBe("connection");
  });

  it("falls back to a helpful page for unknown inputs", () => {
    expect(getPageIdForDeepLink("not-a-url")).toBe("connection");
  });
});

