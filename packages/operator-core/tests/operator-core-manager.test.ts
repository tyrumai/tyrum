import { describe, expect, it, vi } from "vitest";
import {
  createAdminModeStore,
  createBearerTokenAuth,
  createOperatorCoreManager,
  type OperatorAuthStrategy,
} from "../src/index.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

function createFakeCore(options: { status: ConnectionStatus }) {
  const connect = vi.fn(() => {});
  const dispose = vi.fn(() => {});

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

describe("createOperatorCoreManager", () => {
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
      const status: ConnectionStatus = created.length === 0 ? "connected" : "disconnected";
      const fake = createFakeCore({ status });
      created.push({
        auth: input.auth,
        core: fake.core,
        connect: fake.connect,
        dispose: fake.dispose,
      });
      return fake.core as any;
    });

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore: createCore as any,
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
      const status: ConnectionStatus = created.length < 2 ? "connected" : "disconnected";
      const fake = createFakeCore({ status });
      created.push({
        auth: input.auth,
        core: fake.core,
        connect: fake.connect,
        dispose: fake.dispose,
      });
      return fake.core as any;
    });

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore: createCore as any,
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

  it("does not recreate core when selected auth is unchanged", () => {
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const createCore = vi.fn(() => createFakeCore({ status: "connected" }).core as any);

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore: createCore as any,
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

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore: createCore as any,
    });

    manager.dispose();

    adminModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(createCore).toHaveBeenCalledTimes(1);
    adminModeStore.dispose();
  });

  it("notifies subscribers when core is recreated (and unsubscribe stops notifications)", () => {
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const createCore = vi.fn(() => createFakeCore({ status: "disconnected" }).core as any);

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore: createCore as any,
    });

    const listener = vi.fn(() => {});
    const unsubscribe = manager.subscribe(listener);

    adminModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();

    adminModeStore.exit();

    expect(listener).toHaveBeenCalledTimes(1);

    manager.dispose();
    adminModeStore.dispose();
  });

  it("notifies all subscribers and rethrows the first subscriber error", () => {
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const createCore = vi.fn(() => createFakeCore({ status: "disconnected" }).core as any);

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore: createCore as any,
    });

    const boom = new Error("boom");
    const throwingListener = vi.fn(() => {
      throw boom;
    });
    const okListener = vi.fn(() => {});

    manager.subscribe(throwingListener);
    manager.subscribe(okListener);

    expect(() =>
      adminModeStore.enter({
        elevatedToken: "elevated",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toThrow(boom);

    expect(throwingListener).toHaveBeenCalledTimes(1);
    expect(okListener).toHaveBeenCalledTimes(1);

    manager.dispose();
    adminModeStore.dispose();
  });

  it("supports browser-cookie baseline auth", () => {
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0 });
    const baselineAuth: OperatorAuthStrategy = { type: "browser-cookie", credentials: "include" };

    const createdAuth: OperatorAuthStrategy[] = [];
    const createCore = vi.fn((input: { auth: OperatorAuthStrategy }) => {
      createdAuth.push(input.auth);
      return createFakeCore({ status: "disconnected" }).core as any;
    });

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      adminModeStore,
      createCore: createCore as any,
    });

    expect(createCore).toHaveBeenCalledTimes(1);
    expect(createdAuth[0]).toEqual(baselineAuth);

    adminModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(createCore).toHaveBeenCalledTimes(2);
    expect(createdAuth[1]).toEqual({ type: "bearer-token", token: "elevated" });

    manager.dispose();
    adminModeStore.dispose();
  });
});
