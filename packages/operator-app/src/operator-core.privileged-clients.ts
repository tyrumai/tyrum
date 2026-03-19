import {
  TyrumClient,
  createTyrumHttpClient,
  type DeviceIdentity,
} from "@tyrum/transport-sdk/browser";
import type { OperatorHttpClient, OperatorWsClient } from "./deps.js";
import { isElevatedModeActive } from "./elevated-mode.js";
import type { ElevatedModeStore } from "./stores/elevated-mode-store.js";

function readActiveElevatedToken(store: ElevatedModeStore): string | null {
  const elevatedMode = store.getSnapshot();
  const token = elevatedMode.elevatedToken?.trim();
  if (!isElevatedModeActive(elevatedMode) || !token) {
    return null;
  }
  return token;
}

export function createPrivilegedWsClientFactory(input: {
  wsUrl: string;
  deviceIdentity?: DeviceIdentity;
  elevatedModeStore: ElevatedModeStore;
}): () => OperatorWsClient | null {
  return () => {
    const token = readActiveElevatedToken(input.elevatedModeStore);
    if (!token) {
      return null;
    }

    return new TyrumClient({
      url: input.wsUrl,
      token,
      capabilities: [],
      reconnect: false,
      device: input.deviceIdentity
        ? {
            deviceId: input.deviceIdentity.deviceId,
            publicKey: input.deviceIdentity.publicKey,
            privateKey: input.deviceIdentity.privateKey,
          }
        : undefined,
    });
  };
}

export function createPrivilegedHttpClientFactory(input: {
  httpBaseUrl: string;
  elevatedModeStore: ElevatedModeStore;
}): () => OperatorHttpClient | null {
  return () => {
    const token = readActiveElevatedToken(input.elevatedModeStore);
    if (!token) {
      return null;
    }

    return createTyrumHttpClient({
      baseUrl: input.httpBaseUrl,
      auth: { type: "bearer", token },
    });
  };
}
