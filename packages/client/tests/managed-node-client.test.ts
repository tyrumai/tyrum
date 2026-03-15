import { describe, expect, it, vi } from "vitest";
import { createManagedNodeClientLifecycle, type ManagedNodeClient } from "../src/browser.js";

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
  on(
    event: "disconnected",
    handler: (event: ManagedEventPayloads["disconnected"]) => void,
  ): void;
  on(
    event: "transport_error",
    handler: (event: ManagedEventPayloads["transport_error"]) => void,
  ): void;
  on(event: ManagedEventName, handler: (event: ManagedEventPayloads[ManagedEventName]) => void): void {
    this.listeners[event].add(handler as never);
  }

  off(event: "connected", handler: (event: ManagedEventPayloads["connected"]) => void): void;
  off(
    event: "disconnected",
    handler: (event: ManagedEventPayloads["disconnected"]) => void,
  ): void;
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
}

describe("createManagedNodeClientLifecycle", () => {
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

  it("supports manual capability republish while active", async () => {
    const client = new FakeManagedNodeClient();
    const lifecycle = createManagedNodeClientLifecycle({
      client,
      getCapabilityReadyPayload: () => ({
        capabilities: [{ id: "tyrum.browser.geolocation.get", version: "1.0.0" }],
        capability_states: [],
      }),
    });

    await lifecycle.publishCapabilityState();

    expect(client.capabilityReady).not.toHaveBeenCalled();

    client.emit("connected", { clientId: "client-1" });
    await Promise.resolve();
    await lifecycle.publishCapabilityState();

    expect(client.capabilityReady).toHaveBeenNthCalledWith(2, {
      capabilities: [{ id: "tyrum.browser.geolocation.get", version: "1.0.0" }],
      capability_states: [],
    });
  });

  it("removes listeners and disconnects exactly once on dispose", async () => {
    const client = new FakeManagedNodeClient();
    const onDisconnected = vi.fn();
    const onTransportError = vi.fn();
    const lifecycle = createManagedNodeClientLifecycle({
      client,
      getCapabilityReadyPayload: () => ({ capabilities: [], capability_states: [] }),
      onDisconnected,
      onTransportError,
    });

    lifecycle.dispose();
    lifecycle.dispose();

    expect(client.disconnect).toHaveBeenCalledTimes(1);

    client.emit("disconnected", { code: 1000, reason: "closed" });
    client.emit("transport_error", { message: "ignored" });
    client.emit("connected", { clientId: "ignored" });
    await Promise.resolve();

    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onTransportError).not.toHaveBeenCalled();
    expect(client.capabilityReady).not.toHaveBeenCalled();
  });

  it("forwards transport errors while active", () => {
    const client = new FakeManagedNodeClient();
    const onTransportError = vi.fn();
    createManagedNodeClientLifecycle({
      client,
      getCapabilityReadyPayload: () => ({ capabilities: [], capability_states: [] }),
      onTransportError,
    });

    client.emit("transport_error", { message: "socket failed" });

    expect(onTransportError).toHaveBeenCalledWith({ message: "socket failed" });
  });

  it("cleans up safely when disposed during an in-flight connect", async () => {
    class DeferredConnectClient extends FakeManagedNodeClient {
      override readonly connect = vi.fn(() => {
        queueMicrotask(() => {
          this.emit("connected", { clientId: "late-client" });
        });
      });
    }

    const client = new DeferredConnectClient();
    const onConnected = vi.fn();
    const onDispose = vi.fn();
    const lifecycle = createManagedNodeClientLifecycle({
      client,
      getCapabilityReadyPayload: () => ({ capabilities: [], capability_states: [] }),
      onConnected,
      onDispose,
    });

    lifecycle.connect();
    lifecycle.dispose();
    await Promise.resolve();

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(onConnected).not.toHaveBeenCalled();
    expect(client.capabilityReady).not.toHaveBeenCalled();
  });
});
