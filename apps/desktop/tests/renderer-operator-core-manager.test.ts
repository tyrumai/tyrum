import {
  createBearerTokenAuth,
  createElevatedModeStore,
  createOperatorCoreManager,
  type OperatorAuthStrategy,
} from "@tyrum/operator-core";
import { describe, expect, it, vi } from "vitest";

function createFakeCore() {
  return {
    dispose: vi.fn(),
  };
}

describe("createOperatorCoreManager", () => {
  it("does not recreate the desktop operator core when admin access enters or exits", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");
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
      createCore,
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
});
