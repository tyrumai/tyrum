import { describe, expect, it } from "vitest";

describe("@tyrum/client entrypoints", () => {
  it("keeps browser-only storage helpers off the node entrypoint", async () => {
    const browserEntry = (await import("../src/browser.js")) as Record<string, unknown>;
    const nodeEntry = (await import("../src/node.js")) as Record<string, unknown>;

    expect(typeof browserEntry["createBrowserLocalStorageDeviceIdentityStorage"]).toBe("function");
    expect("createBrowserLocalStorageDeviceIdentityStorage" in nodeEntry).toBe(false);
  });
});
