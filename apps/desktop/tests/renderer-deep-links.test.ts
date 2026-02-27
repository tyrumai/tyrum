import { describe, expect, it } from "vitest";

import { getDeepLinkRoute, getPageIdForDeepLink } from "../src/renderer/deep-links.js";

describe("desktop renderer deep link routing", () => {
  it("routes tyrum:// URLs to a helpful page", () => {
    expect(getPageIdForDeepLink("tyrum://open?x=1")).toBe("connection");
  });

  it("routes work item deep links to the WorkBoard page", () => {
    expect(getPageIdForDeepLink("tyrum://work?work_item_id=w-1")).toBe("work");
  });

  it("extracts the work item id from work item deep links", () => {
    expect(getDeepLinkRoute("tyrum://work?work_item_id=w-1")).toEqual({
      pageId: "work",
      workItemId: "w-1",
    });
  });

  it("supports tyrum:work deep links without //", () => {
    expect(getDeepLinkRoute("tyrum:work?work_item_id=w-1")).toEqual({
      pageId: "work",
      workItemId: "w-1",
    });
  });

  it("falls back to a helpful page for unknown inputs", () => {
    expect(getPageIdForDeepLink("not-a-url")).toBe("connection");
  });
});
