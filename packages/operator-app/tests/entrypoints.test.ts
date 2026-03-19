import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("@tyrum/operator-app entrypoints", () => {
  it("keeps browser and node helper entrypoints on the intended public surface", async () => {
    const browserEntry = (await import("../src/browser.js")) as Record<string, unknown>;
    const nodeEntry = (await import("../src/node.js")) as Record<string, unknown>;

    expect(typeof browserEntry["autoExecute"]).toBe("function");
    expect(typeof browserEntry["createOperatorHttpClient"]).toBe("function");
    expect(typeof browserEntry["createManagedNodeClientLifecycle"]).toBe("function");
    expect(typeof browserEntry["TyrumClient"]).toBe("function");
    expect(typeof browserEntry["createBrowserLocalStorageDeviceIdentityStorage"]).toBe("function");
    expect(typeof browserEntry["TyrumHttpClientError"]).toBe("function");
    expect(typeof browserEntry["formatDeviceIdentityError"]).toBe("function");

    expect(typeof nodeEntry["autoExecute"]).toBe("function");
    expect(typeof nodeEntry["createManagedNodeClientLifecycle"]).toBe("function");
    expect(typeof nodeEntry["TyrumClient"]).toBe("function");
    expect(typeof nodeEntry["createNodeFileDeviceIdentityStorage"]).toBe("function");

    for (const unexpected of [
      "VERSION",
      "DeviceIdentityError",
      "buildConnectProofTranscript",
      "computeDeviceIdFromPublicKeyDer",
      "parseStoredDeviceIdentity",
      "signProofWithPrivateKey",
    ]) {
      expect(unexpected in browserEntry).toBe(false);
      expect(unexpected in nodeEntry).toBe(false);
    }

    expect("TyrumHttpClientError" in nodeEntry).toBe(false);
    expect("formatDeviceIdentityError" in nodeEntry).toBe(false);
  });

  it("avoids wildcard forwarding from the node sdk helper entrypoints", async () => {
    const [browserSource, nodeSource] = await Promise.all([
      readFile(resolve(__dirname, "../src/browser.ts"), "utf8"),
      readFile(resolve(__dirname, "../src/node.ts"), "utf8"),
    ]);

    expect(browserSource).not.toContain('export * from "@tyrum/node-sdk/browser";');
    expect(nodeSource).not.toContain('export * from "@tyrum/node-sdk/node";');
    expect(nodeSource).not.toContain('export type * from "@tyrum/node-sdk/node";');
  });
});
