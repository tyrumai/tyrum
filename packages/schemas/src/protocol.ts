import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { CapabilityDescriptor, ClientCapability } from "./capability.js";
import { ActionPrimitive, ActionPrimitiveKind } from "./planner.js";
import { EventScope } from "./scope.js";
import {
  Approval,
  ApprovalListRequest,
  ApprovalListResponse,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
} from "./approval.js";
import { ArtifactRef } from "./artifact.js";
import { ExecutionAttempt, ExecutionBudgets, ExecutionRun, ExecutionStep } from "./execution.js";
import { NodePairingRequest, NodePairingTrustLevel } from "./node.js";
import { AgentId, Lane, TyrumKey } from "./keys.js";
import { PresenceBeacon, PresenceEntry } from "./presence.js";
import { PolicyOverride } from "./policy-bundle.js";

export {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  CapabilityDescriptor,
  ClientCapability,
  clientCapabilityFromDescriptorId,
  descriptorIdForClientCapability,
} from "./capability.js";

// ---------------------------------------------------------------------------
// WebSocket protocol (v1) — request/response envelopes + events
// ---------------------------------------------------------------------------

/**
 * Standard structured error for WS responses and error events.
 */
export const WsError = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  })
  .strict();
export type WsError = z.infer<typeof WsError>;

/**
 * Request envelope (direction-agnostic).
 *
 * A request always has:
 * - `request_id` for correlation (and retries/idempotency at higher layers)
 * - `type` identifying the operation
 * - `payload` with typed inputs for that operation
 */
export const WsRequestEnvelope = z
  .object({
    request_id: z.string().min(1),
    type: z.string().min(1),
    payload: z.unknown(),
    trace: z.unknown().optional(),
  })
  .strict();
export type WsRequestEnvelope = z.infer<typeof WsRequestEnvelope>;

export const WsResponseOkEnvelope = z
  .object({
    request_id: z.string().min(1),
    type: z.string().min(1),
    ok: z.literal(true),
    result: z.unknown().optional(),
  })
  .strict();
export type WsResponseOkEnvelope = z.infer<typeof WsResponseOkEnvelope>;

export const WsResponseErrEnvelope = z
  .object({
    request_id: z.string().min(1),
    type: z.string().min(1),
    ok: z.literal(false),
    error: WsError,
  })
  .strict();
export type WsResponseErrEnvelope = z.infer<typeof WsResponseErrEnvelope>;

/** Response envelope (direction-agnostic). */
export const WsResponseEnvelope = z.union([WsResponseOkEnvelope, WsResponseErrEnvelope]);
export type WsResponseEnvelope = z.infer<typeof WsResponseEnvelope>;

/** Event envelope (gateway-emitted server push). */
export const WsEventEnvelope = z
  .object({
    event_id: z.string().min(1),
    type: z.string().min(1),
    occurred_at: DateTimeSchema,
    scope: EventScope.optional(),
    payload: z.unknown(),
  })
  .strict();
export type WsEventEnvelope = z.infer<typeof WsEventEnvelope>;

/** Any WS message. */
export const WsMessageEnvelope = z.union([
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsEventEnvelope,
]);
export type WsMessageEnvelope = z.infer<typeof WsMessageEnvelope>;

// ---------------------------------------------------------------------------
// Operation payloads (typed)
// ---------------------------------------------------------------------------

export const WsPeerRole = z.enum(["client", "node"]);
export type WsPeerRole = z.infer<typeof WsPeerRole>;

