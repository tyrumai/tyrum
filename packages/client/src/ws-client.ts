/**
 * TyrumClient — lightweight WebSocket client for the Tyrum gateway.
 *
 * Connects via the standard WebSocket API (available natively in Node 24+
 * and all modern browsers), sends/receives typed protocol messages, and
 * optionally auto-reconnects with exponential backoff + jitter.
 */

import type { Emitter } from "mitt";

// mitt's CJS type declarations lack a .d.mts, so under Node16 +
// verbatimModuleSyntax the default import is typed as the module
// namespace rather than the factory function.  We import the
// namespace and extract the default at runtime.
import * as mittNs from "mitt";

const mitt = (typeof mittNs.default === "function" ? mittNs.default : mittNs) as unknown as <
  T extends Record<string, unknown>,
>() => Emitter<T>;

import type {
  ClientCapability,
  WsApprovalListPayload,
  WsApprovalListResult as WsApprovalListResultT,
  WsApprovalResolvePayload,
  WsApprovalResolveResult as WsApprovalResolveResultT,
  WsAttemptEvidencePayload,
  WsCapabilityReadyPayload,
  WsCommandExecutePayload as WsCommandExecutePayloadT,
  WsCommandExecuteResult as WsCommandExecuteResultT,
  WsEvent as WsEventT,
  WsMemoryCreatePayload,
  WsMemoryCreateResult as WsMemoryCreateResultT,
  WsMemoryDeletePayload,
  WsMemoryDeleteResult as WsMemoryDeleteResultT,
  WsMemoryExportPayload,
  WsMemoryExportResult as WsMemoryExportResultT,
  WsMemoryForgetPayload,
  WsMemoryForgetResult as WsMemoryForgetResultT,
  WsMemoryGetPayload,
  WsMemoryGetResult as WsMemoryGetResultT,
  WsMemoryListPayload,
  WsMemoryListResult as WsMemoryListResultT,
  WsMemorySearchPayload,
  WsMemorySearchResult as WsMemorySearchResultT,
  WsMemoryUpdatePayload,
  WsMemoryUpdateResult as WsMemoryUpdateResultT,
  WsPairingApprovePayload,
  WsPairingDenyPayload,
  WsPairingResolveResult as WsPairingResolveResultT,
  WsPairingRevokePayload,
  WsPeerRole,
  WsPlanUpdateEvent,
  WsPresenceBeaconPayload,
  WsPresenceBeaconResult as WsPresenceBeaconResultT,
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsSessionCompactPayload,
  WsSessionCompactResult as WsSessionCompactResultT,
  WsSessionCreatePayload,
  WsSessionCreateResult as WsSessionCreateResultT,
  WsSessionDeletePayload,
  WsSessionDeleteResult as WsSessionDeleteResultT,
  WsSessionGetPayload,
  WsSessionGetResult as WsSessionGetResultT,
  WsSessionListPayload,
  WsSessionListResult as WsSessionListResultT,
  WsSessionSendPayload,
  WsSessionSendResult as WsSessionSendResultT,
  WsSubagentClosePayload,
  WsSubagentCloseResult as WsSubagentCloseResultT,
  WsSubagentGetPayload,
  WsSubagentGetResult as WsSubagentGetResultT,
  WsSubagentListPayload,
  WsSubagentListResult as WsSubagentListResultT,
  WsSubagentSendPayload,
  WsSubagentSendResult as WsSubagentSendResultT,
  WsSubagentSpawnPayload,
  WsSubagentSpawnResult as WsSubagentSpawnResultT,
  WsWorkArtifactCreatePayload,
  WsWorkArtifactCreateResult as WsWorkArtifactCreateResultT,
  WsWorkArtifactGetPayload,
  WsWorkArtifactGetResult as WsWorkArtifactGetResultT,
  WsWorkArtifactListPayload,
  WsWorkArtifactListResult as WsWorkArtifactListResultT,
  WsWorkCreatePayload,
  WsWorkCreateResult as WsWorkCreateResultT,
  WsWorkDecisionCreatePayload,
  WsWorkDecisionCreateResult as WsWorkDecisionCreateResultT,
  WsWorkDecisionGetPayload,
  WsWorkDecisionGetResult as WsWorkDecisionGetResultT,
  WsWorkDecisionListPayload,
  WsWorkDecisionListResult as WsWorkDecisionListResultT,
  WsWorkGetPayload,
  WsWorkGetResult as WsWorkGetResultT,
  WsWorkLinkCreatePayload,
  WsWorkLinkCreateResult as WsWorkLinkCreateResultT,
  WsWorkLinkListPayload,
  WsWorkLinkListResult as WsWorkLinkListResultT,
  WsWorkListPayload,
  WsWorkListResult as WsWorkListResultT,
  WsWorkSignalCreatePayload,
  WsWorkSignalCreateResult as WsWorkSignalCreateResultT,
  WsWorkSignalGetPayload,
  WsWorkSignalGetResult as WsWorkSignalGetResultT,
  WsWorkSignalListPayload,
  WsWorkSignalListResult as WsWorkSignalListResultT,
  WsWorkSignalUpdatePayload,
  WsWorkSignalUpdateResult as WsWorkSignalUpdateResultT,
  WsWorkStateKvGetPayload,
  WsWorkStateKvGetResult as WsWorkStateKvGetResultT,
  WsWorkStateKvListPayload,
  WsWorkStateKvListResult as WsWorkStateKvListResultT,
  WsWorkStateKvSetPayload,
  WsWorkStateKvSetResult as WsWorkStateKvSetResultT,
  WsWorkTransitionPayload,
  WsWorkTransitionResult as WsWorkTransitionResultT,
  WsWorkUpdatePayload,
  WsWorkUpdateResult as WsWorkUpdateResultT,
  WsWorkflowCancelPayload,
  WsWorkflowCancelResult as WsWorkflowCancelResultT,
  WsWorkflowResumePayload,
  WsWorkflowResumeResult as WsWorkflowResumeResultT,
  WsWorkflowRunPayload,
  WsWorkflowRunResult as WsWorkflowRunResultT,
} from "@tyrum/schemas";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
  WsApprovalDecision,
  WsApprovalRequest,
  WsApprovalListResult,
  WsApprovalResolveResult,
  WsEvent,
  WsPairingResolveResult,
  WsPresenceBeaconResult,
  WsSessionCompactResult,
  WsSessionCreateResult,
  WsSessionDeleteResult,
  WsSessionGetResult,
  WsSessionListResult,
  WsSessionSendResult,
  WsSubagentClosePayload as WsSubagentClosePayloadSchema,
  WsSubagentCloseResult,
  WsSubagentGetPayload as WsSubagentGetPayloadSchema,
  WsSubagentGetResult,
  WsSubagentListPayload as WsSubagentListPayloadSchema,
  WsSubagentListResult,
  WsSubagentSendPayload as WsSubagentSendPayloadSchema,
  WsSubagentSendResult,
  WsSubagentSpawnPayload as WsSubagentSpawnPayloadSchema,
  WsSubagentSpawnResult,
  WsWorkflowCancelResult,
  WsWorkflowResumeResult,
  WsWorkflowRunResult,
  WsMemoryCreateResult,
  WsMemoryDeleteResult,
  WsMemoryExportResult,
  WsMemoryForgetResult,
  WsMemoryGetResult,
  WsMemoryListResult,
  WsMemorySearchResult,
  WsMemoryUpdateResult,
  WsWorkArtifactCreateResult,
  WsWorkArtifactGetResult,
  WsWorkArtifactListResult,
  WsCommandExecuteResult,
  WsConnectInitResult,
  WsConnectProofResult,
  WsError,
  WsMessageEnvelope,
  WsTaskExecuteRequest,
  WsTaskExecuteResult,
  WsWorkCreateResult,
  WsWorkDecisionCreateResult,
  WsWorkDecisionGetResult,
  WsWorkDecisionListResult,
  WsWorkGetResult,
  WsWorkLinkCreateResult,
  WsWorkLinkListResult,
  WsWorkListResult,
  WsWorkSignalCreateResult,
  WsWorkSignalGetResult,
  WsWorkSignalListResult,
  WsWorkSignalUpdateResult,
  WsWorkStateKvGetResult,
  WsWorkStateKvListResult,
  WsWorkStateKvSetResult,
  WsWorkTransitionResult,
  WsWorkUpdateResult,
} from "@tyrum/schemas";
import {
  buildConnectProofTranscript,
  computeDeviceIdFromPublicKeyDer,
  createDeviceIdentity,
  fromBase64Url,
  formatDeviceIdentityError,
  signProofWithPrivateKey,
} from "./device-identity.js";
import { loadNodePinnedTransportModule } from "./node/load-pinned-transport.js";
import { normalizeFingerprint256 } from "./tls/fingerprint.js";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TyrumClientOptions {
  /** Full WebSocket URL, e.g. ws://host/ws */
  url: string;
  /** Auth token sent via WebSocket subprotocol metadata. */
  token: string;
  /**
   * Optional TLS certificate pinning for `wss://` connections (Node only).
   *
   * The value is the server certificate's SHA-256 fingerprint, as hex (with or
   * without `:`), case-insensitive. When set, the client will refuse to
   * connect if the remote certificate does not match. Standard TLS verification
   * (CA trust + hostname) still applies by default.
   */
  tlsCertFingerprint256?: string;
  /**
   * When `true`, allows connecting to self-signed TLS certificates when
   * `tlsCertFingerprint256` is configured, by skipping CA verification and
   * relying on the configured fingerprint (plus hostname validation).
   *
   * This is intended for IP-only deployments where using a public CA isn't
   * possible. Verify the fingerprint out-of-band before trusting it.
   */
  tlsAllowSelfSigned?: boolean;
  /**
   * Optional PEM-encoded CA certificate(s) used for Node.js `wss://` TLS
   * verification when `tlsCertFingerprint256` is enabled.
   *
   * Use this for private PKI / self-signed deployments, or configure your OS /
   * Node trust store instead.
   */
  tlsCaCertPem?: string;
  /** Capabilities to advertise in the hello handshake. */
  capabilities: ClientCapability[];
  /** Peer role for vNext handshake. Defaults to `client`. */
  role?: WsPeerRole;
  /** Protocol revision for vNext handshake. Defaults to 2. */
  protocolRev?: number;
  /**
   * Ed25519 key material for vNext handshake (DER, base64url).
   *
   * - `publicKey`: SPKI DER (base64url)
   * - `privateKey`: PKCS8 DER (base64url)
   */
  device?: {
    publicKey: string;
    privateKey: string;
    deviceId?: string;
    label?: string;
    platform?: string;
    version?: string;
    mode?: string;
  };
  /** Whether to auto-reconnect on unexpected close. Defaults to `true`. */
  reconnect?: boolean;
  /** Base reconnect retry delay in milliseconds. Defaults to 5 000. */
  reconnectBaseDelayMs?: number;
  /** Upper bound for reconnect retry delay in milliseconds. Defaults to 30 000. */
  maxReconnectDelay?: number;
  /**
   * Maximum number of recent event ids to keep for deduplication.
   * Defaults to 1000.
   */
  maxSeenEventIds?: number;
  /**
   * Maximum number of recent inbound request ids to keep for retry replay.
   *
   * This bounds memory usage for cached responses (for example task evidence).
   * Defaults to 1000.
   */
  maxSeenRequestIds?: number;
  /**
   * When `true`, emit a rate-limited warning for malformed inbound frames.
   * Defaults to `false`.
   */
  debugProtocol?: boolean;
  /**
   * Optional callback for malformed inbound WebSocket frames.
   *
   * Reports are rate-limited to avoid noisy logs or callback storms.
   */
  onProtocolError?: (info: TyrumClientProtocolErrorInfo) => void;
}

