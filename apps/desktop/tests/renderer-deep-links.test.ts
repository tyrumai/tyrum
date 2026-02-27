import { describe, expect, it } from "vitest";

import { getDeepLinkRoute } from "../src/renderer/deep-links.js";

describe("desktop renderer deep link routing", () => {
  it("routes tyrum:// URLs to a helpful page", () => {
    expect(getDeepLinkRoute("tyrum://open?x=1")).toEqual({ pageId: "connection" });
  });

  it("routes work item deep links to the WorkBoard page", () => {
    expect(getDeepLinkRoute("tyrum://work?work_item_id=w-1").pageId).toBe("work");
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
    expect(getDeepLinkRoute("not-a-url")).toEqual({ pageId: "connection" });
  });

  it("does not export getPageIdForDeepLink", async () => {
    const module = await import("../src/renderer/deep-links.js");
    expect("getPageIdForDeepLink" in module).toBe(false);
  });
});