export const WsDeviceDescriptor = z
  .object({
    device_id: z.string().trim().min(1),
    pubkey: z.string().trim().min(1),
    label: z.string().trim().min(1).optional(),
    platform: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    mode: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsDeviceDescriptor = z.infer<typeof WsDeviceDescriptor>;

export const WsConnectInitPayload = z
  .object({
    protocol_rev: z.number().int().min(1),
    role: WsPeerRole,
    device: WsDeviceDescriptor,
    capabilities: z.array(CapabilityDescriptor).default([]),
  })
  .strict();
export type WsConnectInitPayload = z.infer<typeof WsConnectInitPayload>;

export const WsConnectInitRequest = WsRequestEnvelope.extend({
  type: z.literal("connect.init"),
  payload: WsConnectInitPayload,
});
export type WsConnectInitRequest = z.infer<typeof WsConnectInitRequest>;

export const WsConnectInitResult = z
  .object({
    connection_id: z.string().trim().min(1),
    challenge: z.string().trim().min(1),
  })
  .strict();
export type WsConnectInitResult = z.infer<typeof WsConnectInitResult>;

export const WsConnectProofPayload = z
  .object({
    connection_id: z.string().trim().min(1),
    proof: z.string().trim().min(1),
  })
  .strict();
export type WsConnectProofPayload = z.infer<typeof WsConnectProofPayload>;

export const WsConnectProofRequest = WsRequestEnvelope.extend({
  type: z.literal("connect.proof"),
  payload: WsConnectProofPayload,
});
export type WsConnectProofRequest = z.infer<typeof WsConnectProofRequest>;

export const WsConnectProofResult = z
  .object({
    client_id: z.string().trim().min(1),
    device_id: z.string().trim().min(1),
    role: WsPeerRole,
  })
  .strict();
export type WsConnectProofResult = z.infer<typeof WsConnectProofResult>;

export const WsConnectPayload = z
  .object({
    capabilities: z.array(ClientCapability).default([]),
    client_id: z.string().min(1).optional(),
  })
  .strict();
export type WsConnectPayload = z.infer<typeof WsConnectPayload>;

export const WsConnectRequest = WsRequestEnvelope.extend({
  type: z.literal("connect"),
  payload: WsConnectPayload,
});
export type WsConnectRequest = z.infer<typeof WsConnectRequest>;

export const WsConnectResult = z
  .object({
    client_id: z.string().min(1),
  })
  .strict();
export type WsConnectResult = z.infer<typeof WsConnectResult>;

export const WsPingPayload = z.object({}).strict();
export type WsPingPayload = z.infer<typeof WsPingPayload>;

export const WsPingRequest = WsRequestEnvelope.extend({
  type: z.literal("ping"),
  payload: WsPingPayload,
});
export type WsPingRequest = z.infer<typeof WsPingRequest>;

export const WsTaskExecutePayload = z
  .object({
    plan_id: z.string().min(1),
    step_index: z.number().int().nonnegative(),
    action: ActionPrimitive,
  })
  .strict();
export type WsTaskExecutePayload = z.infer<typeof WsTaskExecutePayload>;

export const WsTaskExecuteRequest = WsRequestEnvelope.extend({
  type: z.literal("task.execute"),
  payload: WsTaskExecutePayload,
});
export type WsTaskExecuteRequest = z.infer<typeof WsTaskExecuteRequest>;

export const WsTaskExecuteResult = z
  .object({
    result: z.unknown().optional(),
    evidence: z.unknown().optional(),
  })
  .strict();
export type WsTaskExecuteResult = z.infer<typeof WsTaskExecuteResult>;

export const WsApprovalRequestPayload = z
  .object({
    approval_id: z.number().int().positive(),
    plan_id: z.string().min(1),
    step_index: z.number().int().nonnegative(),
    prompt: z.string().min(1),
    context: z.unknown().optional(),
    expires_at: DateTimeSchema.nullable().optional(),
  })
  .strict();
export type WsApprovalRequestPayload = z.infer<typeof WsApprovalRequestPayload>;

export const WsApprovalRequest = WsRequestEnvelope.extend({
  type: z.literal("approval.request"),
  payload: WsApprovalRequestPayload,
});
export type WsApprovalRequest = z.infer<typeof WsApprovalRequest>;

export const WsApprovalDecision = z
  .object({
    approved: z.boolean(),
    reason: z.string().optional(),
  })
  .strict();
export type WsApprovalDecision = z.infer<typeof WsApprovalDecision>;

export const WsApprovalListPayload = ApprovalListRequest;
export type WsApprovalListPayload = z.infer<typeof WsApprovalListPayload>;

export const WsApprovalListRequest = WsRequestEnvelope.extend({
  type: z.literal("approval.list"),
  payload: WsApprovalListPayload,
});
export type WsApprovalListRequest = z.infer<typeof WsApprovalListRequest>;

export const WsApprovalListResult = ApprovalListResponse;
export type WsApprovalListResult = z.infer<typeof WsApprovalListResult>;

export const WsApprovalResolvePayload = ApprovalResolveRequest;
export type WsApprovalResolvePayload = z.infer<typeof WsApprovalResolvePayload>;

export const WsApprovalResolveRequest = WsRequestEnvelope.extend({
  type: z.literal("approval.resolve"),
  payload: WsApprovalResolvePayload,
});
export type WsApprovalResolveRequest = z.infer<typeof WsApprovalResolveRequest>;

export const WsApprovalResolveResult = ApprovalResolveResponse;
export type WsApprovalResolveResult = z.infer<typeof WsApprovalResolveResult>;

export const WsSessionSendPayload = z
  .object({
    agent_id: AgentId.optional(),
    channel: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
    content: z.string().trim().min(1),
  })
  .strict();
export type WsSessionSendPayload = z.infer<typeof WsSessionSendPayload>;

export const WsSessionSendRequest = WsRequestEnvelope.extend({
  type: z.literal("session.send"),
  payload: WsSessionSendPayload,
});
export type WsSessionSendRequest = z.infer<typeof WsSessionSendRequest>;

export const WsSessionSendResult = z
  .object({
    session_id: z.string().trim().min(1),
    assistant_message: z.string(),
  })
  .strict();
export type WsSessionSendResult = z.infer<typeof WsSessionSendResult>;

export const WsCommandExecutePayload = z
  .object({
    command: z.string().trim().min(1),
  })
  .strict();
export type WsCommandExecutePayload = z.infer<typeof WsCommandExecutePayload>;

export const WsCommandExecuteRequest = WsRequestEnvelope.extend({
  type: z.literal("command.execute"),
  payload: WsCommandExecutePayload,
});
export type WsCommandExecuteRequest = z.infer<typeof WsCommandExecuteRequest>;

export const WsCommandExecuteResult = z
  .object({
    output: z.string(),
    data: z.unknown().optional(),
  })
  .strict();
export type WsCommandExecuteResult = z.infer<typeof WsCommandExecuteResult>;

export const WsWorkflowRunPayload = z
  .object({
    key: TyrumKey,
    lane: Lane.default("main"),
    plan_id: z.string().trim().min(1).optional(),
    request_id: z.string().trim().min(1).optional(),
    steps: z.array(ActionPrimitive).min(1),
    budgets: ExecutionBudgets.optional(),
  })
  .strict();
export type WsWorkflowRunPayload = z.infer<typeof WsWorkflowRunPayload>;

export const WsWorkflowRunRequest = WsRequestEnvelope.extend({
  type: z.literal("workflow.run"),
  payload: WsWorkflowRunPayload,
});
export type WsWorkflowRunRequest = z.infer<typeof WsWorkflowRunRequest>;

export const WsWorkflowRunResult = z
  .object({
    job_id: z.string().trim().min(1),
    run_id: z.string().trim().min(1),
    plan_id: z.string().trim().min(1),
    request_id: z.string().trim().min(1),
    key: TyrumKey,
    lane: Lane,
    steps_count: z.number().int().nonnegative(),
  })
  .strict();
export type WsWorkflowRunResult = z.infer<typeof WsWorkflowRunResult>;

export const WsWorkflowResumePayload = z
  .object({
    token: z.string().trim().min(1),
  })
  .strict();
export type WsWorkflowResumePayload = z.infer<typeof WsWorkflowResumePayload>;

export const WsWorkflowResumeRequest = WsRequestEnvelope.extend({
  type: z.literal("workflow.resume"),
  payload: WsWorkflowResumePayload,
});
export type WsWorkflowResumeRequest = z.infer<typeof WsWorkflowResumeRequest>;

export const WsWorkflowResumeResult = z
  .object({
    run_id: z.string().trim().min(1),
  })
  .strict();
export type WsWorkflowResumeResult = z.infer<typeof WsWorkflowResumeResult>;

export const WsWorkflowCancelPayload = z
  .object({
    run_id: z.string().trim().min(1),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsWorkflowCancelPayload = z.infer<typeof WsWorkflowCancelPayload>;

export const WsWorkflowCancelRequest = WsRequestEnvelope.extend({
  type: z.literal("workflow.cancel"),
  payload: WsWorkflowCancelPayload,
});
export type WsWorkflowCancelRequest = z.infer<typeof WsWorkflowCancelRequest>;

export const WsWorkflowCancelResult = z
  .object({
    run_id: z.string().trim().min(1),
    cancelled: z.boolean(),
  })
  .strict();
export type WsWorkflowCancelResult = z.infer<typeof WsWorkflowCancelResult>;

export const WsPairingApprovePayload = z
  .object({
    pairing_id: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
    trust_level: NodePairingTrustLevel.optional(),
    capability_allowlist: z.array(CapabilityDescriptor).optional(),
  })
  .strict();
export type WsPairingApprovePayload = z.infer<typeof WsPairingApprovePayload>;

export const WsPairingApproveRequest = WsRequestEnvelope.extend({
  type: z.literal("pairing.approve"),
  payload: WsPairingApprovePayload,
});
export type WsPairingApproveRequest = z.infer<typeof WsPairingApproveRequest>;

export const WsPairingDenyPayload = z
  .object({
    pairing_id: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsPairingDenyPayload = z.infer<typeof WsPairingDenyPayload>;

export const WsPairingDenyRequest = WsRequestEnvelope.extend({
  type: z.literal("pairing.deny"),
  payload: WsPairingDenyPayload,
});
export type WsPairingDenyRequest = z.infer<typeof WsPairingDenyRequest>;

export const WsPairingRevokePayload = z
  .object({
    pairing_id: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsPairingRevokePayload = z.infer<typeof WsPairingRevokePayload>;

export const WsPairingRevokeRequest = WsRequestEnvelope.extend({
  type: z.literal("pairing.revoke"),
  payload: WsPairingRevokePayload,
});
export type WsPairingRevokeRequest = z.infer<typeof WsPairingRevokeRequest>;

export const WsPairingResolveResult = z
  .object({
    pairing: NodePairingRequest,
  })
  .strict();
export type WsPairingResolveResult = z.infer<typeof WsPairingResolveResult>;

export const WsPresenceBeaconPayload = PresenceBeacon;
export type WsPresenceBeaconPayload = z.infer<typeof WsPresenceBeaconPayload>;

export const WsPresenceBeaconRequest = WsRequestEnvelope.extend({
  type: z.literal("presence.beacon"),
  payload: WsPresenceBeaconPayload,
});
export type WsPresenceBeaconRequest = z.infer<typeof WsPresenceBeaconRequest>;

export const WsPresenceBeaconResult = z
  .object({
    entry: PresenceEntry,
  })
  .strict();
export type WsPresenceBeaconResult = z.infer<typeof WsPresenceBeaconResult>;

// ---------------------------------------------------------------------------
// Operation responses (typed)
// ---------------------------------------------------------------------------

export const WsConnectInitResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("connect.init"),
  result: WsConnectInitResult,
});
export type WsConnectInitResponseOkEnvelope = z.infer<
  typeof WsConnectInitResponseOkEnvelope
>;

export const WsConnectInitResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("connect.init"),
});
export type WsConnectInitResponseErrEnvelope = z.infer<
  typeof WsConnectInitResponseErrEnvelope
>;

export const WsConnectInitResponseEnvelope = z.union([
  WsConnectInitResponseOkEnvelope,
  WsConnectInitResponseErrEnvelope,
]);
export type WsConnectInitResponseEnvelope = z.infer<
  typeof WsConnectInitResponseEnvelope
>;

export const WsConnectProofResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("connect.proof"),
  result: WsConnectProofResult,
});
export type WsConnectProofResponseOkEnvelope = z.infer<
  typeof WsConnectProofResponseOkEnvelope
>;

export const WsConnectProofResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("connect.proof"),
});
export type WsConnectProofResponseErrEnvelope = z.infer<
  typeof WsConnectProofResponseErrEnvelope
