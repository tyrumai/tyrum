import { describe, expect, it, vi } from "vitest";
import type { ElevatedModeStore, OperatorAuthStrategy, OperatorCore } from "@tyrum/operator-app";
import {
  createBearerTokenAuth,
  createElevatedModeStore,
  createOperatorCoreManager,
} from "../../../packages/operator-app/src/index.js";

function createFakeCore(elevatedModeStore: ElevatedModeStore): OperatorCore {
  return {
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    ws: { connected: true } as unknown as OperatorCore["ws"],
    http: {} as unknown as OperatorCore["admin"],
    elevatedModeStore,
    connectionStore: {
      getSnapshot() {
        return {
          status: "connected",
        } as OperatorCore["connectionStore"]["getSnapshot"] extends () => infer T ? T : never;
      },
      subscribe() {
        return () => {};
      },
    } as unknown as OperatorCore["connectionStore"],
    approvalsStore: {} as unknown as OperatorCore["approvalsStore"],
    turnsStore: {} as unknown as OperatorCore["turnsStore"],
    pairingStore: {} as unknown as OperatorCore["pairingStore"],
    statusStore: {} as unknown as OperatorCore["statusStore"],
    connect: vi.fn(() => {}),
    disconnect: vi.fn(() => {}),
    dispose: vi.fn(() => {}),
  };
}

describe("apps/web operator-core-manager", () => {
  it("keeps the baseline auth even when admin access toggles", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline-token");

    const created: Array<{ auth: OperatorAuthStrategy; core: OperatorCore }> = [];
    const createCore = vi.fn(
      (options: {
        wsUrl: string;
        httpBaseUrl: string;
        auth: OperatorAuthStrategy;
        elevatedModeStore: ElevatedModeStore;
      }): OperatorCore => {
        const core = createFakeCore(options.elevatedModeStore);
        created.push({ auth: options.auth, core });
        return core;
      },
    );

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      baselineAuth,
      elevatedModeStore,
      createCore,
    });

    elevatedModeStore.enter({
      elevatedToken: "elevated-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    elevatedModeStore.exit();

    expect(createCore).toHaveBeenCalledTimes(1);
    expect(created[0]?.auth).toMatchObject({ type: "bearer-token", token: "baseline-token" });
    expect(manager.getCore()).toBe(created[0]?.core);

    manager.dispose();
    elevatedModeStore.dispose();
  });
});
