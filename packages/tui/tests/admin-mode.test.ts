import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delay, startGateway, withTimeout } from "../../client/tests/conformance/harness.js";
import { createTuiCore } from "../src/core.js";
import { isElevatedModeActive } from "@tyrum/operator-core";

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

async function waitForCoreSwap(
  input: { getCore: () => unknown },
  previous: unknown,
): Promise<void> {
  while (input.getCore() === previous) {
    await delay(10);
  }
}

async function waitForStatusSettled(store: {
  getSnapshot: () => { loading: { status: boolean; presence: boolean; usage: boolean } };
}): Promise<void> {
  while (true) {
    const loading = store.getSnapshot().loading;
    if (!loading.status && !loading.presence && !loading.usage) return;
    await delay(10);
  }
}

describe("tui elevated mode", () => {
  it("mints an elevated device token and toggles elevated mode state", async () => {
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

      expect(isElevatedModeActive(runtime.manager.getCore().elevatedModeStore.getSnapshot())).toBe(
        false,
      );

      const baselineCore = runtime.manager.getCore();
      baselineCore.connect();
      await withTimeout(
        waitForConnectionStatus(baselineCore.connectionStore, "connected"),
        2_000,
        "tui elevated mode baseline connect",
      );

      await runtime.enterElevatedMode(harness.adminToken, { ttlSeconds: 60 });

      await withTimeout(
        waitForCoreSwap(runtime.manager, baselineCore),
        2_000,
        "tui elevated mode core swap",
      );

      const elevatedCore = runtime.manager.getCore();
      await withTimeout(
        waitForConnectionStatus(elevatedCore.connectionStore, "connected"),
        2_000,
        "tui elevated mode elevated connect",
      );
      await withTimeout(
        waitForStatusSettled(elevatedCore.statusStore),
        2_000,
        "tui elevated mode status sync",
      );

      const entered = runtime.manager.getCore().elevatedModeStore.getSnapshot();
      expect(isElevatedModeActive(entered)).toBe(true);
      expect(entered.elevatedToken).toBeTruthy();
      expect(entered.expiresAt).toBeTruthy();
      expect(entered.remainingMs).not.toBeNull();

      const statusErrors = elevatedCore.statusStore.getSnapshot().error;
      expect(statusErrors.status).toBeNull();
      expect(statusErrors.usage).toBeNull();
      expect(
        statusErrors.presence === null ||
          /unexpected error/i.test(statusErrors.presence.toLowerCase()),
      ).toBe(true);

      runtime.exitElevatedMode();

      expect(isElevatedModeActive(runtime.manager.getCore().elevatedModeStore.getSnapshot())).toBe(
        false,
      );
    } finally {
      await Promise.allSettled([
        harness.stop(),
        runtime?.dispose(),
        rm(home, { recursive: true, force: true }),
      ]);
    }
  });
});