>;

export const WsConnectProofResponseEnvelope = z.union([
  WsConnectProofResponseOkEnvelope,
  WsConnectProofResponseErrEnvelope,
]);
export type WsConnectProofResponseEnvelope = z.infer<
  typeof WsConnectProofResponseEnvelope
>;

export const WsConnectResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("connect"),
  result: WsConnectResult,
});
export type WsConnectResponseOkEnvelope = z.infer<typeof WsConnectResponseOkEnvelope>;

export const WsConnectResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("connect"),
});
export type WsConnectResponseErrEnvelope = z.infer<typeof WsConnectResponseErrEnvelope>;

export const WsConnectResponseEnvelope = z.union([
  WsConnectResponseOkEnvelope,
  WsConnectResponseErrEnvelope,
]);
export type WsConnectResponseEnvelope = z.infer<typeof WsConnectResponseEnvelope>;

export const WsSessionSendResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("session.send"),
  result: WsSessionSendResult,
});
export type WsSessionSendResponseOkEnvelope = z.infer<
  typeof WsSessionSendResponseOkEnvelope
>;

export const WsSessionSendResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("session.send"),
});
export type WsSessionSendResponseErrEnvelope = z.infer<
  typeof WsSessionSendResponseErrEnvelope
>;

export const WsSessionSendResponseEnvelope = z.union([
  WsSessionSendResponseOkEnvelope,
  WsSessionSendResponseErrEnvelope,
]);
export type WsSessionSendResponseEnvelope = z.infer<
  typeof WsSessionSendResponseEnvelope
