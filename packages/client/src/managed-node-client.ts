import type { WsCapabilityReadyPayload } from "@tyrum/schemas";
import type { CapabilityProvider } from "./capability.js";
import { autoExecute } from "./capability.js";
import type { TyrumClient } from "./ws-client.js";
import type { TyrumClientEvents } from "./ws-client.types.js";

export type ManagedNodeClient = Pick<
  TyrumClient,
  "connect" | "disconnect" | "capabilityReady" | "respondTaskExecute" | "on" | "off"
>;

export interface ManagedNodeClientLifecycle<TClient extends ManagedNodeClient> {
  readonly client: TClient;
  connect(): void;
  publishCapabilityState(): Promise<void>;
  dispose(): void;
}

export function createManagedNodeClientLifecycle<TClient extends ManagedNodeClient>(input: {
  client: TClient;
  getCapabilityReadyPayload: () => WsCapabilityReadyPayload;
  providers?: readonly CapabilityProvider[];
  registerProviders?: (client: TClient) => void;
  onConnected?: (event: TyrumClientEvents["connected"]) => void;
  onDisconnected?: (event: TyrumClientEvents["disconnected"]) => void;
  onTransportError?: (event: TyrumClientEvents["transport_error"]) => void;
  onDispose?: () => void;
}): ManagedNodeClientLifecycle<TClient> {
  let disposed = false;
  let connected = false;

  const publishCapabilityState = async (): Promise<void> => {
    if (disposed) return;
    await input.client.capabilityReady(input.getCapabilityReadyPayload());
  };

  const handleConnected = (event: TyrumClientEvents["connected"]): void => {
    if (disposed) return;
    connected = true;
    input.onConnected?.(event);
    void publishCapabilityState();
  };

  const handleDisconnected = (event: TyrumClientEvents["disconnected"]): void => {
    connected = false;
    if (disposed) return;
    input.onDisconnected?.(event);
  };

  const handleTransportError = (event: TyrumClientEvents["transport_error"]): void => {
    if (disposed) return;
    input.onTransportError?.(event);
  };

  if (input.registerProviders) {
    input.registerProviders(input.client);
  } else if (input.providers) {
    autoExecute(input.client, [...input.providers]);
  }
  input.client.on("connected", handleConnected);
  input.client.on("disconnected", handleDisconnected);
  input.client.on("transport_error", handleTransportError);

  return {
    client: input.client,
    connect(): void {
      if (disposed) return;
      input.client.connect();
    },
    async publishCapabilityState(): Promise<void> {
      if (!connected) return;
      await publishCapabilityState();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      connected = false;
      input.client.off("connected", handleConnected);
      input.client.off("disconnected", handleDisconnected);
      input.client.off("transport_error", handleTransportError);
      input.onDispose?.();
      input.client.disconnect();
    },
  };
}
