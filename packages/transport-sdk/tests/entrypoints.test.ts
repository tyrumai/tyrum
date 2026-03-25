import { describe, expect, it } from "vitest";

describe("@tyrum/transport-sdk entrypoints", () => {
  it("owns the transport entrypoints without node lifecycle helpers", async () => {
    const browserEntry = (await import("../src/browser.js")) as Record<string, unknown>;
    const nodeEntry = (await import("../src/node.js")) as Record<string, unknown>;
    const rootEntry = (await import("../src/index.js")) as Record<string, unknown>;

    expect(typeof rootEntry["TyrumClient"]).toBe("function");
    expect(typeof rootEntry["createTyrumHttpClient"]).toBe("function");
    expect(typeof rootEntry["createTyrumAiSdkChatConversationClient"]).toBe("function");
    expect("createTyrumAiSdkChatSessionClient" in rootEntry).toBe(false);
    expect(typeof browserEntry["TyrumClient"]).toBe("function");
    expect(typeof browserEntry["createTyrumAiSdkChatConversationClient"]).toBe("function");
    expect("createTyrumAiSdkChatSessionClient" in browserEntry).toBe(false);
    expect(typeof nodeEntry["TyrumClient"]).toBe("function");
    expect(typeof nodeEntry["createTyrumAiSdkChatConversationClient"]).toBe("function");
    expect("createTyrumAiSdkChatSessionClient" in nodeEntry).toBe(false);
    expect(typeof browserEntry["createBrowserLocalStorageDeviceIdentityStorage"]).toBe("function");
    expect(typeof nodeEntry["createNodeFileDeviceIdentityStorage"]).toBe("function");
    expect("createManagedNodeClientLifecycle" in rootEntry).toBe(false);
    expect("createManagedNodeClientLifecycle" in browserEntry).toBe(false);
    expect("createManagedNodeClientLifecycle" in nodeEntry).toBe(false);
  });

  it("re-exports the shared transport SDK version across public entrypoints", async () => {
    const rootEntry = (await import("../src/index.js")) as Record<string, unknown>;
    const browserEntry = (await import("../src/browser.js")) as Record<string, unknown>;
    const nodeEntry = (await import("../src/node.js")) as Record<string, unknown>;

    expect(rootEntry["VERSION"]).toBeTypeOf("string");
    expect(browserEntry["VERSION"]).toBe(rootEntry["VERSION"]);
    expect(nodeEntry["VERSION"]).toBe(rootEntry["VERSION"]);
  });
});
