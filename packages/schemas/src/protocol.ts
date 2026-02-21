import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { ActionPrimitive, ActionPrimitiveKind } from "./planner.js";
import { EventScope } from "./scope.js";
import { ClientCapability as ClientCapabilitySchema } from "./capabilities.js";
import { DeviceDescriptor } from "./device.js";
import { PresenceBeaconPayload, PresenceEntry } from "./presence.js";
import { Lane, NodeId, TyrumKey } from "./keys.js";
import { NodePairingRequest } from "./node.js";
import {
  ExecutionAttemptId,
  ExecutionRunId,
  ExecutionStepId,
} from "./execution.js";
import {
  Approval,
  ApprovalListRequest,
  ApprovalListResponse,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
} from "./approval.js";
import { PolicyOverride } from "./policy-overrides.js";

export const ClientCapability = ClientCapabilitySchema;
export type ClientCapability = z.infer<typeof ClientCapabilitySchema>;

// ---------------------------------------------------------------------------
// WebSocket protocol (v1) — request/response envelopes + events
// ---------------------------------------------------------------------------

/** Protocol revision negotiated during handshake within a major version. */
export const WS_PROTOCOL_REV = 1 as const;

/** Capability descriptor advertised during handshake. */
export const CapabilityName = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/,
    "capability name must be dot-separated lowercase segments",
  );
export type CapabilityName = z.infer<typeof CapabilityName>;

export const CapabilityDescriptor = z
  .object({
    name: CapabilityName,
    version: z.string().trim().min(1).optional(),
    metadata: z.unknown().optional(),
  })
  .strict();
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptor>;

export const PeerRole = z.enum(["client", "node"]);
export type PeerRole = z.infer<typeof PeerRole>;

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

