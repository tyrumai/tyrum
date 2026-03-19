import { describe, expect, it } from "vitest";

describe("@tyrum/node-sdk entrypoints", () => {
  it("exposes managed node lifecycle and capability helpers across public entrypoints", async () => {
    const rootEntry = (await import("../src/index.js")) as Record<string, unknown>;
    const browserEntry = (await import("../src/browser.js")) as Record<string, unknown>;
    const nodeEntry = (await import("../src/node.js")) as Record<string, unknown>;

    expect(typeof rootEntry["autoExecute"]).toBe("function");
    expect(typeof rootEntry["createManagedNodeClientLifecycle"]).toBe("function");
    expect(typeof rootEntry["loadOrCreateDeviceIdentity"]).toBe("function");
    expect(typeof browserEntry["createManagedNodeClientLifecycle"]).toBe("function");
    expect(typeof browserEntry["createBrowserLocalStorageDeviceIdentityStorage"]).toBe("function");
    expect(typeof browserEntry["TyrumClient"]).toBe("function");
    expect(typeof nodeEntry["createManagedNodeClientLifecycle"]).toBe("function");
    expect(typeof nodeEntry["createNodeFileDeviceIdentityStorage"]).toBe("function");
    expect(typeof nodeEntry["TyrumClient"]).toBe("function");
  });

  it("re-exports the shared node SDK version across public entrypoints", async () => {
    const rootEntry = (await import("../src/index.js")) as Record<string, unknown>;
    const browserEntry = (await import("../src/browser.js")) as Record<string, unknown>;
    const nodeEntry = (await import("../src/node.js")) as Record<string, unknown>;

    expect(rootEntry["VERSION"]).toBeTypeOf("string");
    expect(browserEntry["VERSION"]).toBe(rootEntry["VERSION"]);
    expect(nodeEntry["VERSION"]).toBe(rootEntry["VERSION"]);
  });
});
