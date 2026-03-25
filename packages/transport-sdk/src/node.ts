import { createNodeFileDeviceIdentityStorage } from "./device-identity-node.js";
import {
  createTyrumHttpClient,
  TyrumHttpClientError,
  type TyrumHttpAuthStrategy,
  type TyrumHttpClient,
  type TyrumHttpClientOperator,
  type TyrumHttpClientOptions as NodeTyrumHttpClientOptions,
  type TyrumHttpErrorCode,
  type TyrumHttpFetch,
  type TyrumRequestOptions,
} from "./http/index.js";
import {
  createPinnedNodeTransportState,
  createPinnedNodeWebSocket,
  destroyPinnedNodeDispatcher,
  type NodePinnedTlsOptions,
  type NodePinnedTransportState,
  type NodePinnedWebSocketOptions,
} from "./node/pinned-transport.js";
import { normalizeFingerprint256 } from "./tls/fingerprint.js";
import {
  TyrumClient,
  type TyrumClientDynamicSchema,
  type TyrumClientEvents,
  type TyrumClientOptions as NodeTyrumClientOptions,
  type TyrumClientProtocolErrorInfo,
  type TyrumClientProtocolErrorKind,
} from "./ws-client.generated.js";
export {
  createTyrumAiSdkChatConversationClient,
  createTyrumAiSdkChatTransport,
  DEFAULT_TYRUM_AI_SDK_CHAT_OPERATIONS,
  supportsTyrumAiSdkChatSocket,
  TyrumAiSdkChatTransport,
} from "./ai-sdk-chat.js";
import { VERSION } from "./version.js";

export {
  TyrumClient,
  normalizeFingerprint256,
  createNodeFileDeviceIdentityStorage,
  createPinnedNodeTransportState,
  createPinnedNodeWebSocket,
  destroyPinnedNodeDispatcher,
  createTyrumHttpClient,
  TyrumHttpClientError,
};
export * from "./public-device-identity.js";
export type {
  NodePinnedTlsOptions,
  NodePinnedTransportState,
  NodePinnedWebSocketOptions,
  NodeTyrumClientOptions,
  NodeTyrumHttpClientOptions,
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
export type * from "./public-types.js";
export { VERSION };
