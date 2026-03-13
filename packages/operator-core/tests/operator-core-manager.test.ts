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

  it("recreates the core when elevated mode enters or exits and reconnects active sessions", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");
    const baselineCore = createFakeCore("connected");
    const elevatedCore = createFakeCore("connected");
    const restoredCore = createFakeCore();
    const createCore = vi
      .fn()
      .mockReturnValueOnce(baselineCore as never)
      .mockReturnValueOnce(elevatedCore as never)
      .mockReturnValueOnce(restoredCore as never);

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

    expect(createCore).toHaveBeenCalledTimes(2);
    expect(createCore).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        auth: createBearerTokenAuth("elevated"),
        elevatedModeStore,
      }),
    );
    expect(manager.getCore()).toBe(elevatedCore);
    expect(baselineCore.dispose).toHaveBeenCalledTimes(1);
    expect(elevatedCore.connect).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);

    elevatedModeStore.exit();

    expect(createCore).toHaveBeenCalledTimes(3);
    expect(createCore).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        auth: baselineAuth,
        elevatedModeStore,
      }),
    );
    expect(manager.getCore()).toBe(restoredCore);
    expect(elevatedCore.dispose).toHaveBeenCalledTimes(1);
    expect(restoredCore.connect).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    manager.dispose();
    expect(restoredCore.dispose).toHaveBeenCalledTimes(1);
    elevatedModeStore.dispose();
  });

  it("switches browser-cookie baselines to the elevated bearer token when admin mode activates", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBrowserCookieAuth({ credentials: "include" });
    const baselineCore = createFakeCore();
    const elevatedCore = createFakeCore();
    const createCore = vi
      .fn<(input: { auth: OperatorAuthStrategy }) => never>()
      .mockReturnValueOnce(baselineCore as never)
      .mockReturnValueOnce(elevatedCore as never);

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

    expect(createCore).toHaveBeenCalledTimes(2);
    expect(createCore).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        auth: createBearerTokenAuth("elevated"),
      }),
    );
    expect(manager.getCore()).toBe(elevatedCore);

    manager.dispose();
    elevatedModeStore.dispose();
  });
});
