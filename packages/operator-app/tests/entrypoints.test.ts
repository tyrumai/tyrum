import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("@tyrum/operator-app entrypoints", () => {
  it("keeps operator-facing transport helpers on the intended public surface", async () => {
    const browserEntry = (await import("../src/browser.js")) as Record<string, unknown>;
    const nodeEntry = (await import("../src/node.js")) as Record<string, unknown>;

    expect(typeof browserEntry["createOperatorHttpClient"]).toBe("function");
    expect(typeof browserEntry["createTyrumHttpClient"]).toBe("function");
    expect(typeof browserEntry["TyrumClient"]).toBe("function");
    expect(typeof browserEntry["createBrowserLocalStorageDeviceIdentityStorage"]).toBe("function");
    expect(typeof browserEntry["TyrumHttpClientError"]).toBe("function");
    expect(typeof browserEntry["formatDeviceIdentityError"]).toBe("function");

    expect(typeof nodeEntry["TyrumClient"]).toBe("function");
    expect(typeof nodeEntry["createNodeFileDeviceIdentityStorage"]).toBe("function");

    for (const unexpected of [
      "VERSION",
      "autoExecute",
      "DeviceIdentityError",
      "buildConnectProofTranscript",
      "createManagedNodeClientLifecycle",
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

  it("avoids wildcard forwarding from transport or node helper entrypoints", async () => {
    const [browserSource, nodeSource] = await Promise.all([
      readFile(resolve(__dirname, "../src/browser.ts"), "utf8"),
      readFile(resolve(__dirname, "../src/node.ts"), "utf8"),
    ]);

    expect(browserSource).not.toContain("@tyrum/node-sdk/browser");
    expect(nodeSource).not.toContain("@tyrum/node-sdk/node");
    expect(browserSource).not.toContain("@tyrum/client");
    expect(nodeSource).not.toContain("@tyrum/client");
  });
});