>;

export const WsWorkflowRunResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("workflow.run"),
  result: WsWorkflowRunResult,
});
export type WsWorkflowRunResponseOkEnvelope = z.infer<
  typeof WsWorkflowRunResponseOkEnvelope
>;

export const WsWorkflowRunResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("workflow.run"),
});
export type WsWorkflowRunResponseErrEnvelope = z.infer<
  typeof WsWorkflowRunResponseErrEnvelope
>;

export const WsWorkflowRunResponseEnvelope = z.union([
  WsWorkflowRunResponseOkEnvelope,
  WsWorkflowRunResponseErrEnvelope,
]);
export type WsWorkflowRunResponseEnvelope = z.infer<
  typeof WsWorkflowRunResponseEnvelope
>;

export const WsWorkflowResumeResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("workflow.resume"),
  result: WsWorkflowResumeResult,
});
export type WsWorkflowResumeResponseOkEnvelope = z.infer<
  typeof WsWorkflowResumeResponseOkEnvelope
>;

export const WsWorkflowResumeResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("workflow.resume"),
});
export type WsWorkflowResumeResponseErrEnvelope = z.infer<
  typeof WsWorkflowResumeResponseErrEnvelope
>;

export const WsWorkflowResumeResponseEnvelope = z.union([
  WsWorkflowResumeResponseOkEnvelope,
  WsWorkflowResumeResponseErrEnvelope,
]);
export type WsWorkflowResumeResponseEnvelope = z.infer<
  typeof WsWorkflowResumeResponseEnvelope
