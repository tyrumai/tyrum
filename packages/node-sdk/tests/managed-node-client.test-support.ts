import { vi } from "vitest";

type ClientEventHandler = (event?: unknown) => void;

type ManagedNodeClientLike = {
  capabilityReady(payload: unknown): Promise<void> | void;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: ClientEventHandler): void;
  off(event: string, handler: ClientEventHandler): void;
};

type ManagedNodeClientLifecycleMockInput<TClient extends ManagedNodeClientLike> = {
  client: TClient;
  providers?: readonly unknown[];
  getCapabilityReadyPayload: () => unknown;
  onConnected?: (event?: unknown) => void;
  onDisconnected?: (event?: unknown) => void;
  onTransportError?: (event: { message: string }) => void;
  onDispose?: () => void;
};

export function createManagedNodeClientLifecycleMock<TClient extends ManagedNodeClientLike>(opts?: {
  autoExecute?: (client: TClient, providers: readonly unknown[]) => void;
  requireConnectedObject?: boolean;
}) {
  return vi.fn((input: ManagedNodeClientLifecycleMockInput<TClient>) => {
    let disposed = false;
    let connected = false;

    const handleConnected = (event?: unknown) => {
      if (disposed) return;
      if (opts?.requireConnectedObject && (!event || typeof event !== "object")) return;
      connected = true;
      input.onConnected?.(event);
      void input.client.capabilityReady(input.getCapabilityReadyPayload());
    };

    const handleDisconnected = (event?: unknown) => {
      connected = false;
      if (disposed) return;
      input.onDisconnected?.(event);
    };

    const handleTransportError = (event?: unknown) => {
      if (disposed || !event || typeof event !== "object") return;
      input.onTransportError?.(event as { message: string });
    };

    if (opts?.autoExecute && input.providers) {
      opts.autoExecute(input.client, [...input.providers]);
    }
    input.client.on("connected", handleConnected);
    input.client.on("disconnected", handleDisconnected);
    input.client.on("transport_error", handleTransportError);

    return {
      client: input.client,
      connect() {
        if (disposed) return;
        input.client.connect();
      },
      async publishCapabilityState() {
        if (disposed || !connected) return;
        await input.client.capabilityReady(input.getCapabilityReadyPayload());
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        input.client.off("connected", handleConnected);
        input.client.off("disconnected", handleDisconnected);
        input.client.off("transport_error", handleTransportError);
        input.onDispose?.();
        input.client.disconnect();
      },
    };
  });
}