type GeneratedDevice = {
  publicKey: string;
  privateKey: string;
  deviceId: string;
};

type ResolvedConnectDevice = GeneratedDevice & {
  label?: string;
  platform?: string;
  version?: string;
  mode?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RECONNECT_DELAY = 30_000;
const DEFAULT_RECONNECT_BASE_DELAY = 5_000;
const DEFAULT_MAX_SEEN_EVENT_IDS = 1_000;
const DEFAULT_MAX_SEEN_REQUEST_IDS = 1_000;
const DEFAULT_PROTOCOL_ERROR_REPORT_INTERVAL_MS = 5_000;
const MAX_PROTOCOL_ERROR_RAW_LENGTH = 512;
const WS_BASE_PROTOCOL = "tyrum-v1";
const WS_AUTH_PROTOCOL_PREFIX = "tyrum-auth.";
const DEFAULT_PROTOCOL_REV = 2;
const TERMINAL_RECONNECT_CLOSE_CODES = new Set<number>([4005, 4006, 4007, 4008]);

const WS_ACK_RESULT = {
  safeParse: (
    input: unknown,
  ):
    | { success: true; data: void }
    | {
        success: false;
        error: { message: string };
      } => {
    if (input === undefined) {
      return { success: true, data: undefined };
    }
    if (
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      Object.keys(input).length === 0
    ) {
      return { success: true, data: undefined };
    }
    return {
      success: false,
      error: { message: "expected an empty result" },
    };
  },
};

function toOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toBase64UrlUtf8(value: string): string {
  // Node runtime path.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf-8").toString("base64url");
  }

  // Browser runtime path.
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function truncateProtocolErrorRaw(raw: string): string {
  if (raw.length <= MAX_PROTOCOL_ERROR_RAW_LENGTH) {
    return raw;
  }
  const suffix = `... [truncated ${raw.length - MAX_PROTOCOL_ERROR_RAW_LENGTH} chars]`;
  return `${raw.slice(0, MAX_PROTOCOL_ERROR_RAW_LENGTH)}${suffix}`;
}

function formatCloseReason(code: number, reason: string): string {
  const trimmedReason = reason.trim();
  return trimmedReason.length > 0
    ? `WebSocket closed with ${code} (${trimmedReason}).`
    : `WebSocket closed with ${code}.`;
}

function getTerminalReconnectMessage(code: number, reason: string, token: string): string | null {
  if (TERMINAL_RECONNECT_CLOSE_CODES.has(code)) {
    const closeReason = formatCloseReason(code, reason);
    switch (code) {
      case 4005:
        return `${closeReason} Check the client and gateway protocol revisions before reconnecting.`;
      case 4006:
        return `${closeReason} Check the configured device_id and device key pair before reconnecting.`;
      case 4007:
        return `${closeReason} Check the configured device private key before reconnecting.`;
      case 4008:
        return `${closeReason} Check that the scoped token matches this device before reconnecting.`;
      default:
        return closeReason;
    }
  }

  if (code === 4001 && token.trim().length > 0) {
    return `${formatCloseReason(code, reason)} Refresh or replace the configured token before reconnecting.`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class TyrumClient {
  private readonly emitter: Emitter<TyrumClientEvents>;
  private readonly opts: TyrumClientOptions & {
    reconnect: boolean;
    reconnectBaseDelayMs: number;
    maxReconnectDelay: number;
    maxSeenEventIds: number;
    maxSeenRequestIds: number;
    debugProtocol: boolean;
    role: WsPeerRole;
    protocolRev: number;
  };

  private ws: WebSocket | null = null;
  private ready = false;
  private clientId: string | null = null;
  private seenEventIds = new Set<string>();
  private seenEventIdOrder: string[] = [];
  private inboundRequestInFlight = new Set<string>();
  private inboundRequestResponses = new Map<string, WsResponseEnvelope>();
  private pending = new Map<
    string,
    { resolve: (msg: WsResponseEnvelope) => void; reject: (err: Error) => void }
  >();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private connectionAttempt = 0;
  private transportErrorHint: string | null = null;
  private suppressReconnect = false;
  private generatedDevice: GeneratedDevice | null = null;
  private generatedDevicePromise: Promise<GeneratedDevice> | null = null;
  private suppressedProtocolErrors = 0;
  private nextProtocolErrorReportAtMs = 0;

  constructor(options: TyrumClientOptions) {
    this.emitter = mitt<TyrumClientEvents>();
    this.opts = {
      debugProtocol: false,
      role: "client",
      protocolRev: DEFAULT_PROTOCOL_REV,
      reconnect: true,
      reconnectBaseDelayMs: DEFAULT_RECONNECT_BASE_DELAY,
      maxReconnectDelay: DEFAULT_MAX_RECONNECT_DELAY,
      maxSeenEventIds: DEFAULT_MAX_SEEN_EVENT_IDS,
      maxSeenRequestIds: DEFAULT_MAX_SEEN_REQUEST_IDS,
      ...options,
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Whether the underlying WebSocket is currently open. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.ready && this.clientId !== null;
  }

  /** Subscribe to a typed event. */
  on<K extends keyof TyrumClientEvents>(
    event: K,
    handler: (data: TyrumClientEvents[K]) => void,
  ): void {
    this.emitter.on(event, handler);
  }

  /** Unsubscribe from a typed event. */
  off<K extends keyof TyrumClientEvents>(
    event: K,
    handler: (data: TyrumClientEvents[K]) => void,
  ): void {
    this.emitter.off(event, handler);
  }

  /** Open the WebSocket connection and send the `hello` handshake. */
  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  /** Gracefully close the connection (no auto-reconnect). */
  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
    this.ready = false;
    this.clientId = null;
    this.rejectPending(new Error("WebSocket disconnected"));
  }

  /** Respond to a task.execute request from the gateway. */
  respondTaskExecute(
    requestId: string,
    success: boolean,
    result?: unknown,
    evidence?: unknown,
    error?: string,
  ): void {
    const response: WsResponseEnvelope = success
      ? {
          request_id: requestId,
          type: "task.execute",
          ok: true,
          result: WsTaskExecuteResult.parse({ result, evidence }),
        }
      : {
          request_id: requestId,
          type: "task.execute",
          ok: false,
          error: WsError.parse({
            code: "task_failed",
            message: error ?? "task failed",
            details: { evidence },
          }),
        };
    this.cacheInboundRequestResponse("task.execute", requestId, response);
    this.send(response);
  }

  /** Respond to an approval.request from the gateway. */
  respondApprovalRequest(requestId: string, approved: boolean, reason?: string): void {
    const response: WsResponseEnvelope = {
      request_id: requestId,
      type: "approval.request",
      ok: true,
      result: WsApprovalDecision.parse({ approved, reason }),
    };
    this.cacheInboundRequestResponse("approval.request", requestId, response);
    this.send(response);
  }

  /** List approvals via WS control-plane request (requires gateway support). */
  approvalList(payload: WsApprovalListPayload = { limit: 100 }): Promise<WsApprovalListResultT> {
    return this.request("approval.list", payload, WsApprovalListResult);
  }

  /** Resolve an approval via WS control-plane request (requires gateway support). */
  approvalResolve(payload: WsApprovalResolvePayload): Promise<WsApprovalResolveResultT> {
    return this.request("approval.resolve", payload, WsApprovalResolveResult);
  }

  /** Execute a slash-command via WS control-plane request (gateway-handled). */
  commandExecute(
    command: string,
    context?: Omit<WsCommandExecutePayloadT, "command">,
  ): Promise<WsCommandExecuteResultT> {
    const payload = context ? { command, ...context } : { command };
    return this.request("command.execute", payload, WsCommandExecuteResult);
  }

  /** Send a protocol-level health-check ping request to the gateway. */
  ping(): Promise<void> {
    return this.requestVoid("ping", {});
  }

  /** Send a message into a session and receive assistant output. */
  sessionSend(payload: WsSessionSendPayload): Promise<WsSessionSendResultT> {
    return this.request("session.send", payload, WsSessionSendResult);
  }

  /** List chat sessions (threads) for an agent/channel. */
  sessionList(payload: WsSessionListPayload = {}): Promise<WsSessionListResultT> {
    return this.request("session.list", payload, WsSessionListResult);
  }

  /** Fetch a single session transcript by id. */
  sessionGet(payload: WsSessionGetPayload): Promise<WsSessionGetResultT> {
    return this.request("session.get", payload, WsSessionGetResult);
  }

  /** Create a new session (thread). */
  sessionCreate(payload: WsSessionCreatePayload = {}): Promise<WsSessionCreateResultT> {
    return this.request("session.create", payload, WsSessionCreateResult);
  }

  /** Compact a session transcript, folding dropped turns into summary. */
  sessionCompact(payload: WsSessionCompactPayload): Promise<WsSessionCompactResultT> {
    return this.request("session.compact", payload, WsSessionCompactResult);
  }

  /** Delete a session and associated overrides/best-effort runtime cleanup. */
  sessionDelete(payload: WsSessionDeletePayload): Promise<WsSessionDeleteResultT> {
    return this.request("session.delete", payload, WsSessionDeleteResult);
  }

  /** Start a workflow run. */
  workflowRun(payload: WsWorkflowRunPayload): Promise<WsWorkflowRunResultT> {
    return this.request("workflow.run", payload, WsWorkflowRunResult);
  }

  /** Resume a paused workflow run. */
  workflowResume(payload: WsWorkflowResumePayload): Promise<WsWorkflowResumeResultT> {
    return this.request("workflow.resume", payload, WsWorkflowResumeResult);
  }

  /** Cancel a workflow run. */
  workflowCancel(payload: WsWorkflowCancelPayload): Promise<WsWorkflowCancelResultT> {
    return this.request("workflow.cancel", payload, WsWorkflowCancelResult);
  }

  /** Approve a pending node pairing request. */
  pairingApprove(payload: WsPairingApprovePayload): Promise<WsPairingResolveResultT> {
    return this.request("pairing.approve", payload, WsPairingResolveResult);
  }

  /** Deny a pending node pairing request. */
  pairingDeny(payload: WsPairingDenyPayload): Promise<WsPairingResolveResultT> {
    return this.request("pairing.deny", payload, WsPairingResolveResult);
  }

  /** Revoke an existing node pairing. */
  pairingRevoke(payload: WsPairingRevokePayload): Promise<WsPairingResolveResultT> {
    return this.request("pairing.revoke", payload, WsPairingResolveResult);
  }

  /** Publish client presence information and receive the normalized entry. */
  presenceBeacon(payload: WsPresenceBeaconPayload): Promise<WsPresenceBeaconResultT> {
    return this.request("presence.beacon", payload, WsPresenceBeaconResult);
  }

  /** Report capability readiness (node flows). */
  capabilityReady(payload: WsCapabilityReadyPayload): Promise<void> {
    return this.requestVoid("capability.ready", payload);
  }

  /** Report attempt evidence (node flows). */
  attemptEvidence(payload: WsAttemptEvidencePayload): Promise<void> {
    return this.requestVoid("attempt.evidence", payload);
  }

  // -----------------------------------------------------------------------
  // WorkBoard helpers
  // -----------------------------------------------------------------------

  workList(payload: WsWorkListPayload): Promise<WsWorkListResultT> {
    return this.request("work.list", payload, WsWorkListResult);
  }

  workGet(payload: WsWorkGetPayload): Promise<WsWorkGetResultT> {
    return this.request("work.get", payload, WsWorkGetResult);
  }

  workCreate(payload: WsWorkCreatePayload): Promise<WsWorkCreateResultT> {
    return this.request("work.create", payload, WsWorkCreateResult);
  }

  workUpdate(payload: WsWorkUpdatePayload): Promise<WsWorkUpdateResultT> {
    return this.request("work.update", payload, WsWorkUpdateResult);
  }

  workTransition(payload: WsWorkTransitionPayload): Promise<WsWorkTransitionResultT> {
    return this.request("work.transition", payload, WsWorkTransitionResult);
  }

  workLinkCreate(payload: WsWorkLinkCreatePayload): Promise<WsWorkLinkCreateResultT> {
    return this.request("work.link.create", payload, WsWorkLinkCreateResult);
  }

  workLinkList(payload: WsWorkLinkListPayload): Promise<WsWorkLinkListResultT> {
    return this.request("work.link.list", payload, WsWorkLinkListResult);
  }

  workArtifactList(payload: WsWorkArtifactListPayload): Promise<WsWorkArtifactListResultT> {
    return this.request("work.artifact.list", payload, WsWorkArtifactListResult);
  }

  workArtifactGet(payload: WsWorkArtifactGetPayload): Promise<WsWorkArtifactGetResultT> {
    return this.request("work.artifact.get", payload, WsWorkArtifactGetResult);
  }

  workArtifactCreate(payload: WsWorkArtifactCreatePayload): Promise<WsWorkArtifactCreateResultT> {
    return this.request("work.artifact.create", payload, WsWorkArtifactCreateResult);
  }

  workDecisionList(payload: WsWorkDecisionListPayload): Promise<WsWorkDecisionListResultT> {
    return this.request("work.decision.list", payload, WsWorkDecisionListResult);
  }

  workDecisionGet(payload: WsWorkDecisionGetPayload): Promise<WsWorkDecisionGetResultT> {
    return this.request("work.decision.get", payload, WsWorkDecisionGetResult);
  }

  workDecisionCreate(payload: WsWorkDecisionCreatePayload): Promise<WsWorkDecisionCreateResultT> {
    return this.request("work.decision.create", payload, WsWorkDecisionCreateResult);
  }

  workSignalList(payload: WsWorkSignalListPayload): Promise<WsWorkSignalListResultT> {
    return this.request("work.signal.list", payload, WsWorkSignalListResult);
  }

  workSignalGet(payload: WsWorkSignalGetPayload): Promise<WsWorkSignalGetResultT> {
    return this.request("work.signal.get", payload, WsWorkSignalGetResult);
  }

  workSignalCreate(payload: WsWorkSignalCreatePayload): Promise<WsWorkSignalCreateResultT> {
    return this.request("work.signal.create", payload, WsWorkSignalCreateResult);
  }

  workSignalUpdate(payload: WsWorkSignalUpdatePayload): Promise<WsWorkSignalUpdateResultT> {
    return this.request("work.signal.update", payload, WsWorkSignalUpdateResult);
  }

  workStateKvGet(payload: WsWorkStateKvGetPayload): Promise<WsWorkStateKvGetResultT> {
    return this.request("work.state_kv.get", payload, WsWorkStateKvGetResult);
  }

  workStateKvList(payload: WsWorkStateKvListPayload): Promise<WsWorkStateKvListResultT> {
    return this.request("work.state_kv.list", payload, WsWorkStateKvListResult);
  }

  workStateKvSet(payload: WsWorkStateKvSetPayload): Promise<WsWorkStateKvSetResultT> {
    return this.request("work.state_kv.set", payload, WsWorkStateKvSetResult);
  }

  // -----------------------------------------------------------------------
  // Memory helpers
  // -----------------------------------------------------------------------

  memorySearch(payload: WsMemorySearchPayload): Promise<WsMemorySearchResultT> {
    return this.request("memory.search", payload, WsMemorySearchResult);
  }

  memoryList(payload: WsMemoryListPayload): Promise<WsMemoryListResultT> {
    return this.request("memory.list", payload, WsMemoryListResult);
  }

  memoryGet(payload: WsMemoryGetPayload): Promise<WsMemoryGetResultT> {
    return this.request("memory.get", payload, WsMemoryGetResult);
  }

  memoryCreate(payload: WsMemoryCreatePayload): Promise<WsMemoryCreateResultT> {
    return this.request("memory.create", payload, WsMemoryCreateResult);
  }

  memoryUpdate(payload: WsMemoryUpdatePayload): Promise<WsMemoryUpdateResultT> {
    return this.request("memory.update", payload, WsMemoryUpdateResult);
  }

  memoryDelete(payload: WsMemoryDeletePayload): Promise<WsMemoryDeleteResultT> {
    return this.request("memory.delete", payload, WsMemoryDeleteResult);
  }

  memoryForget(payload: WsMemoryForgetPayload): Promise<WsMemoryForgetResultT> {
    return this.request("memory.forget", payload, WsMemoryForgetResult);
  }

  memoryExport(payload: WsMemoryExportPayload): Promise<WsMemoryExportResultT> {
    return this.request("memory.export", payload, WsMemoryExportResult);
  }

  // -----------------------------------------------------------------------
  // Subagent helpers
  // -----------------------------------------------------------------------

  async subagentSpawn(payload: WsSubagentSpawnPayload): Promise<WsSubagentSpawnResultT> {
    const parsed = this.parsePayload("subagent.spawn", payload, WsSubagentSpawnPayloadSchema);
    return this.request("subagent.spawn", parsed, WsSubagentSpawnResult);
  }

  async subagentList(payload: WsSubagentListPayload): Promise<WsSubagentListResultT> {
    const parsed = this.parsePayload("subagent.list", payload, WsSubagentListPayloadSchema);
    return this.request("subagent.list", parsed, WsSubagentListResult);
  }

  async subagentGet(payload: WsSubagentGetPayload): Promise<WsSubagentGetResultT> {
    const parsed = this.parsePayload("subagent.get", payload, WsSubagentGetPayloadSchema);
    return this.request("subagent.get", parsed, WsSubagentGetResult);
  }

  async subagentSend(payload: WsSubagentSendPayload): Promise<WsSubagentSendResultT> {
    const parsed = this.parsePayload("subagent.send", payload, WsSubagentSendPayloadSchema);
    return this.request("subagent.send", parsed, WsSubagentSendResult);
  }

  async subagentClose(payload: WsSubagentClosePayload): Promise<WsSubagentCloseResultT> {
    const parsed = this.parsePayload("subagent.close", payload, WsSubagentClosePayloadSchema);
    return this.request("subagent.close", parsed, WsSubagentCloseResult);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private parsePayload<T>(
    type: string,
    payload: unknown,
    schema: {
      safeParse: (
        input: unknown,
      ) => { success: true; data: T } | { success: false; error: { message: string } };
    },
  ): T {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`${type} invalid payload: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  private buildProtocols(): string[] {
    const token = this.opts.token;
    if (token.trim().length === 0) {
      return [WS_BASE_PROTOCOL];
    }
    return [WS_BASE_PROTOCOL, `${WS_AUTH_PROTOCOL_PREFIX}${toBase64UrlUtf8(token)}`];
  }

  private destroyPinnedDispatcher(ws: WebSocket): void {
    const anyWs = ws as unknown as { __tyrumDispatcher?: { destroy?: () => unknown } | null };
    const dispatcher = anyWs.__tyrumDispatcher;
    if (!dispatcher || typeof dispatcher.destroy !== "function") return;
    anyWs.__tyrumDispatcher = null;
    void loadNodePinnedTransportModule(".")
      .then((module) => module.destroyPinnedNodeDispatcher(dispatcher as any))
      .catch(() => {});
  }

  private openSocket(): void {
    this.ready = false;
    this.clientId = null;
    this.transportErrorHint = null;
    this.suppressReconnect = false;
    this.resetProtocolErrorReporting();
    const attempt = ++this.connectionAttempt;
    void this.openSocketAttempt(attempt);
  }

  private async createWebSocket(): Promise<WebSocket> {
    const pinRaw = this.opts.tlsCertFingerprint256?.trim();
    const allowSelfSigned = Boolean(this.opts.tlsAllowSelfSigned);
    if (!pinRaw) {
      if (allowSelfSigned) {
        throw new Error("tlsAllowSelfSigned requires tlsCertFingerprint256.");
      }
      return new WebSocket(this.opts.url, this.buildProtocols());
    }

    const expected = normalizeFingerprint256(pinRaw);
    if (!expected) {
      throw new Error("Invalid tlsCertFingerprint256; expected a SHA-256 hex fingerprint.");
    }

    const url = new URL(this.opts.url);
    if (url.protocol !== "wss:") {
      throw new Error("tlsCertFingerprint256 requires a wss:// URL.");
    }

    const isNode =
      typeof process !== "undefined" &&
      typeof process.versions === "object" &&
      typeof process.versions.node === "string";
    if (!isNode) {
      throw new Error("tlsCertFingerprint256 is supported only in Node.js clients.");
    }

    const caCertPemRaw = typeof this.opts.tlsCaCertPem === "string" ? this.opts.tlsCaCertPem : "";
    const caCertPemTrimmed = caCertPemRaw.trim();
    const caCertPem = caCertPemTrimmed.length ? caCertPemTrimmed : undefined;
    const nodeTransport = await loadNodePinnedTransportModule(".");
    const { ws, dispatcher } = await nodeTransport.createPinnedNodeWebSocket({
      url: this.opts.url,
      protocols: this.buildProtocols(),
      pinRaw,
      expectedFingerprint256: expected,
      allowSelfSigned,
      caCertPem,
      onTransportError: (message) => {
        this.transportErrorHint = message;
      },
      onPinFailure: () => {
        this.suppressReconnect = true;
      },
    });
    (ws as unknown as { __tyrumDispatcher?: unknown }).__tyrumDispatcher = dispatcher;
    return ws;
  }

  private async openSocketAttempt(attempt: number): Promise<void> {
    let ws: WebSocket;
    try {
      ws = await this.createWebSocket();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitter.emit("transport_error", { message });
      return;
    }

    if (this.intentionalClose || attempt !== this.connectionAttempt) {
      ws.close(1000, "stale connect attempt");
      this.destroyPinnedDispatcher(ws);
      return;
    }

    this.ws = ws;

    ws.addEventListener("open", () => {
      this.sendConnect();
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      this.handleMessage(event.data as string);
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      const terminalReconnectMessage = getTerminalReconnectMessage(
        event.code,
        event.reason,
        this.opts.token,
      );
      if (terminalReconnectMessage) {
        this.suppressReconnect = true;
        this.emitter.emit("transport_error", { message: terminalReconnectMessage });
      }

      this.emitter.emit("disconnected", {
        code: event.code,
        reason: event.reason,
      });
      this.ws = null;
      this.ready = false;
      this.clientId = null;
      this.rejectPending(new Error("WebSocket disconnected"));
      const suppressReconnect = this.suppressReconnect;
      this.suppressReconnect = false;
      if (!this.intentionalClose && this.opts.reconnect && !suppressReconnect) {
        this.scheduleReconnect();
      }
      this.destroyPinnedDispatcher(ws);
    });

    // WebSocket errors surface as a close event; emit and await close to handle cleanup/reconnect.
    ws.addEventListener("error", (event) => {
      const anyEvent = event as unknown as { message?: unknown; error?: unknown };
      const eventErrorMessage =
        anyEvent.error instanceof Error && anyEvent.error.message.trim().length > 0
          ? anyEvent.error.message
          : null;
      const eventMessage =
        typeof anyEvent.message === "string" && anyEvent.message.trim().length > 0
          ? anyEvent.message
          : null;

      const message =
        eventErrorMessage ??
        eventMessage ??
        (this.transportErrorHint && this.transportErrorHint.trim().length > 0
          ? this.transportErrorHint
          : null) ??
        "WebSocket transport error";

      this.emitter.emit("transport_error", { message });
    });
  }

  private sendConnect(): void {
    void this.sendConnectWithDeviceProof();
  }

  private disconnectIfHandshakeSocketActive(handshakeWs: WebSocket): void {
    // Avoid disabling reconnect due to stale async handshake work that outlives
    // the socket it started on.
    if (this.ws !== handshakeWs || handshakeWs.readyState !== WebSocket.OPEN) {
      return;
    }
    this.disconnect();
  }

  private async sendConnectWithDeviceProof(): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      const device = await this.resolveConnectDevice();
      const pubkey = device.publicKey.trim();
      const privkey = device.privateKey.trim();
      if (!pubkey || !privkey) {
        this.disconnectIfHandshakeSocketActive(ws);
        return;
      }

      const deviceId = device.deviceId.trim();
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      const role = this.opts.role;
      const protocolRev = this.opts.protocolRev;

      const requestId = crypto.randomUUID();
      const request: WsRequestEnvelope = {
        request_id: requestId,
        type: "connect.init",
        payload: {
          protocol_rev: protocolRev,
          role,
          device: {
            device_id: deviceId,
            pubkey,
            label: toOptionalTrimmedString(device.label),
            platform: toOptionalTrimmedString(device.platform),
            version: toOptionalTrimmedString(device.version),
            mode: toOptionalTrimmedString(device.mode),
          },
          capabilities: this.opts.capabilities.map((capability) => ({
            id: descriptorIdForClientCapability(capability),
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          })),
        },
      };

      this.pending.set(requestId, {
        resolve: (msg) => {
          void this.handleConnectInitResponse(
            msg,
            {
              deviceId,
              role,
              protocolRev,
              privateKey: privkey,
            },
            ws,
          );
        },
        reject: () => {},
      });

      this.send(request);
    } catch (error) {
      this.emitter.emit("transport_error", { message: formatDeviceIdentityError(error) });
      this.disconnectIfHandshakeSocketActive(ws);
    }
  }

  private async resolveConnectDevice(): Promise<ResolvedConnectDevice> {
    const provided = this.opts.device;
    if (provided) {
      const pubkey = provided.publicKey.trim();
      const privkey = provided.privateKey.trim();
      if (!pubkey || !privkey) {
        throw new Error("TyrumClientOptions.device must include publicKey and privateKey");
      }
      if (provided.deviceId?.trim()) {
        return { ...provided, deviceId: provided.deviceId.trim() };
      }
      const pubkeyDer = fromBase64Url(pubkey);
      const computed = await computeDeviceIdFromPublicKeyDer(pubkeyDer);
      return { ...provided, deviceId: computed };
    }
    if (!this.generatedDevice) {
      if (!this.generatedDevicePromise) {
        this.generatedDevicePromise = createDeviceIdentity()
          .then((generatedDevice) => {
            this.generatedDevice = generatedDevice;
            return generatedDevice;
          })
          .catch((error) => {
            this.generatedDevicePromise = null;
            throw error;
          });
      }
      this.generatedDevice = await this.generatedDevicePromise;
    }
    return this.generatedDevice;
  }

  private async handleConnectInitResponse(
    msg: WsResponseEnvelope,
    ctx: { deviceId: string; role: WsPeerRole; protocolRev: number; privateKey: string },
    handshakeWs: WebSocket,
  ): Promise<void> {
    if (!msg.ok) {
      this.disconnectIfHandshakeSocketActive(handshakeWs);
      return;
    }
    const parsed = WsConnectInitResult.safeParse(msg.result ?? {});
    if (!parsed.success) {
      this.disconnectIfHandshakeSocketActive(handshakeWs);
      return;
    }

    try {
      const transcript = buildConnectProofTranscript({
        protocolRev: ctx.protocolRev,
        role: ctx.role,
        deviceId: ctx.deviceId,
        connectionId: parsed.data.connection_id,
        challenge: parsed.data.challenge,
      });
      const proof = await signProofWithPrivateKey(ctx.privateKey, transcript);
      if (this.ws !== handshakeWs || handshakeWs.readyState !== WebSocket.OPEN) {
        return;
      }

      const requestId = crypto.randomUUID();
      const request: WsRequestEnvelope = {
        request_id: requestId,
        type: "connect.proof",
        payload: { connection_id: parsed.data.connection_id, proof },
      };

      this.pending.set(requestId, {
        resolve: (msg2) => {
          if (this.ws !== handshakeWs) return;
          if (!msg2.ok) {
            this.disconnectIfHandshakeSocketActive(handshakeWs);
            return;
          }
          const parsed2 = WsConnectProofResult.safeParse(msg2.result ?? {});
          if (!parsed2.success) {
            this.disconnectIfHandshakeSocketActive(handshakeWs);
            return;
          }
          this.reconnectAttempt = 0;
          this.ready = true;
          this.clientId = parsed2.data.client_id;
          this.emitter.emit("connected", { clientId: parsed2.data.client_id });
        },
        reject: () => {},
      });

      this.send(request);
    } catch {
      this.disconnectIfHandshakeSocketActive(handshakeWs);
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private request<T>(
    type: string,
    payload: unknown,
    schema: {
      safeParse: (
        input: unknown,
      ) => { success: true; data: T } | { success: false; error: { message: string } };
    },
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("WebSocket is not connected"));
    }
    if (!this.ready) {
      return Promise.reject(new Error("WebSocket handshake not completed"));
    }

    const requestId = crypto.randomUUID();
    const request: WsRequestEnvelope = { request_id: requestId, type, payload };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${type} timed out`));
      }, timeoutMs);

      this.pending.set(requestId, {
        resolve: (msg) => {
          clearTimeout(timer);
          if (msg.type !== type) {
            reject(new Error(`${type} failed: mismatched response type ${msg.type}`));
            return;
          }
          if (!msg.ok) {
            reject(new Error(`${type} failed: ${msg.error.code}: ${msg.error.message}`));
            return;
          }
          const parsed = schema.safeParse(msg.result ?? {});
          if (!parsed.success) {
            reject(new Error(`${type} returned invalid result: ${parsed.error.message}`));
            return;
          }
          resolve(parsed.data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.send(request);
    });
  }

  private requestVoid(type: string, payload: unknown): Promise<void> {
    return this.request(type, payload, WS_ACK_RESULT);
  }

  private emitProtocolEvent(event: WsEventT): void {
    const eventType = event.type;
    this.emitter.emit(eventType, event);
    if (eventType === "plan.update") {
      this.emitter.emit("plan_update", event);
    }
  }

  private resetProtocolErrorReporting(): void {
    this.suppressedProtocolErrors = 0;
    this.nextProtocolErrorReportAtMs = 0;
  }

  private warnProtocolError(info: TyrumClientProtocolErrorInfo, rawLength: number): void {
    const errorSuffix = info.error ? ` (${info.error})` : "";
    const suppressedSuffix =
      info.suppressedCount > 0
        ? `; suppressed ${info.suppressedCount} similar frame${
            info.suppressedCount === 1 ? "" : "s"
          }`
        : "";
    console.warn(
      `[TyrumClient] protocol error ${info.kind}${suppressedSuffix}; raw_length=${rawLength}${errorSuffix}`,
    );
  }

  private reportProtocolError(
    kind: TyrumClientProtocolErrorKind,
    raw: string,
    error?: string,
  ): void {
    const now = Date.now();
    if (now < this.nextProtocolErrorReportAtMs) {
      this.suppressedProtocolErrors += 1;
      return;
    }

    const rawLength = raw.length;
    const info: TyrumClientProtocolErrorInfo = {
      kind,
      raw: truncateProtocolErrorRaw(raw),
      error: typeof error === "string" && error.trim().length > 0 ? error : undefined,
      suppressedCount: this.suppressedProtocolErrors,
    };

    this.suppressedProtocolErrors = 0;
    this.nextProtocolErrorReportAtMs = now + DEFAULT_PROTOCOL_ERROR_REPORT_INTERVAL_MS;

    this.emitter.emit("protocol_error", info);
    this.opts.onProtocolError?.(info);

    if (this.opts.debugProtocol) {
      this.warnProtocolError(info, rawLength);
    }
  }

  private handleMessage(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      this.reportProtocolError(
        "invalid_json",
        raw,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    const parsed = WsMessageEnvelope.safeParse(json);
    if (!parsed.success) {
      this.reportProtocolError("invalid_envelope", raw, parsed.error.message);
      return;
    }

    const msg = parsed.data;

    // Responses (to prior requests)
    if ("ok" in msg) {
      const pending = this.pending.get(msg.request_id);
      if (pending) {
        this.pending.delete(msg.request_id);
        pending.resolve(msg);
      }
      return;
    }

    // Events (server push)
    if ("event_id" in msg) {
      if (!this.markEventSeen(msg.event_id)) {
        return;
      }
      const evt = WsEvent.safeParse(msg);
      if (evt.success) {
        this.emitProtocolEvent(evt.data);
      }
      return;
    }

    // Requests (gateway -> client)
    switch (msg.type) {
      case "ping":
        // Protocol-level health check: acknowledge without affecting WS heartbeat state.
        this.send({
          request_id: msg.request_id,
          type: "ping",
          ok: true,
        } satisfies WsResponseEnvelope);
        return;

      case "task.execute": {
        const cached = this.getCachedInboundRequestResponse(msg.type, msg.request_id);
        if (cached) {
          this.send(cached);
          return;
        }
        if (!this.markInboundRequestPending(msg.type, msg.request_id)) return;

        const req = WsTaskExecuteRequest.safeParse(msg);
        if (req.success) {
          this.emitter.emit("task_execute", req.data);
        } else {
          const response: WsResponseEnvelope = {
            request_id: msg.request_id,
            type: msg.type,
            ok: false,
            error: WsError.parse({
              code: "invalid_request",
              message: req.error.message,
              details: { issues: req.error.issues },
            }),
          };
          this.cacheInboundRequestResponse("task.execute", msg.request_id, response);
          this.send(response);
        }
        return;
      }

      case "approval.request": {
        const cached = this.getCachedInboundRequestResponse(msg.type, msg.request_id);
        if (cached) {
          this.send(cached);
          return;
        }
        if (!this.markInboundRequestPending(msg.type, msg.request_id)) return;

        const req = WsApprovalRequest.safeParse(msg);
        if (req.success) {
          this.emitter.emit("approval_request", req.data);
        } else {
          const response: WsResponseEnvelope = {
            request_id: msg.request_id,
            type: msg.type,
            ok: false,
            error: WsError.parse({
              code: "invalid_request",
              message: req.error.message,
              details: { issues: req.error.issues },
            }),
          };
          this.cacheInboundRequestResponse("approval.request", msg.request_id, response);
          this.send(response);
        }
        return;
      }

      case "connect":
        // connect is client-initiated only
        this.send({
          request_id: msg.request_id,
          type: "connect",
          ok: false,
          error: { code: "unexpected_connect", message: "connect must be client-initiated" },
        } satisfies WsResponseEnvelope);
        return;

      case "connect.init":
      case "connect.proof":
        this.send({
          request_id: msg.request_id,
          type: msg.type,
          ok: false,
          error: { code: "unexpected_connect", message: `${msg.type} must be client-initiated` },
        } satisfies WsResponseEnvelope);
        return;
    }
  }

  private scheduleReconnect(): void {
    const attempt = this.reconnectAttempt + 1;
    const maxReconnectDelayMs = Math.max(0, this.opts.maxReconnectDelay);
    const reconnectBaseDelayMs = Math.max(0, this.opts.reconnectBaseDelayMs);
    const backoffDelayMs = Math.min(maxReconnectDelayMs, reconnectBaseDelayMs * 2 ** (attempt - 1));
    const delay = Math.min(backoffDelayMs, Math.floor(Math.random() * (backoffDelayMs + 1)));
    const nextRetryAtMs = Date.now() + delay;
    this.reconnectAttempt++;
    this.emitter.emit("reconnect_scheduled", {
      delayMs: delay,
      nextRetryAtMs,
      attempt,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectPending(err: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(err);
    }
    this.pending.clear();
  }

  private inboundRequestKey(type: string, requestId: string): string {
    return `${type}:${requestId}`;
  }

  private evictInboundRequestResponses(): void {
    const max = Math.max(1, this.opts.maxSeenRequestIds);
    while (this.inboundRequestResponses.size > max) {
      const oldest = this.inboundRequestResponses.keys().next().value as string | undefined;
      if (!oldest) break;
      this.inboundRequestResponses.delete(oldest);
    }
  }

  private markInboundRequestPending(type: string, requestId: string): boolean {
    const key = this.inboundRequestKey(type, requestId);
    if (this.inboundRequestInFlight.has(key)) return false;
    this.inboundRequestInFlight.add(key);
    return true;
  }

  private cacheInboundRequestResponse(
    type: string,
    requestId: string,
    response: WsResponseEnvelope,
  ): void {
    const key = this.inboundRequestKey(type, requestId);
    this.inboundRequestInFlight.delete(key);
    // Refresh insertion order so completed responses remain eligible for retries.
    this.inboundRequestResponses.delete(key);
    this.inboundRequestResponses.set(key, response);
    this.evictInboundRequestResponses();
  }

  private getCachedInboundRequestResponse(
    type: string,
    requestId: string,
  ): WsResponseEnvelope | undefined {
    const key = this.inboundRequestKey(type, requestId);
    const existing = this.inboundRequestResponses.get(key);
    if (existing !== undefined) {
      // Refresh insertion order on replay so hot retries remain in cache.
      this.inboundRequestResponses.delete(key);
      this.inboundRequestResponses.set(key, existing);
    }
    return existing;
  }

  private markEventSeen(eventId: string): boolean {
    if (this.seenEventIds.has(eventId)) return false;

    this.seenEventIds.add(eventId);
    this.seenEventIdOrder.push(eventId);

    const max = Math.max(1, this.opts.maxSeenEventIds);
    while (this.seenEventIdOrder.length > max) {
      const oldest = this.seenEventIdOrder.shift();
      if (oldest) {
        this.seenEventIds.delete(oldest);
      }
    }

    return true;
  }
}