>;

export const WsWorkflowCancelResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("workflow.cancel"),
  result: WsWorkflowCancelResult,
});
export type WsWorkflowCancelResponseOkEnvelope = z.infer<
  typeof WsWorkflowCancelResponseOkEnvelope
>;

export const WsWorkflowCancelResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("workflow.cancel"),
});
export type WsWorkflowCancelResponseErrEnvelope = z.infer<
  typeof WsWorkflowCancelResponseErrEnvelope
>;

export const WsWorkflowCancelResponseEnvelope = z.union([
  WsWorkflowCancelResponseOkEnvelope,
  WsWorkflowCancelResponseErrEnvelope,
]);
export type WsWorkflowCancelResponseEnvelope = z.infer<
  typeof WsWorkflowCancelResponseEnvelope
>;

export const WsPairingApproveResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("pairing.approve"),
  result: WsPairingResolveResult,
});
export type WsPairingApproveResponseOkEnvelope = z.infer<
  typeof WsPairingApproveResponseOkEnvelope
>;

export const WsPairingApproveResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("pairing.approve"),
});
export type WsPairingApproveResponseErrEnvelope = z.infer<
  typeof WsPairingApproveResponseErrEnvelope
>;

export const WsPairingApproveResponseEnvelope = z.union([
  WsPairingApproveResponseOkEnvelope,
  WsPairingApproveResponseErrEnvelope,
]);
export type WsPairingApproveResponseEnvelope = z.infer<
  typeof WsPairingApproveResponseEnvelope
>;

export const WsPairingDenyResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("pairing.deny"),
  result: WsPairingResolveResult,
});
export type WsPairingDenyResponseOkEnvelope = z.infer<
  typeof WsPairingDenyResponseOkEnvelope
>;

export const WsPairingDenyResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("pairing.deny"),
});
export type WsPairingDenyResponseErrEnvelope = z.infer<
  typeof WsPairingDenyResponseErrEnvelope
>;

export const WsPairingDenyResponseEnvelope = z.union([
  WsPairingDenyResponseOkEnvelope,
  WsPairingDenyResponseErrEnvelope,
]);
export type WsPairingDenyResponseEnvelope = z.infer<
  typeof WsPairingDenyResponseEnvelope
>;

export const WsPairingRevokeResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("pairing.revoke"),
  result: WsPairingResolveResult,
});
export type WsPairingRevokeResponseOkEnvelope = z.infer<
  typeof WsPairingRevokeResponseOkEnvelope
>;

export const WsPairingRevokeResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("pairing.revoke"),
});
export type WsPairingRevokeResponseErrEnvelope = z.infer<
  typeof WsPairingRevokeResponseErrEnvelope
>;

export const WsPairingRevokeResponseEnvelope = z.union([
  WsPairingRevokeResponseOkEnvelope,
  WsPairingRevokeResponseErrEnvelope,
]);
export type WsPairingRevokeResponseEnvelope = z.infer<
  typeof WsPairingRevokeResponseEnvelope
>;

export const WsPresenceBeaconResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("presence.beacon"),
  result: WsPresenceBeaconResult,
});
export type WsPresenceBeaconResponseOkEnvelope = z.infer<
  typeof WsPresenceBeaconResponseOkEnvelope
>;

export const WsPresenceBeaconResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("presence.beacon"),
});
export type WsPresenceBeaconResponseErrEnvelope = z.infer<
  typeof WsPresenceBeaconResponseErrEnvelope
>;

export const WsPresenceBeaconResponseEnvelope = z.union([
  WsPresenceBeaconResponseOkEnvelope,
  WsPresenceBeaconResponseErrEnvelope,
]);
export type WsPresenceBeaconResponseEnvelope = z.infer<
  typeof WsPresenceBeaconResponseEnvelope
>;

export const WsPingResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("ping"),
});
export type WsPingResponseOkEnvelope = z.infer<typeof WsPingResponseOkEnvelope>;

