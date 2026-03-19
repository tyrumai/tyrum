import { createManagedNodeClientLifecycle } from "@tyrum/client/browser";
import {
  createTyrumHttpClient,
  TyrumClient,
  type BrowserTyrumClientOptions,
  type BrowserTyrumHttpClientOptions,
} from "@tyrum/transport-sdk/browser";
import type { OperatorAdminClient } from "./operator-core.types.js";
import type { OperatorHttpClient } from "./deps.js";

export * from "./index.js";
export { autoExecute } from "@tyrum/node-sdk/browser";
export { createManagedNodeClientLifecycle };
export {
  createBrowserLocalStorageDeviceIdentityStorage,
  createTyrumHttpClient,
  createDeviceIdentity,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  normalizeFingerprint256,
  TyrumClient,
  TyrumHttpClientError,
} from "@tyrum/transport-sdk/browser";
export type { ManagedNodeClientLifecycle } from "@tyrum/client/browser";
export type { CapabilityProvider, TaskExecuteContext, TaskResult } from "@tyrum/node-sdk/browser";
export { BrowserActionArgs } from "@tyrum/contracts";
export type {
  AgentListResult,
  AuditExportResult,
  AuditForgetResult,
  AuditPlansListResult,
  AuthTokenListEntry,
  AuthTokenUpdateInput,
  DesktopEnvironmentGetResult,
  DesktopEnvironmentHostListResult,
  ObservedTelegramThreadListResult,
  PairingGetResponse,
  StatusResponse,
  ToolRegistryListResult,
  BrowserTyrumClientOptions,
  BrowserTyrumHttpClientOptions,
  DeviceIdentity,
} from "@tyrum/transport-sdk/browser";
export type { ActionPrimitive } from "@tyrum/contracts";
export type {
  ExecutionAttempt,
  ExecutionRun,
  ExecutionStep,
  MemoryItem,
} from "@tyrum/client/browser";
export type * from "@tyrum/transport-sdk";

export type OperatorAdminClientOptions = BrowserTyrumHttpClientOptions;
export type OperatorCommandClientOptions = Pick<BrowserTyrumClientOptions, "url" | "token">;

export function createOperatorHttpClient(
  options: BrowserTyrumHttpClientOptions,
): OperatorHttpClient {
  return createTyrumHttpClient(options);
}

export function createOperatorAdminClient(
  options: OperatorAdminClientOptions,
): OperatorAdminClient {
  return createOperatorHttpClient(options);
}

export async function executeOperatorCommand(
  options: OperatorCommandClientOptions & {
    command: string;
  },
) {
  const ws = new TyrumClient({
    url: options.url,
    token: options.token,
    capabilities: [],
    reconnect: false,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onConnected = () => {
        ws.off("connected", onConnected);
        ws.off("disconnected", onDisconnected);
        ws.off("transport_error", onTransportError);
        resolve();
      };
      const onDisconnected = () => {
        ws.off("connected", onConnected);
        ws.off("disconnected", onDisconnected);
        ws.off("transport_error", onTransportError);
        reject(new Error("Admin command connection closed before it became ready."));
      };
      const onTransportError = (event: { message: string }) => {
        ws.off("connected", onConnected);
        ws.off("disconnected", onDisconnected);
        ws.off("transport_error", onTransportError);
        reject(new Error(event.message));
      };

      ws.on("connected", onConnected);
      ws.on("disconnected", onDisconnected);
      ws.on("transport_error", onTransportError);
      ws.connect();
    });

    return await ws.commandExecute(options.command);
  } finally {
    ws.disconnect();
  }
}
