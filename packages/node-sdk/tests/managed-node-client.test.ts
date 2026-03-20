import { beforeEach, describe, expect, it, vi } from "vitest";

const autoExecuteMock = vi.hoisted(() => vi.fn());

vi.mock("../src/capability.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/capability.js")>("../src/capability.js");
  return {
    ...actual,
    autoExecute: autoExecuteMock,
  };
});

import { createManagedNodeClientLifecycle, type ManagedNodeClient } from "../src/browser.js";
import type { CapabilityProvider } from "../src/capability.js";

type ManagedEventName = "connected" | "disconnected" | "transport_error";
type ManagedEventPayloads = {
  connected: { clientId: string };
  disconnected: { code: number; reason: string };
  transport_error: { message: string };
};

class FakeManagedNodeClient implements ManagedNodeClient {
  readonly connect = vi.fn(() => {});
  readonly disconnect = vi.fn(() => {});
  readonly capabilityReady = vi.fn(async () => {});
  readonly respondTaskExecute = vi.fn(() => {});

  private readonly listeners: {
    [EventName in ManagedEventName]: Set<(event: ManagedEventPayloads[EventName]) => void>;
  } = {
    connected: new Set(),
    disconnected: new Set(),
    transport_error: new Set(),
  };

  on(event: "connected", handler: (event: ManagedEventPayloads["connected"]) => void): void;
  on(event: "disconnected", handler: (event: ManagedEventPayloads["disconnected"]) => void): void;
  on(
    event: "transport_error",
    handler: (event: ManagedEventPayloads["transport_error"]) => void,
  ): void;
  on(
    event: ManagedEventName,
    handler: (event: ManagedEventPayloads[ManagedEventName]) => void,
  ): void {
    this.listeners[event].add(handler as never);
  }

  off(event: "connected", handler: (event: ManagedEventPayloads["connected"]) => void): void;
  off(event: "disconnected", handler: (event: ManagedEventPayloads["disconnected"]) => void): void;
  off(
    event: "transport_error",
    handler: (event: ManagedEventPayloads["transport_error"]) => void,
  ): void;
  off(
    event: ManagedEventName,
    handler: (event: ManagedEventPayloads[ManagedEventName]) => void,
  ): void {
    this.listeners[event].delete(handler as never);
  }

  emit<EventName extends ManagedEventName>(
    event: EventName,
    payload: ManagedEventPayloads[EventName],
  ): void {
    for (const handler of this.listeners[event]) {
      handler(payload);
    }
  }

  listenerCount(event: ManagedEventName): number {
    return this.listeners[event].size;
  }
}