export const WsPingResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("ping"),
});
export type WsPingResponseErrEnvelope = z.infer<typeof WsPingResponseErrEnvelope>;

export const WsPingResponseEnvelope = z.union([
  WsPingResponseOkEnvelope,
  WsPingResponseErrEnvelope,
]);
export type WsPingResponseEnvelope = z.infer<typeof WsPingResponseEnvelope>;

export const WsTaskExecuteResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("task.execute"),
  result: WsTaskExecuteResult,
});
export type WsTaskExecuteResponseOkEnvelope = z.infer<
  typeof WsTaskExecuteResponseOkEnvelope
>;

export const WsTaskExecuteResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("task.execute"),
});
export type WsTaskExecuteResponseErrEnvelope = z.infer<
  typeof WsTaskExecuteResponseErrEnvelope
>;

export const WsTaskExecuteResponseEnvelope = z.union([
  WsTaskExecuteResponseOkEnvelope,
  WsTaskExecuteResponseErrEnvelope,
]);
export type WsTaskExecuteResponseEnvelope = z.infer<
  typeof WsTaskExecuteResponseEnvelope
>;

export const WsApprovalRequestResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("approval.request"),
  result: WsApprovalDecision,
});
export type WsApprovalRequestResponseOkEnvelope = z.infer<
  typeof WsApprovalRequestResponseOkEnvelope
>;

export const WsApprovalRequestResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("approval.request"),
});
export type WsApprovalRequestResponseErrEnvelope = z.infer<
  typeof WsApprovalRequestResponseErrEnvelope
>;

export const WsApprovalRequestResponseEnvelope = z.union([
  WsApprovalRequestResponseOkEnvelope,
  WsApprovalRequestResponseErrEnvelope,
]);
export type WsApprovalRequestResponseEnvelope = z.infer<
  typeof WsApprovalRequestResponseEnvelope
>;

export const WsApprovalListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("approval.list"),
  result: WsApprovalListResult,
});
export type WsApprovalListResponseOkEnvelope = z.infer<
  typeof WsApprovalListResponseOkEnvelope
>;

export const WsApprovalListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("approval.list"),
});
export type WsApprovalListResponseErrEnvelope = z.infer<
  typeof WsApprovalListResponseErrEnvelope
>;

export const WsApprovalListResponseEnvelope = z.union([
  WsApprovalListResponseOkEnvelope,
  WsApprovalListResponseErrEnvelope,
]);
export type WsApprovalListResponseEnvelope = z.infer<
  typeof WsApprovalListResponseEnvelope
>;

export const WsApprovalResolveResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("approval.resolve"),
  result: WsApprovalResolveResult,
});
export type WsApprovalResolveResponseOkEnvelope = z.infer<
  typeof WsApprovalResolveResponseOkEnvelope
>;

export const WsApprovalResolveResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("approval.resolve"),
});
export type WsApprovalResolveResponseErrEnvelope = z.infer<
  typeof WsApprovalResolveResponseErrEnvelope
>;

export const WsApprovalResolveResponseEnvelope = z.union([
  WsApprovalResolveResponseOkEnvelope,
  WsApprovalResolveResponseErrEnvelope,
]);
export type WsApprovalResolveResponseEnvelope = z.infer<
  typeof WsApprovalResolveResponseEnvelope
>;

export const WsResponse = z.union([
  WsConnectInitResponseOkEnvelope,
  WsConnectInitResponseErrEnvelope,
  WsConnectProofResponseOkEnvelope,
  WsConnectProofResponseErrEnvelope,
  WsConnectResponseOkEnvelope,
  WsConnectResponseErrEnvelope,
  WsSessionSendResponseOkEnvelope,
  WsSessionSendResponseErrEnvelope,
  WsWorkflowRunResponseOkEnvelope,
  WsWorkflowRunResponseErrEnvelope,
  WsWorkflowResumeResponseOkEnvelope,
  WsWorkflowResumeResponseErrEnvelope,
  WsWorkflowCancelResponseOkEnvelope,
  WsWorkflowCancelResponseErrEnvelope,
  WsPairingApproveResponseOkEnvelope,
  WsPairingApproveResponseErrEnvelope,
  WsPairingDenyResponseOkEnvelope,
  WsPairingDenyResponseErrEnvelope,
  WsPairingRevokeResponseOkEnvelope,
  WsPairingRevokeResponseErrEnvelope,
  WsPresenceBeaconResponseOkEnvelope,
  WsPresenceBeaconResponseErrEnvelope,
  WsPingResponseOkEnvelope,
  WsPingResponseErrEnvelope,
  WsTaskExecuteResponseOkEnvelope,
  WsTaskExecuteResponseErrEnvelope,
  WsApprovalRequestResponseOkEnvelope,
  WsApprovalRequestResponseErrEnvelope,
  WsApprovalListResponseOkEnvelope,
  WsApprovalListResponseErrEnvelope,
  WsApprovalResolveResponseOkEnvelope,
  WsApprovalResolveResponseErrEnvelope,
]);
export type WsResponse = z.infer<typeof WsResponse>;