export const WsConnectInitPayload = z
  .object({
    protocol_rev: z.number().int().nonnegative(),
    role: PeerRole,
    device: DeviceDescriptor,
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

export const WsConnectProofResult = z.object({}).strict();
export type WsConnectProofResult = z.infer<typeof WsConnectProofResult>;

export const WsPingPayload = z.object({}).strict();
export type WsPingPayload = z.infer<typeof WsPingPayload>;

export const WsPingRequest = WsRequestEnvelope.extend({
  type: z.literal("ping"),
  payload: WsPingPayload,
});
export type WsPingRequest = z.infer<typeof WsPingRequest>;

export const WsTaskExecutePayload = z
  .object({
    run_id: ExecutionRunId,
    step_id: ExecutionStepId,
    attempt_id: ExecutionAttemptId,
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

export const WsWorkflowResumePayload = z
  .object({
    resume_token: z.string().trim().min(1),
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
    run_id: ExecutionRunId,
  })
  .strict();
export type WsWorkflowResumeResult = z.infer<typeof WsWorkflowResumeResult>;

export const WsWorkflowCancelPayload = z
  .object({
    run_id: ExecutionRunId.optional(),
    resume_token: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.run_id && !value.resume_token) {
      ctx.addIssue({
        code: "custom",
        message: "workflow.cancel requires run_id or resume_token",
        path: ["run_id"],
      });
    }
  });
export type WsWorkflowCancelPayload = z.infer<typeof WsWorkflowCancelPayload>;

export const WsWorkflowCancelRequest = WsRequestEnvelope.extend({
  type: z.literal("workflow.cancel"),
  payload: WsWorkflowCancelPayload,
});
export type WsWorkflowCancelRequest = z.infer<typeof WsWorkflowCancelRequest>;

export const WsWorkflowCancelResult = z
  .object({
    run_id: ExecutionRunId,
  })
  .strict();
export type WsWorkflowCancelResult = z.infer<typeof WsWorkflowCancelResult>;

export const WsWorkflowRunPayload = z
  .object({
    key: TyrumKey,
    lane: Lane.default("main"),
    /**
     * Inline playbook YAML/JSON string, or an absolute file path to a playbook.yml.
     * The gateway compiles this into action primitives for the execution engine.
     */
    pipeline: z.string().trim().min(1),
    /** Optional JSON-encoded args payload passed to the workflow compiler. */
    args_json: z.string().optional(),
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
    run_id: ExecutionRunId,
    plan_id: z.string().trim().min(1),
  })
  .strict();
export type WsWorkflowRunResult = z.infer<typeof WsWorkflowRunResult>;

export const WsSessionSendPayload = z
  .object({
    channel: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
    message: z.string().trim().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
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
    reply: z.string(),
    session_id: z.string().trim().min(1),
    used_tools: z.array(z.string()).default([]),
    memory_written: z.boolean().default(false),
  })
  .strict();
export type WsSessionSendResult = z.infer<typeof WsSessionSendResult>;

export const WsPairingApprovePayload = z
  .object({
    node_id: NodeId,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsPairingApprovePayload = z.infer<typeof WsPairingApprovePayload>;

export const WsPairingApproveRequest = WsRequestEnvelope.extend({
  type: z.literal("pairing.approve"),
  payload: WsPairingApprovePayload,
});
export type WsPairingApproveRequest = z.infer<typeof WsPairingApproveRequest>;

export const WsPairingApproveResult = z
  .object({
    pairing: NodePairingRequest,
  })
  .strict();
export type WsPairingApproveResult = z.infer<typeof WsPairingApproveResult>;

export const WsPairingDenyPayload = z
  .object({
    node_id: NodeId,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsPairingDenyPayload = z.infer<typeof WsPairingDenyPayload>;

export const WsPairingDenyRequest = WsRequestEnvelope.extend({
  type: z.literal("pairing.deny"),
  payload: WsPairingDenyPayload,
});
export type WsPairingDenyRequest = z.infer<typeof WsPairingDenyRequest>;

export const WsPairingDenyResult = z
  .object({
    pairing: NodePairingRequest,
  })
  .strict();
export type WsPairingDenyResult = z.infer<typeof WsPairingDenyResult>;

export const WsPairingRevokePayload = z
  .object({
    node_id: NodeId,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsPairingRevokePayload = z.infer<typeof WsPairingRevokePayload>;

export const WsPairingRevokeRequest = WsRequestEnvelope.extend({
  type: z.literal("pairing.revoke"),
  payload: WsPairingRevokePayload,
});
export type WsPairingRevokeRequest = z.infer<typeof WsPairingRevokeRequest>;

export const WsPairingRevokeResult = z
  .object({
    pairing: NodePairingRequest,
  })
  .strict();
export type WsPairingRevokeResult = z.infer<typeof WsPairingRevokeResult>;

export const WsPresenceBeaconRequest = WsRequestEnvelope.extend({
  type: z.literal("presence.beacon"),
  payload: PresenceBeaconPayload,
});
export type WsPresenceBeaconRequest = z.infer<typeof WsPresenceBeaconRequest>;

// ---------------------------------------------------------------------------
// Operation responses (typed)
// ---------------------------------------------------------------------------

export const WsConnectInitResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("connect.init"),
  result: WsConnectInitResult,
});
export type WsConnectInitResponseOkEnvelope = z.infer<typeof WsConnectInitResponseOkEnvelope>;

export const WsConnectInitResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("connect.init"),
});
export type WsConnectInitResponseErrEnvelope = z.infer<typeof WsConnectInitResponseErrEnvelope>;

export const WsConnectInitResponseEnvelope = z.union([
  WsConnectInitResponseOkEnvelope,
  WsConnectInitResponseErrEnvelope,
]);
export type WsConnectInitResponseEnvelope = z.infer<typeof WsConnectInitResponseEnvelope>;

export const WsConnectProofResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("connect.proof"),
  result: WsConnectProofResult.optional(),
});
export type WsConnectProofResponseOkEnvelope = z.infer<typeof WsConnectProofResponseOkEnvelope>;

export const WsConnectProofResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("connect.proof"),
});
export type WsConnectProofResponseErrEnvelope = z.infer<typeof WsConnectProofResponseErrEnvelope>;

export const WsConnectProofResponseEnvelope = z.union([
  WsConnectProofResponseOkEnvelope,
  WsConnectProofResponseErrEnvelope,
]);
export type WsConnectProofResponseEnvelope = z.infer<typeof WsConnectProofResponseEnvelope>;

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

export const WsPairingApproveResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("pairing.approve"),
  result: WsPairingApproveResult,
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
  result: WsPairingDenyResult,
});
export type WsPairingDenyResponseOkEnvelope = z.infer<typeof WsPairingDenyResponseOkEnvelope>;

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
export type WsPairingDenyResponseEnvelope = z.infer<typeof WsPairingDenyResponseEnvelope>;

export const WsPairingRevokeResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("pairing.revoke"),
  result: WsPairingRevokeResult,
});
export type WsPairingRevokeResponseOkEnvelope = z.infer<typeof WsPairingRevokeResponseOkEnvelope>;

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

