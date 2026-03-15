import { createBrowserLocalStorageDeviceIdentityStorage } from "./device-identity.js";
import {
  createTyrumHttpClient as createBaseTyrumHttpClient,
  TyrumHttpClientError,
  type TyrumHttpAuthStrategy,
  type TyrumHttpClient,
  type TyrumHttpClientOperator,
  type TyrumHttpErrorCode,
  type TyrumHttpFetch,
  type TyrumRequestOptions,
} from "./http/index.js";
import type { TyrumHttpClientOptions as BaseTyrumHttpClientOptions } from "./http/shared.js";
import { createManagedNodeClientLifecycle } from "./managed-node-client.js";
import {
  TyrumClient as BaseTyrumClient,
  type TyrumClientDynamicSchema,
  type TyrumClientEvents,
  type TyrumClientOptions as BaseTyrumClientOptions,
  type TyrumClientProtocolErrorInfo,
  type TyrumClientProtocolErrorKind,
} from "./ws-client.js";
import { normalizeFingerprint256 } from "./tls/fingerprint.js";
import { VERSION } from "./version.js";

export * from "./public-shared.js";

export type BrowserTyrumHttpClientOptions = Omit<
  BaseTyrumHttpClientOptions,
  "tlsCertFingerprint256" | "tlsAllowSelfSigned" | "tlsCaCertPem"
>;

export type BrowserTyrumClientOptions = Omit<
  BaseTyrumClientOptions,
  "tlsCertFingerprint256" | "tlsAllowSelfSigned" | "tlsCaCertPem"
>;

export class TyrumClient extends BaseTyrumClient {
  constructor(options: BrowserTyrumClientOptions) {
    super(options as BaseTyrumClientOptions);
  }
}

export function createTyrumHttpClient(
  options: BrowserTyrumHttpClientOptions,
): TyrumHttpClientOperator {
  return createBaseTyrumHttpClient(options);
}

export {
  normalizeFingerprint256,
  createBrowserLocalStorageDeviceIdentityStorage,
  createManagedNodeClientLifecycle,
  TyrumHttpClientError,
};
export * from "./public-device-identity.js";
export type {
  TyrumClientDynamicSchema,
  TyrumClientEvents,
  TyrumClientProtocolErrorInfo,
  TyrumClientProtocolErrorKind,
  TyrumHttpAuthStrategy,
  TyrumHttpClient,
  TyrumHttpClientOperator,
  TyrumHttpErrorCode,
  TyrumHttpFetch,
  TyrumRequestOptions,
};
export { VERSION };
export type { ManagedNodeClient, ManagedNodeClientLifecycle } from "./managed-node-client.js";
