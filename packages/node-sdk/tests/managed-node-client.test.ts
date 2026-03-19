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
});
