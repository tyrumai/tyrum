import type {
  CapabilityDescriptor,
  ClientCapability,
  WsApprovalRequest,
  WsEvent as WsEventT,
  WsPeerRole,
  WsPlanUpdateEvent,
  WsTaskExecuteRequest,
} from "@tyrum/schemas";

type TyrumProtocolEvents = {
  [EventType in WsEventT["type"]]: Extract<WsEventT, { type: EventType }>;
};

export type TyrumClientProtocolErrorKind = "invalid_json" | "invalid_envelope";

export interface TyrumClientProtocolErrorInfo {
  kind: TyrumClientProtocolErrorKind;
  raw: string;
  error?: string;
  suppressedCount: number;
}

export type TyrumClientEvents = TyrumProtocolEvents & {
  connected: { clientId: string };
  disconnected: { code: number; reason: string };
  protocol_error: TyrumClientProtocolErrorInfo;
  reconnect_scheduled: { delayMs: number; nextRetryAtMs: number; attempt: number };
  transport_error: { message: string };
  task_execute: WsTaskExecuteRequest;
  approval_request: WsApprovalRequest;
  plan_update: WsPlanUpdateEvent;
};

export interface TyrumClientOptions {
  url: string;
  token: string;
  tlsCertFingerprint256?: string;
  tlsAllowSelfSigned?: boolean;
  tlsCaCertPem?: string;
  capabilities: ClientCapability[];
  advertisedCapabilities?: CapabilityDescriptor[];
  role?: WsPeerRole;
  protocolRev?: number;
  device?: {
    publicKey: string;
    privateKey: string;
    deviceId?: string;
    label?: string;
    platform?: string;
    version?: string;
    mode?: string;
  };
  reconnect?: boolean;
  reconnectBaseDelayMs?: number;
  maxReconnectDelay?: number;
  maxSeenEventIds?: number;
  maxSeenRequestIds?: number;
  debugProtocol?: boolean;
  onProtocolError?: (info: TyrumClientProtocolErrorInfo) => void;
}

export type ResolvedTyrumClientOptions = TyrumClientOptions & {
  reconnect: boolean;
  reconnectBaseDelayMs: number;
  maxReconnectDelay: number;
  maxSeenEventIds: number;
  maxSeenRequestIds: number;
  debugProtocol: boolean;
  role: WsPeerRole;
  protocolRev: number;
};
