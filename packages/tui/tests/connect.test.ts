import { describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delay, startGateway, withTimeout } from "../../client/tests/conformance/harness.js";
import { createTuiCore } from "../src/core.js";

function waitForConnectionStatus(
  store: {
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => { status: string };
  },
  expected: string,
): Promise<void> {
  if (store.getSnapshot().status === expected) return Promise.resolve();

  return new Promise((resolve) => {
    const unsub = store.subscribe(() => {
      if (store.getSnapshot().status === expected) {
        unsub();
        resolve();
      }
    });
  });
}

async function waitForGatewayClientCount(
  harness: { connectionManager: { getStats: () => { totalClients: number } } },
  expected: number,
): Promise<void> {
  while (harness.connectionManager.getStats().totalClients !== expected) {
    await delay(10);
  }
}

describe("tui core", () => {
  it("connects to a gateway and reaches connected state", async () => {
    const harness = await startGateway();
    const home = await mkdtemp(join(tmpdir(), "tyrum-tui-"));
    const identityPath = join(home, "tui", "device-identity.json");
    let runtime: Awaited<ReturnType<typeof createTuiCore>> | null = null;

    try {
      runtime = await createTuiCore({
        wsUrl: harness.wsUrl,
        httpBaseUrl: harness.baseUrl,
        token: harness.adminToken,
        deviceIdentityPath: identityPath,
        reconnect: false,
      });

      const core = runtime.manager.getCore();
      core.connect();

      await withTimeout(
        waitForConnectionStatus(core.connectionStore, "connected"),
        2_000,
        "tui connect",
      );

      expect(core.connectionStore.getSnapshot().status).toBe("connected");
      await expect(stat(identityPath)).resolves.toBeTruthy();
    } finally {
      if (runtime) {
        runtime.dispose();
        try {
          await withTimeout(waitForGatewayClientCount(harness, 0), 5_000, "tui disconnect");
        } catch {
          for (const client of harness.connectionManager.allClients()) {
            try {
              client.ws.terminate();
            } catch {
              // ignore
            }
          }
        }
      }
      await Promise.allSettled([harness.stop(), rm(home, { recursive: true, force: true })]);
    }
  }, 20_000);
});
