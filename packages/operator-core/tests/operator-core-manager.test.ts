import { describe, expect, it, vi } from "vitest";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createElevatedModeStore,
  createOperatorCoreManager,
  type OperatorAuthStrategy,
} from "../src/index.js";

function createFakeCore() {
  return {
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

  it("does not recreate the core when elevated mode enters or exits", () => {
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

    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    elevatedModeStore.exit();

    expect(createCore).toHaveBeenCalledTimes(1);
    expect(manager.getCore()).toBe(fakeCore);

    manager.dispose();
    elevatedModeStore.dispose();
  });

  it("passes through baseline browser-cookie auth unchanged", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBrowserCookieAuth({ credentials: "include" });
    const fakeCore = createFakeCore();
    const createCore = vi.fn((input: { auth: OperatorAuthStrategy }) => {
      expect(input.auth).toEqual(baselineAuth);
      return fakeCore as never;
    });

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      elevatedModeStore,
      createCore: createCore as never,
    });

    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(createCore).toHaveBeenCalledTimes(1);

    manager.dispose();
    elevatedModeStore.dispose();
  });
});
