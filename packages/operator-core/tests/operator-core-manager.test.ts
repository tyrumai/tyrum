import { describe, expect, it, vi } from "vitest";
import {
  createElevatedModeStore,
  createBearerTokenAuth,
  createBrowserCookieAuth,
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
  it("recreates core + reconnects when Elevated Mode enters and previous core was connected", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
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
      elevatedModeStore,
      createCore: createCore as any,
    });

    expect(createCore).toHaveBeenCalledTimes(1);
    expect(created[0]?.auth).toEqual(baselineAuth);
    expect(manager.getCore()).toBe(created[0]?.core);

    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(createCore).toHaveBeenCalledTimes(2);
    expect(created[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(created[1]?.auth).toEqual({ type: "bearer-token", token: "elevated" });
    expect(created[1]?.connect).toHaveBeenCalledTimes(1);
    expect(manager.getCore()).toBe(created[1]?.core);

    manager.dispose();
    elevatedModeStore.dispose();
  });

  it("recreates core + reconnects when Elevated Mode exits and previous core was connected", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
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
      elevatedModeStore,
      createCore: createCore as any,
    });

    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(createCore).toHaveBeenCalledTimes(2);

    elevatedModeStore.exit();
    expect(createCore).toHaveBeenCalledTimes(3);

    expect(created[0]?.auth).toEqual(baselineAuth);
    expect(created[1]?.auth).toEqual({ type: "bearer-token", token: "elevated" });
    expect(created[2]?.auth).toEqual(baselineAuth);

    expect(created[1]?.dispose).toHaveBeenCalledTimes(1);
    expect(created[2]?.connect).toHaveBeenCalledTimes(1);

    manager.dispose();
    elevatedModeStore.dispose();
  });

  it("does not recreate core when selected auth is unchanged", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const createCore = vi.fn(() => createFakeCore({ status: "connected" }).core as any);

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      elevatedModeStore,
      createCore: createCore as any,
    });

    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    elevatedModeStore.enter({ elevatedToken: "elevated", expiresAt });
    expect(createCore).toHaveBeenCalledTimes(2);

    elevatedModeStore.enter({ elevatedToken: "elevated", expiresAt });
    expect(createCore).toHaveBeenCalledTimes(2);

    manager.dispose();
    elevatedModeStore.dispose();
  });

  it("dispose stops reacting to elevated mode changes", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const createCore = vi.fn(() => createFakeCore({ status: "connected" }).core as any);

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      elevatedModeStore,
      createCore: createCore as any,
    });

    manager.dispose();

    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(createCore).toHaveBeenCalledTimes(1);
    elevatedModeStore.dispose();
  });

  it("notifies subscribers on core changes and unsubscribe stops notifications", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const created: Array<{
      auth: OperatorAuthStrategy;
      core: unknown;
      connect: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }> = [];

    const createCore = vi.fn((input: { auth: OperatorAuthStrategy }) => {
      const fake = createFakeCore({ status: "disconnected" });
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
      elevatedModeStore,
      createCore: createCore as any,
    });

    const listener = vi.fn(() => {});
    const unsub = manager.subscribe(listener);

    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(created[1]?.connect).toHaveBeenCalledTimes(0);

    unsub();

    elevatedModeStore.exit();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(created[2]?.connect).toHaveBeenCalledTimes(0);

    manager.dispose();
    elevatedModeStore.dispose();
  });

  it("rethrows the first subscriber error while still calling other listeners", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const createCore = vi.fn(() => createFakeCore({ status: "disconnected" }).core as any);

    const manager = createOperatorCoreManager({
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      baselineAuth,
      elevatedModeStore,
      createCore: createCore as any,
    });

    const error = new Error("boom");
    const secondListener = vi.fn(() => {});

    manager.subscribe(() => {
      throw error;
    });
    manager.subscribe(secondListener);

    expect(() => {
      elevatedModeStore.enter({
        elevatedToken: "elevated",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
    }).toThrow(error);

    expect(secondListener).toHaveBeenCalledTimes(1);

    manager.dispose();
    elevatedModeStore.dispose();
  });

  it("reconnects when previous core was connecting", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBearerTokenAuth("baseline");

    const created: Array<{
      auth: OperatorAuthStrategy;
      core: unknown;
      connect: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }> = [];

    const createCore = vi.fn((input: { auth: OperatorAuthStrategy }) => {
      const status: ConnectionStatus = created.length === 0 ? "connecting" : "disconnected";
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
      elevatedModeStore,
      createCore: createCore as any,
    });

    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(created[1]?.connect).toHaveBeenCalledTimes(1);

    manager.dispose();
    elevatedModeStore.dispose();
  });

  it("supports baseline browser-cookie auth strategies", () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    const baselineAuth = createBrowserCookieAuth({ credentials: "include" });

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
      elevatedModeStore,
      createCore: createCore as any,
    });

    expect(created[0]?.auth).toEqual(baselineAuth);

    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(created[1]?.auth).toEqual({ type: "bearer-token", token: "elevated" });

    manager.dispose();
    elevatedModeStore.dispose();
  });
});