export const WsPlanUpdatePayload = z
  .object({
    plan_id: z.string().min(1),
    status: z.string().min(1),
    detail: z.string().optional(),
  })
  .strict();
export type WsPlanUpdatePayload = z.infer<typeof WsPlanUpdatePayload>;

export const WsPlanUpdateEvent = WsEventEnvelope.extend({
  type: z.literal("plan.update"),
  payload: WsPlanUpdatePayload,
});
export type WsPlanUpdateEvent = z.infer<typeof WsPlanUpdateEvent>;

export const WsApprovalRequestedEventPayload = z
  .object({
    approval: Approval,
  })
  .strict();
export type WsApprovalRequestedEventPayload = z.infer<typeof WsApprovalRequestedEventPayload>;

export const WsApprovalRequestedEvent = WsEventEnvelope.extend({
  type: z.literal("approval.requested"),
  payload: WsApprovalRequestedEventPayload,
});
export type WsApprovalRequestedEvent = z.infer<typeof WsApprovalRequestedEvent>;

export const WsApprovalResolvedEventPayload = z
  .object({
    approval: Approval,
  })
  .strict();
export type WsApprovalResolvedEventPayload = z.infer<typeof WsApprovalResolvedEventPayload>;

export const WsApprovalResolvedEvent = WsEventEnvelope.extend({
  type: z.literal("approval.resolved"),
  payload: WsApprovalResolvedEventPayload,
});
export type WsApprovalResolvedEvent = z.infer<typeof WsApprovalResolvedEvent>;

export const WsRunUpdatedEventPayload = z
  .object({
    run: ExecutionRun,
  })
  .strict();
export type WsRunUpdatedEventPayload = z.infer<typeof WsRunUpdatedEventPayload>;

export const WsRunUpdatedEvent = WsEventEnvelope.extend({
  type: z.literal("run.updated"),
  payload: WsRunUpdatedEventPayload,
});
export type WsRunUpdatedEvent = z.infer<typeof WsRunUpdatedEvent>;

export const WsStepUpdatedEventPayload = z
  .object({
    step: ExecutionStep,
  })
  .strict();
export type WsStepUpdatedEventPayload = z.infer<typeof WsStepUpdatedEventPayload>;

export const WsStepUpdatedEvent = WsEventEnvelope.extend({
  type: z.literal("step.updated"),
  payload: WsStepUpdatedEventPayload,
});
export type WsStepUpdatedEvent = z.infer<typeof WsStepUpdatedEvent>;

export const WsAttemptUpdatedEventPayload = z
  .object({
    attempt: ExecutionAttempt,
  })
  .strict();
export type WsAttemptUpdatedEventPayload = z.infer<typeof WsAttemptUpdatedEventPayload>;

export const WsAttemptUpdatedEvent = WsEventEnvelope.extend({
  type: z.literal("attempt.updated"),
  payload: WsAttemptUpdatedEventPayload,
});
export type WsAttemptUpdatedEvent = z.infer<typeof WsAttemptUpdatedEvent>;

export const WsArtifactCreatedEventPayload = z
  .object({
    artifact: ArtifactRef,
  })
  .strict();
export type WsArtifactCreatedEventPayload = z.infer<typeof WsArtifactCreatedEventPayload>;

export const WsArtifactCreatedEvent = WsEventEnvelope.extend({
  type: z.literal("artifact.created"),
  payload: WsArtifactCreatedEventPayload,
});
export type WsArtifactCreatedEvent = z.infer<typeof WsArtifactCreatedEvent>;

export const WsPairingRequestedEventPayload = z
  .object({
    pairing: NodePairingRequest,
  })
  .strict();
export type WsPairingRequestedEventPayload = z.infer<typeof WsPairingRequestedEventPayload>;

export const WsPairingRequestedEvent = WsEventEnvelope.extend({
  type: z.literal("pairing.requested"),
  payload: WsPairingRequestedEventPayload,
});
export type WsPairingRequestedEvent = z.infer<typeof WsPairingRequestedEvent>;

export const WsPairingResolvedEventPayload = z
  .object({
    pairing: NodePairingRequest,
  })
  .strict();
export type WsPairingResolvedEventPayload = z.infer<typeof WsPairingResolvedEventPayload>;

