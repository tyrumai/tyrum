import {
  createAdminModeStore,
  createBearerTokenAuth,
  type OperatorAuthStrategy,
} from "@tyrum/operator-core";
import { describe, expect, it, vi } from "vitest";
import { createDesktopOperatorCoreManager } from "../src/renderer/lib/operator-core-manager.js";

type CoreStatus = "disconnected" | "connecting" | "connected";

function createFakeCore(options: { status: CoreStatus }) {
  const connect = vi.fn();
  const dispose = vi.fn();

  const core = {
    connectionStore: {
      getSnapshot() {
        return { status: options.status };
      },
    },
    connect,
    dispose,
  };

  return { core, connect, dispose };
}

describe("createDesktopOperatorCoreManager", () => {
  it("recreates core + reconnects when Admin Mode enters and previous core was connected", () => {
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const created: Array<{
      auth: OperatorAuthStrategy;
      core: unknown;
      connect: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }> = [];

    const createCore = vi.fn((input: { auth: OperatorAuthStrategy }) => {
      const status: CoreStatus = created.length === 0 ? "connected" : "disconnected";
      const fake = createFakeCore({ status });
      created.push({
        auth: input.auth,
        core: fake.core,
        connect: fake.connect,
        dispose: fake.dispose,
      });
      return fake.core as any;
    });

    const manager = createDesktopOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore,
    });

    expect(createCore).toHaveBeenCalledTimes(1);
    expect(created[0]?.auth).toEqual(baselineAuth);
    expect(manager.getCore()).toBe(created[0]?.core);

    adminModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(createCore).toHaveBeenCalledTimes(2);
    expect(created[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(created[1]?.auth).toEqual({ type: "bearer-token", token: "elevated" });
    expect(created[1]?.connect).toHaveBeenCalledTimes(1);
    expect(manager.getCore()).toBe(created[1]?.core);

    manager.dispose();
    adminModeStore.dispose();
  });

  it("recreates core + reconnects when Admin Mode exits and previous core was connected", () => {
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const created: Array<{
      auth: OperatorAuthStrategy;
      core: unknown;
      connect: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }> = [];

    const createCore = vi.fn((input: { auth: OperatorAuthStrategy }) => {
      const status: CoreStatus = created.length < 2 ? "connected" : "disconnected";
      const fake = createFakeCore({ status });
      created.push({
        auth: input.auth,
        core: fake.core,
        connect: fake.connect,
        dispose: fake.dispose,
      });
      return fake.core as any;
    });

    const manager = createDesktopOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore,
    });

    adminModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(createCore).toHaveBeenCalledTimes(2);

    adminModeStore.exit();
    expect(createCore).toHaveBeenCalledTimes(3);

    expect(created[0]?.auth).toEqual(baselineAuth);
    expect(created[1]?.auth).toEqual({ type: "bearer-token", token: "elevated" });
    expect(created[2]?.auth).toEqual(baselineAuth);

    expect(created[1]?.dispose).toHaveBeenCalledTimes(1);
    expect(created[2]?.connect).toHaveBeenCalledTimes(1);

    manager.dispose();
    adminModeStore.dispose();
  });

  it("does not reconnect when Admin Mode enters and previous core was disconnected", () => {
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const created: Array<{
      core: unknown;
      connect: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }> = [];

    const createCore = vi.fn(() => {
      const fake = createFakeCore({ status: "disconnected" });
      created.push({ core: fake.core, connect: fake.connect, dispose: fake.dispose });
      return fake.core as any;
    });

    const manager = createDesktopOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore,
    });

    adminModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(createCore).toHaveBeenCalledTimes(2);
    expect(created[1]?.connect).toHaveBeenCalledTimes(0);

    manager.dispose();
    adminModeStore.dispose();
  });

  it("does not recreate core when selected auth is unchanged", () => {
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const createCore = vi.fn(() => createFakeCore({ status: "connected" }).core as any);

    const manager = createDesktopOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore,
    });

    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    adminModeStore.enter({ elevatedToken: "elevated", expiresAt });
    expect(createCore).toHaveBeenCalledTimes(2);

    adminModeStore.enter({ elevatedToken: "elevated", expiresAt });
    expect(createCore).toHaveBeenCalledTimes(2);

    manager.dispose();
    adminModeStore.dispose();
  });

  it("dispose stops reacting to admin mode changes", () => {
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const createCore = vi.fn(() => createFakeCore({ status: "connected" }).core as any);

    const manager = createDesktopOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore,
    });

    manager.dispose();

    adminModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(createCore).toHaveBeenCalledTimes(1);
    adminModeStore.dispose();
  });
});