export const WsResponse = z.union([
  WsConnectInitResponseOkEnvelope,
  WsConnectInitResponseErrEnvelope,
  WsConnectProofResponseOkEnvelope,
  WsConnectProofResponseErrEnvelope,
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
  WsWorkflowResumeResponseOkEnvelope,
  WsWorkflowResumeResponseErrEnvelope,
  WsWorkflowCancelResponseOkEnvelope,
  WsWorkflowCancelResponseErrEnvelope,
  WsWorkflowRunResponseOkEnvelope,
  WsWorkflowRunResponseErrEnvelope,
  WsSessionSendResponseOkEnvelope,
  WsSessionSendResponseErrEnvelope,
  WsPairingApproveResponseOkEnvelope,
  WsPairingApproveResponseErrEnvelope,
  WsPairingDenyResponseOkEnvelope,
  WsPairingDenyResponseErrEnvelope,
  WsPairingRevokeResponseOkEnvelope,
  WsPairingRevokeResponseErrEnvelope,
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

export const WsPresenceUpsertPayload = z.object({ entry: PresenceEntry }).strict();
export type WsPresenceUpsertPayload = z.infer<typeof WsPresenceUpsertPayload>;

export const WsPresenceUpsertEvent = WsEventEnvelope.extend({
  type: z.literal("presence.upsert"),
  payload: WsPresenceUpsertPayload,
});
export type WsPresenceUpsertEvent = z.infer<typeof WsPresenceUpsertEvent>;

export const WsPresencePrunePayload = z.object({ instance_id: z.string().trim().min(1) }).strict();
export type WsPresencePrunePayload = z.infer<typeof WsPresencePrunePayload>;

export const WsPresencePruneEvent = WsEventEnvelope.extend({
  type: z.literal("presence.prune"),
  payload: WsPresencePrunePayload,
});
export type WsPresencePruneEvent = z.infer<typeof WsPresencePruneEvent>;

export const WsPairingRequestedPayload = z
  .object({ pairing: NodePairingRequest })
  .strict();
export type WsPairingRequestedPayload = z.infer<typeof WsPairingRequestedPayload>;

export const WsPairingRequestedEvent = WsEventEnvelope.extend({
  type: z.literal("pairing.requested"),
  payload: WsPairingRequestedPayload,
});
export type WsPairingRequestedEvent = z.infer<typeof WsPairingRequestedEvent>;

export const WsPairingResolvedPayload = z
  .object({ pairing: NodePairingRequest })
  .strict();
export type WsPairingResolvedPayload = z.infer<typeof WsPairingResolvedPayload>;

export const WsPairingResolvedEvent = WsEventEnvelope.extend({
  type: z.literal("pairing.resolved"),
  payload: WsPairingResolvedPayload,
});
export type WsPairingResolvedEvent = z.infer<typeof WsPairingResolvedEvent>;

export const WsPairingApprovedPayload = z
  .object({
    node_id: NodeId,
    scoped_token: z.string().trim().min(1),
    capabilities: z.array(ClientCapability).default([]),
  })
  .strict();
export type WsPairingApprovedPayload = z.infer<typeof WsPairingApprovedPayload>;

export const WsPairingApprovedEvent = WsEventEnvelope.extend({
  type: z.literal("pairing.approved"),
  payload: WsPairingApprovedPayload,
});
export type WsPairingApprovedEvent = z.infer<typeof WsPairingApprovedEvent>;

export const WsApprovalRequestedPayload = z
  .object({ approval: Approval })
  .strict();
export type WsApprovalRequestedPayload = z.infer<typeof WsApprovalRequestedPayload>;

export const WsApprovalRequestedEvent = WsEventEnvelope.extend({
  type: z.literal("approval.requested"),
  payload: WsApprovalRequestedPayload,
});
export type WsApprovalRequestedEvent = z.infer<typeof WsApprovalRequestedEvent>;

export const WsApprovalResolvedPayload = z
  .object({ approval: Approval })
  .strict();
export type WsApprovalResolvedPayload = z.infer<typeof WsApprovalResolvedPayload>;

export const WsApprovalResolvedEvent = WsEventEnvelope.extend({
  type: z.literal("approval.resolved"),
  payload: WsApprovalResolvedPayload,
});
export type WsApprovalResolvedEvent = z.infer<typeof WsApprovalResolvedEvent>;

export const WsPolicyOverrideCreatedPayload = z
  .object({ policy_override: PolicyOverride })
  .strict();
export type WsPolicyOverrideCreatedPayload = z.infer<typeof WsPolicyOverrideCreatedPayload>;

export const WsPolicyOverrideCreatedEvent = WsEventEnvelope.extend({
  type: z.literal("policy_override.created"),
  payload: WsPolicyOverrideCreatedPayload,
});
export type WsPolicyOverrideCreatedEvent = z.infer<typeof WsPolicyOverrideCreatedEvent>;

export const WsPolicyOverrideRevokedPayload = z
  .object({ policy_override: PolicyOverride })
  .strict();
export type WsPolicyOverrideRevokedPayload = z.infer<typeof WsPolicyOverrideRevokedPayload>;

export const WsPolicyOverrideRevokedEvent = WsEventEnvelope.extend({
  type: z.literal("policy_override.revoked"),
  payload: WsPolicyOverrideRevokedPayload,
});
export type WsPolicyOverrideRevokedEvent = z.infer<typeof WsPolicyOverrideRevokedEvent>;

export const WsPolicyOverrideExpiredPayload = z
  .object({ policy_override: PolicyOverride })
  .strict();
export type WsPolicyOverrideExpiredPayload = z.infer<typeof WsPolicyOverrideExpiredPayload>;

export const WsPolicyOverrideExpiredEvent = WsEventEnvelope.extend({
  type: z.literal("policy_override.expired"),
  payload: WsPolicyOverrideExpiredPayload,
});
export type WsPolicyOverrideExpiredEvent = z.infer<typeof WsPolicyOverrideExpiredEvent>;

export const WsRunPausedPayload = z
  .object({
    run_id: ExecutionRunId,
    reason: z.string().trim().min(1),
    detail: z.string().trim().min(1).optional(),
    approval_id: z.number().int().positive().optional(),
  })
  .strict();
export type WsRunPausedPayload = z.infer<typeof WsRunPausedPayload>;

export const WsRunPausedEvent = WsEventEnvelope.extend({
  type: z.literal("run.paused"),
  payload: WsRunPausedPayload,
});
export type WsRunPausedEvent = z.infer<typeof WsRunPausedEvent>;

export const WsRunResumedPayload = z
  .object({
    run_id: ExecutionRunId,
  })
  .strict();
export type WsRunResumedPayload = z.infer<typeof WsRunResumedPayload>;

export const WsRunResumedEvent = WsEventEnvelope.extend({
  type: z.literal("run.resumed"),
  payload: WsRunResumedPayload,
});
export type WsRunResumedEvent = z.infer<typeof WsRunResumedEvent>;

export const WsRunCancelledPayload = z
  .object({
    run_id: ExecutionRunId,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsRunCancelledPayload = z.infer<typeof WsRunCancelledPayload>;

export const WsRunCancelledEvent = WsEventEnvelope.extend({
  type: z.literal("run.cancelled"),
  payload: WsRunCancelledPayload,
});
export type WsRunCancelledEvent = z.infer<typeof WsRunCancelledEvent>;

export const WsRequest = z.discriminatedUnion("type", [
  WsConnectInitRequest,
  WsConnectProofRequest,
  WsPingRequest,
  WsSessionSendRequest,
  WsTaskExecuteRequest,
  WsApprovalRequest,
  WsApprovalListRequest,
  WsApprovalResolveRequest,
  WsWorkflowRunRequest,
  WsWorkflowResumeRequest,
  WsWorkflowCancelRequest,
  WsPairingApproveRequest,
  WsPairingDenyRequest,
  WsPairingRevokeRequest,
  WsPresenceBeaconRequest,
]);
export type WsRequest = z.infer<typeof WsRequest>;

export const WsEvent = z.discriminatedUnion("type", [
  WsPlanUpdateEvent,
  WsErrorEvent,
  WsPresenceUpsertEvent,
  WsPresencePruneEvent,
  WsPairingRequestedEvent,
  WsPairingApprovedEvent,
  WsPairingResolvedEvent,
  WsApprovalRequestedEvent,
  WsApprovalResolvedEvent,
  WsPolicyOverrideCreatedEvent,
  WsPolicyOverrideRevokedEvent,
  WsPolicyOverrideExpiredEvent,
  WsRunPausedEvent,
  WsRunResumedEvent,
  WsRunCancelledEvent,
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
