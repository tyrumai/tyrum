import {
  TyrumClient,
  createNodeFileDeviceIdentityStorage,
  loadOrCreateDeviceIdentity,
} from "@tyrum/client";
import { createBearerTokenAuth, createOperatorCore, type OperatorCore } from "@tyrum/operator-core";

export type TuiCoreOptions = {
  wsUrl: string;
  httpBaseUrl: string;
  token: string;
  deviceIdentityPath: string;
  tlsCertFingerprint256?: string;
  reconnect?: boolean;
};

export async function createTuiCore(options: TuiCoreOptions): Promise<OperatorCore> {
  const identity = await loadOrCreateDeviceIdentity(
    createNodeFileDeviceIdentityStorage(options.deviceIdentityPath),
  );

  const ws = new TyrumClient({
    url: options.wsUrl,
    token: options.token,
    tlsCertFingerprint256: options.tlsCertFingerprint256,
    reconnect: options.reconnect,
    capabilities: [],
    device: {
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
      deviceId: identity.deviceId,
      label: "tui",
      platform: typeof process !== "undefined" ? process.platform : "unknown",
      version: typeof process !== "undefined" ? process.version : "unknown",
    },
  });

  return createOperatorCore({
    wsUrl: options.wsUrl,
    httpBaseUrl: options.httpBaseUrl,
    auth: createBearerTokenAuth(options.token),
    deps: { ws },
  });
}