describe("createManagedNodeClientLifecycle", () => {
  beforeEach(() => {
    autoExecuteMock.mockReset();
  });

  it("registers providers, connects, and republishes capability state on connect", async () => {
    const client = new FakeManagedNodeClient();
    const registerProviders = vi.fn();
    const onConnected = vi.fn();
    const getCapabilityReadyPayload = vi.fn(() => ({
      capabilities: [],
      capability_states: [],
    }));

    const lifecycle = createManagedNodeClientLifecycle({
      client,
      registerProviders,
      getCapabilityReadyPayload,
      onConnected,
    });

    expect(registerProviders).toHaveBeenCalledWith(client);

    lifecycle.connect();
    expect(client.connect).toHaveBeenCalledTimes(1);

    client.emit("connected", { clientId: "client-1" });
    await Promise.resolve();

    expect(onConnected).toHaveBeenCalledWith({ clientId: "client-1" });
    expect(getCapabilityReadyPayload).toHaveBeenCalledTimes(1);
    expect(client.capabilityReady).toHaveBeenCalledWith({
      capabilities: [],
      capability_states: [],
    });
  });

  it("does not publish capability state before the first connection", async () => {
    const client = new FakeManagedNodeClient();
    const getCapabilityReadyPayload = vi.fn(() => ({
      capabilities: [],
      capability_states: [],
    }));

    const lifecycle = createManagedNodeClientLifecycle({
      client,
      getCapabilityReadyPayload,
    });

    await lifecycle.publishCapabilityState();

    expect(getCapabilityReadyPayload).not.toHaveBeenCalled();
    expect(client.capabilityReady).not.toHaveBeenCalled();
  });

  it("registers providers with autoExecute when registerProviders is absent", () => {
    const client = new FakeManagedNodeClient();
    const providers = [{ capability: "desktop", execute: vi.fn() }] satisfies CapabilityProvider[];

    createManagedNodeClientLifecycle({
      client,
      providers,
      getCapabilityReadyPayload: () => ({
        capabilities: [],
        capability_states: [],
      }),
    });

    expect(autoExecuteMock).toHaveBeenCalledWith(client, providers);
  });

  it("prefers registerProviders over providers", () => {
    const client = new FakeManagedNodeClient();
    const registerProviders = vi.fn();
    const providers = [{ capability: "desktop", execute: vi.fn() }] satisfies CapabilityProvider[];

    createManagedNodeClientLifecycle({
      client,
      providers,
      registerProviders,
      getCapabilityReadyPayload: () => ({
        capabilities: [],
        capability_states: [],
      }),
    });

    expect(registerProviders).toHaveBeenCalledWith(client);
    expect(autoExecuteMock).not.toHaveBeenCalled();
  });

  it("handles disconnects, transport errors, and reconnects", async () => {
    const client = new FakeManagedNodeClient();
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();
    const onTransportError = vi.fn();
    const getCapabilityReadyPayload = vi.fn(() => ({
      capabilities: [],
      capability_states: [],
    }));

    const lifecycle = createManagedNodeClientLifecycle({
      client,
      getCapabilityReadyPayload,
      onConnected,
      onDisconnected,
      onTransportError,
    });

    client.emit("connected", { clientId: "client-1" });
    await Promise.resolve();

    expect(onConnected).toHaveBeenCalledWith({ clientId: "client-1" });
    expect(client.capabilityReady).toHaveBeenCalledTimes(1);

    client.emit("disconnected", { code: 1006, reason: "net down" });
    expect(onDisconnected).toHaveBeenCalledWith({ code: 1006, reason: "net down" });

    await lifecycle.publishCapabilityState();
    expect(client.capabilityReady).toHaveBeenCalledTimes(1);

    client.emit("transport_error", { message: "socket closed" });
    expect(onTransportError).toHaveBeenCalledWith({ message: "socket closed" });

    client.emit("connected", { clientId: "client-2" });
    await Promise.resolve();

    expect(onConnected).toHaveBeenCalledWith({ clientId: "client-2" });
    expect(client.capabilityReady).toHaveBeenCalledTimes(2);
  });

  it("disposes idempotently and ignores future events and calls", async () => {
    const client = new FakeManagedNodeClient();
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();
    const onTransportError = vi.fn();
    const onDispose = vi.fn();
    const getCapabilityReadyPayload = vi.fn(() => ({
      capabilities: [],
      capability_states: [],
    }));

    const lifecycle = createManagedNodeClientLifecycle({
      client,
      getCapabilityReadyPayload,
      onConnected,
      onDisconnected,
      onTransportError,
      onDispose,
    });

    expect(client.listenerCount("connected")).toBe(1);
    expect(client.listenerCount("disconnected")).toBe(1);
    expect(client.listenerCount("transport_error")).toBe(1);

    lifecycle.connect();
    expect(client.connect).toHaveBeenCalledTimes(1);

    client.emit("connected", { clientId: "client-1" });
    await Promise.resolve();
    expect(client.capabilityReady).toHaveBeenCalledTimes(1);

    lifecycle.dispose();
    lifecycle.dispose();

    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.listenerCount("connected")).toBe(0);
    expect(client.listenerCount("disconnected")).toBe(0);
    expect(client.listenerCount("transport_error")).toBe(0);

    lifecycle.connect();
    await lifecycle.publishCapabilityState();
    client.emit("connected", { clientId: "client-2" });
    client.emit("disconnected", { code: 1000, reason: "bye" });
    client.emit("transport_error", { message: "ignored" });
    await Promise.resolve();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.capabilityReady).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onTransportError).not.toHaveBeenCalled();
  });
});
