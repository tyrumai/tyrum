import { describe, expect, it, vi } from "vitest";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createElevatedModeStore,
  createOperatorCoreManager,
  type OperatorAuthStrategy,
} from "../src/index.js";

function createFakeCore(status: "connected" | "disconnected" = "disconnected") {
  return {
    connect: vi.fn(() => {}),
    connectionStore: {
      getSnapshot: () => ({ status }),
    },
    dispose: vi.fn(() => {}),
  };
}

describe("createOperatorCoreManager", () => {
  it("creates the core once with the baseline bearer auth", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");
    const fakeCore = createFakeCore();
    const createCore = vi.fn(() => fakeCore as never);

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      elevatedModeStore,
      createCore: createCore as never,
    });

    expect(createCore).toHaveBeenCalledTimes(1);
    expect(createCore).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: baselineAuth,
        elevatedModeStore,
      }),
    );
    expect(manager.getCore()).toBe(fakeCore);

    manager.dispose();
    elevatedModeStore.dispose();
  });

  it("keeps the same core instance when elevated mode enters or exits", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");
    const baselineCore = createFakeCore("connected");
    const createCore = vi.fn().mockReturnValue(baselineCore as never);

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      elevatedModeStore,
      createCore: createCore as never,
    });

    const listener = vi.fn(() => {});
    const unsubscribe = manager.subscribe(listener);

    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(createCore).toHaveBeenCalledTimes(1);
    expect(manager.getCore()).toBe(baselineCore);
    expect(baselineCore.dispose).not.toHaveBeenCalled();
    expect(baselineCore.connect).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    elevatedModeStore.exit();

    expect(createCore).toHaveBeenCalledTimes(1);
    expect(manager.getCore()).toBe(baselineCore);
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    manager.dispose();
    expect(baselineCore.dispose).toHaveBeenCalledTimes(1);
    elevatedModeStore.dispose();
  });

  it("keeps browser-cookie baselines on the original auth when admin mode activates", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBrowserCookieAuth({ credentials: "include" });
    const baselineCore = createFakeCore();
    const createCore = vi
      .fn<(input: { auth: OperatorAuthStrategy }) => never>()
      .mockReturnValue(baselineCore as never);

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      elevatedModeStore,
      createCore: createCore as never,
    });

    expect(createCore).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        auth: baselineAuth,
      }),
    );

    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(createCore).toHaveBeenCalledTimes(1);
    expect(manager.getCore()).toBe(baselineCore);

    manager.dispose();
    elevatedModeStore.dispose();
  });
});
