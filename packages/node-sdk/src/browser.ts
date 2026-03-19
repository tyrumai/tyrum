import { VERSION } from "./version.js";

export * from "./index.js";
export type * from "./index.js";
export {
  TyrumClient,
  TyrumHttpClientError,
  createBrowserLocalStorageDeviceIdentityStorage,
  createDeviceIdentity,
  createTyrumHttpClient,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  normalizeFingerprint256,
} from "@tyrum/transport-sdk/browser";
export type {
  BrowserTyrumClientOptions,
  BrowserTyrumHttpClientOptions,
  DeviceIdentity,
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
} from "@tyrum/transport-sdk/browser";
export { VERSION };