export const WsPairingResolvedEvent = WsEventEnvelope.extend({
  type: z.literal("pairing.resolved"),
  payload: WsPairingResolvedEventPayload,
});
export type WsPairingResolvedEvent = z.infer<typeof WsPairingResolvedEvent>;

export const WsPresenceUpsertedEventPayload = z
  .object({
    entry: PresenceEntry,
  })
  .strict();
export type WsPresenceUpsertedEventPayload = z.infer<typeof WsPresenceUpsertedEventPayload>;

export const WsPresenceUpsertedEvent = WsEventEnvelope.extend({
  type: z.literal("presence.upserted"),
  payload: WsPresenceUpsertedEventPayload,
});
export type WsPresenceUpsertedEvent = z.infer<typeof WsPresenceUpsertedEvent>;

export const WsPresencePrunedEventPayload = z
  .object({
    instance_id: z.string().trim().min(1),
  })
  .strict();
export type WsPresencePrunedEventPayload = z.infer<typeof WsPresencePrunedEventPayload>;

export const WsPresencePrunedEvent = WsEventEnvelope.extend({
  type: z.literal("presence.pruned"),
  payload: WsPresencePrunedEventPayload,
});
export type WsPresencePrunedEvent = z.infer<typeof WsPresencePrunedEvent>;

export const WsPolicyOverrideCreatedEventPayload = z
  .object({
    override: PolicyOverride,
  })
  .strict();
export type WsPolicyOverrideCreatedEventPayload = z.infer<typeof WsPolicyOverrideCreatedEventPayload>;

export const WsPolicyOverrideCreatedEvent = WsEventEnvelope.extend({
  type: z.literal("policy_override.created"),
  payload: WsPolicyOverrideCreatedEventPayload,
});
export type WsPolicyOverrideCreatedEvent = z.infer<typeof WsPolicyOverrideCreatedEvent>;

export const WsPolicyOverrideRevokedEventPayload = z
  .object({
    override: PolicyOverride,
  })
  .strict();
export type WsPolicyOverrideRevokedEventPayload = z.infer<typeof WsPolicyOverrideRevokedEventPayload>;

export const WsPolicyOverrideRevokedEvent = WsEventEnvelope.extend({
  type: z.literal("policy_override.revoked"),
  payload: WsPolicyOverrideRevokedEventPayload,
});
export type WsPolicyOverrideRevokedEvent = z.infer<typeof WsPolicyOverrideRevokedEvent>;

export const WsErrorEventPayload = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type WsErrorEventPayload = z.infer<typeof WsErrorEventPayload>;

export const WsErrorEvent = WsEventEnvelope.extend({
  type: z.literal("error"),
  payload: WsErrorEventPayload,
});
export type WsErrorEvent = z.infer<typeof WsErrorEvent>;

export const WsRequest = z.discriminatedUnion("type", [
  WsConnectInitRequest,
  WsConnectProofRequest,
  WsConnectRequest,
  WsPresenceBeaconRequest,
  WsPingRequest,
  WsSessionSendRequest,
  WsCommandExecuteRequest,
  WsWorkflowRunRequest,
  WsWorkflowResumeRequest,
  WsWorkflowCancelRequest,
  WsPairingRevokeRequest,
  WsPairingApproveRequest,
  WsPairingDenyRequest,
  WsTaskExecuteRequest,
  WsApprovalRequest,
  WsApprovalListRequest,
  WsApprovalResolveRequest,
]);
export type WsRequest = z.infer<typeof WsRequest>;

export const WsEvent = z.discriminatedUnion("type", [
  WsPlanUpdateEvent,
  WsApprovalRequestedEvent,
  WsApprovalResolvedEvent,
  WsRunUpdatedEvent,
  WsStepUpdatedEvent,
  WsAttemptUpdatedEvent,
  WsArtifactCreatedEvent,
  WsPairingRequestedEvent,
  WsPairingResolvedEvent,
  WsPresenceUpsertedEvent,
  WsPresencePrunedEvent,
  WsPolicyOverrideCreatedEvent,
  WsPolicyOverrideRevokedEvent,
  WsErrorEvent,
]);
export type WsEvent = z.infer<typeof WsEvent>;

export const WsMessage = z.union([WsRequest, WsResponse, WsEvent]);
export type WsMessage = z.infer<typeof WsMessage>;

/** Maps ActionPrimitiveKind to the required client capability. */
const CAPABILITY_MAP: Partial<Record<ActionPrimitiveKind, ClientCapability>> = {
  Web: "playwright",
  Android: "android",
  Desktop: "desktop",
  CLI: "cli",
  Http: "http",
};

export function requiredCapability(
  kind: ActionPrimitiveKind,
): ClientCapability | undefined {
  return CAPABILITY_MAP[kind];
}
