import { describe, expect, it, vi } from "vitest";
import type { AdminModeStore, OperatorAuthStrategy, OperatorCore } from "@tyrum/operator-core";
import {
  createAdminModeStore,
  createBearerTokenAuth,
} from "../../../packages/operator-core/src/index.js";
import { createWebOperatorCoreManager } from "../src/operator-core-manager.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

function createFakeCore(options: {
  status: ConnectionStatus;
  adminModeStore: AdminModeStore;
}): OperatorCore {
  return {
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    ws: { connected: options.status === "connected" } as unknown as OperatorCore["ws"],
    http: {} as unknown as OperatorCore["http"],
    adminModeStore: options.adminModeStore,
    connectionStore: {
      getSnapshot() {
        return {
          status: options.status,
        } as OperatorCore["connectionStore"]["getSnapshot"] extends () => infer T ? T : never;
      },
      subscribe() {
        return () => {};
      },
    } as unknown as OperatorCore["connectionStore"],
    approvalsStore: {} as unknown as OperatorCore["approvalsStore"],
    runsStore: {} as unknown as OperatorCore["runsStore"],
    pairingStore: {} as unknown as OperatorCore["pairingStore"],
    statusStore: {} as unknown as OperatorCore["statusStore"],
    connect: vi.fn(() => {}),
    disconnect: vi.fn(() => {}),
    dispose: vi.fn(() => {}),
  };
}

describe("apps/web operator-core-manager", () => {
  it("switches auth and reconnects when Admin Mode toggles while connected", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));

    let adminModeStore: AdminModeStore | null = null;
    let manager: ReturnType<typeof createWebOperatorCoreManager> | null = null;
    try {
      adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
      const store = adminModeStore;
      const baselineAuth = createBearerTokenAuth("baseline-token");

      const created: Array<{ auth: OperatorAuthStrategy; core: OperatorCore }> = [];
      const statuses: ConnectionStatus[] = ["connected", "connected", "disconnected"];

      const createCore = vi.fn(
        (options: {
          wsUrl: string;
          httpBaseUrl: string;
          auth: OperatorAuthStrategy;
          adminModeStore: AdminModeStore;
        }): OperatorCore => {
          const status = statuses[created.length] ?? "disconnected";
          const core = createFakeCore({ status, adminModeStore: options.adminModeStore });
          created.push({ auth: options.auth, core });
          return core;
        },
      );

      manager = createWebOperatorCoreManager({
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test",
        baselineAuth,
        adminModeStore: store,
        createCore,
      });

      expect(createCore).toHaveBeenCalledTimes(1);
      expect(created[0]?.auth).toMatchObject({ type: "bearer-token", token: "baseline-token" });

      store.enter({
        elevatedToken: "elevated-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      expect(createCore).toHaveBeenCalledTimes(2);
      expect(created[1]?.auth).toMatchObject({ type: "bearer-token", token: "elevated-token" });
      expect(created[0]?.core.dispose).toHaveBeenCalledTimes(1);
      expect(created[1]?.core.connect).toHaveBeenCalledTimes(1);

      store.exit();

      expect(createCore).toHaveBeenCalledTimes(3);
      expect(created[2]?.auth).toMatchObject({ type: "bearer-token", token: "baseline-token" });
      expect(created[1]?.core.dispose).toHaveBeenCalledTimes(1);
      expect(created[2]?.core.connect).toHaveBeenCalledTimes(1);
    } finally {
      manager?.dispose();
      adminModeStore?.dispose();
      vi.useRealTimers();
    }
  });

  it("does not recreate the core when the elevated token is unchanged", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));

    let adminModeStore: AdminModeStore | null = null;
    let manager: ReturnType<typeof createWebOperatorCoreManager> | null = null;
    try {
      adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
      const store = adminModeStore;
      const baselineAuth = createBearerTokenAuth("baseline-token");

      const createCore = vi.fn(
        (options: {
          wsUrl: string;
          httpBaseUrl: string;
          auth: OperatorAuthStrategy;
          adminModeStore: AdminModeStore;
        }): OperatorCore =>
          createFakeCore({ status: "disconnected", adminModeStore: options.adminModeStore }),
      );

      manager = createWebOperatorCoreManager({
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test",
        baselineAuth,
        adminModeStore: store,
        createCore,
      });

      expect(createCore).toHaveBeenCalledTimes(1);

      store.enter({
        elevatedToken: "elevated-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(createCore).toHaveBeenCalledTimes(2);

      store.enter({
        elevatedToken: "elevated-token",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      });
      expect(createCore).toHaveBeenCalledTimes(2);
    } finally {
      manager?.dispose();
      adminModeStore?.dispose();
      vi.useRealTimers();
    }
  });
});
