import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delay, startGateway, withTimeout } from "../../transport-sdk/tests/conformance/harness.js";
import { createTuiCore } from "../src/core.js";
import { ElevatedModeRequiredError, isElevatedModeActive } from "@tyrum/operator-app";
import {
  createNodeFileDeviceIdentityStorage,
  createTyrumHttpClient,
  loadOrCreateDeviceIdentity,
} from "@tyrum/transport-sdk/node";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../gateway/src/modules/identity/scope.js";

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

      expect(runtime.manager.getCore()).toBe(baselineCore);
      expect(baselineCore.connectionStore.getSnapshot().status).toBe("connected");
      await withTimeout(waitForStatusSettled(baselineCore.statusStore), 2_000, "tui status sync");

      const entered = runtime.manager.getCore().elevatedModeStore.getSnapshot();
      expect(isElevatedModeActive(entered)).toBe(true);
      expect(entered.elevatedToken).toBeTruthy();
      expect(entered.expiresAt).toBeTruthy();
      expect(entered.remainingMs).not.toBeNull();

      const statusErrors = baselineCore.statusStore.getSnapshot().error;
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

  it("resolves approvals through the privileged token without swapping the core", async () => {
    const harness = await startGateway();
    const home = await mkdtemp(join(tmpdir(), "tyrum-tui-"));
    const identityPath = join(home, "tui", "device-identity.json");
    let runtime: Awaited<ReturnType<typeof createTuiCore>> | null = null;

    try {
      const identity = await loadOrCreateDeviceIdentity(
        createNodeFileDeviceIdentityStorage(identityPath),
      );

      const http = createTyrumHttpClient({
        baseUrl: harness.baseUrl,
        auth: { type: "bearer", token: harness.adminToken },
      });

      const baseline = await http.deviceTokens.issue({
        device_id: identity.deviceId,
        role: "client",
        scopes: ["operator.read"],
        ttl_seconds: 60 * 10,
      });

      runtime = await createTuiCore({
        wsUrl: harness.wsUrl,
        httpBaseUrl: harness.baseUrl,
        token: baseline.token,
        deviceIdentityPath: identityPath,
        reconnect: false,
      });

      const baselineCore = runtime.manager.getCore();
      baselineCore.connect();
      await withTimeout(
        waitForConnectionStatus(baselineCore.connectionStore, "connected"),
        2_000,
        "tui elevated mode baseline connect (scoped token)",
      );

      const approval = await harness.protocolDeps.approvalDal!.create({
        tenantId: harness.tenantId,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        approvalKey: "tui-admin-mode-approval",
        prompt: "Approve the TUI action?",
      });

      await baselineCore.approvalsStore.refreshPending();
      expect(baselineCore.approvalsStore.getSnapshot().pendingIds).toContain(approval.approval_id);

      await expect(
        baselineCore.approvalsStore.resolve({
          approvalId: approval.approval_id,
          decision: "approved",
        }),
      ).rejects.toThrow(ElevatedModeRequiredError);

      await runtime.enterElevatedMode(harness.adminToken, { ttlSeconds: 60 });
      expect(runtime.manager.getCore()).toBe(baselineCore);
      expect(baselineCore.connectionStore.getSnapshot().status).toBe("connected");

      await expect(
        baselineCore.approvalsStore.resolve({
          approvalId: approval.approval_id,
          decision: "approved",
          reason: "looks safe",
        }),
      ).resolves.toMatchObject({
        approval: {
          approval_id: approval.approval_id,
          status: "approved",
        },
      });
    } finally {
      await Promise.allSettled([
        harness.stop(),
        runtime?.dispose(),
        rm(home, { recursive: true, force: true }),
      ]);
    }
  }, 20_000);
});
