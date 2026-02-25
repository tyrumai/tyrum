import { z } from "zod";
import { ArtifactRef } from "../artifact.js";
import { DateTimeSchema } from "../common.js";
import { ContextReport } from "../context.js";
import { DeviceTokenClaims } from "../device-token.js";
import {
  ExecutionAttempt,
  ExecutionAttemptId,
  ExecutionRun,
  ExecutionRunId,
  ExecutionRunPausedPayload,
  ExecutionStep,
  ExecutionStepId,
} from "../execution.js";
import { AgentId, ChannelKey, Lane, NodeId, ThreadId, TyrumKey, WorkspaceId } from "../keys.js";
import { PolicyOverride, PolicySnapshotId } from "../policy-bundle.js";
import { ActionPrimitive } from "../planner.js";
import { PluginId } from "../plugin.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — execution
// ---------------------------------------------------------------------------

export const WsAttemptEvidencePayload = z
  .object({
    run_id: ExecutionRunId,
    step_id: ExecutionStepId,
    attempt_id: ExecutionAttemptId,
    evidence: z.unknown(),
  })
  .strict();
export type WsAttemptEvidencePayload = z.infer<typeof WsAttemptEvidencePayload>;

export const WsAttemptEvidenceRequest = WsRequestEnvelope.extend({
  type: z.literal("attempt.evidence"),
  payload: WsAttemptEvidencePayload,
});
export type WsAttemptEvidenceRequest = z.infer<typeof WsAttemptEvidenceRequest>;

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

// ---------------------------------------------------------------------------
// Operation responses (typed) — execution
// ---------------------------------------------------------------------------

export const WsAttemptEvidenceResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("attempt.evidence"),
});
export type WsAttemptEvidenceResponseOkEnvelope = z.infer<
  typeof WsAttemptEvidenceResponseOkEnvelope
>;

export const WsAttemptEvidenceResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("attempt.evidence"),
});
export type WsAttemptEvidenceResponseErrEnvelope = z.infer<
  typeof WsAttemptEvidenceResponseErrEnvelope
>;

export const WsAttemptEvidenceResponseEnvelope = z.union([
  WsAttemptEvidenceResponseOkEnvelope,
  WsAttemptEvidenceResponseErrEnvelope,
]);
export type WsAttemptEvidenceResponseEnvelope = z.infer<typeof WsAttemptEvidenceResponseEnvelope>;

export const WsTaskExecuteResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("task.execute"),
  result: WsTaskExecuteResult,
});
export type WsTaskExecuteResponseOkEnvelope = z.infer<typeof WsTaskExecuteResponseOkEnvelope>;

export const WsTaskExecuteResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("task.execute"),
});
export type WsTaskExecuteResponseErrEnvelope = z.infer<typeof WsTaskExecuteResponseErrEnvelope>;

export const WsTaskExecuteResponseEnvelope = z.union([
  WsTaskExecuteResponseOkEnvelope,
  WsTaskExecuteResponseErrEnvelope,
]);
export type WsTaskExecuteResponseEnvelope = z.infer<typeof WsTaskExecuteResponseEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed) — execution + telemetry
// ---------------------------------------------------------------------------

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

export const WsRunPausedEventPayload = ExecutionRunPausedPayload;
export type WsRunPausedEventPayload = z.infer<typeof WsRunPausedEventPayload>;

export const WsRunPausedEvent = WsEventEnvelope.extend({
  type: z.literal("run.paused"),
  payload: WsRunPausedEventPayload,
});
export type WsRunPausedEvent = z.infer<typeof WsRunPausedEvent>;

export const WsRunResumedEventPayload = z
  .object({
    run_id: ExecutionRunId,
  })
  .strict();
export type WsRunResumedEventPayload = z.infer<typeof WsRunResumedEventPayload>;

export const WsRunResumedEvent = WsEventEnvelope.extend({
  type: z.literal("run.resumed"),
  payload: WsRunResumedEventPayload,
});
export type WsRunResumedEvent = z.infer<typeof WsRunResumedEvent>;

export const WsRunCancelledEventPayload = z
  .object({
    run_id: ExecutionRunId,
    reason: z.string().optional(),
  })
  .strict();
export type WsRunCancelledEventPayload = z.infer<typeof WsRunCancelledEventPayload>;

export const WsRunCancelledEvent = WsEventEnvelope.extend({
  type: z.literal("run.cancelled"),
  payload: WsRunCancelledEventPayload,
});
export type WsRunCancelledEvent = z.infer<typeof WsRunCancelledEvent>;

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

export const WsArtifactAttachedEventPayload = z
  .object({
    artifact: ArtifactRef,
    step_id: ExecutionStepId,
    attempt_id: ExecutionAttemptId,
  })
  .strict();
export type WsArtifactAttachedEventPayload = z.infer<typeof WsArtifactAttachedEventPayload>;

export const WsArtifactAttachedEvent = WsEventEnvelope.extend({
  type: z.literal("artifact.attached"),
  payload: WsArtifactAttachedEventPayload,
});
export type WsArtifactAttachedEvent = z.infer<typeof WsArtifactAttachedEvent>;

export const WsArtifactFetchedBy = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("http"),
      request_id: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ws"),
      request_id: z.string().trim().min(1).optional(),
      client_id: z.string().trim().min(1).optional(),
      device_id: z.string().trim().min(1).optional(),
    })
    .strict(),
]);
export type WsArtifactFetchedBy = z.infer<typeof WsArtifactFetchedBy>;

export const WsArtifactFetchedEventPayload = z
  .object({
    artifact: ArtifactRef,
    fetched_by: WsArtifactFetchedBy,
  })
  .strict();
export type WsArtifactFetchedEventPayload = z.infer<typeof WsArtifactFetchedEventPayload>;

export const WsArtifactFetchedEvent = WsEventEnvelope.extend({
  type: z.literal("artifact.fetched"),
  payload: WsArtifactFetchedEventPayload,
});
export type WsArtifactFetchedEvent = z.infer<typeof WsArtifactFetchedEvent>;

export const WsAttemptEvidenceEventPayload = z
  .object({
    node_id: NodeId,
    run_id: ExecutionRunId,
    step_id: ExecutionStepId,
    attempt_id: ExecutionAttemptId,
    evidence: z.unknown(),
  })
  .strict();
export type WsAttemptEvidenceEventPayload = z.infer<typeof WsAttemptEvidenceEventPayload>;

export const WsAttemptEvidenceEvent = WsEventEnvelope.extend({
  type: z.literal("attempt.evidence"),
  payload: WsAttemptEvidenceEventPayload,
});
export type WsAttemptEvidenceEvent = z.infer<typeof WsAttemptEvidenceEvent>;

export const WsPolicyOverrideCreatedEventPayload = z
  .object({
    override: PolicyOverride,
  })
  .strict();
export type WsPolicyOverrideCreatedEventPayload = z.infer<
  typeof WsPolicyOverrideCreatedEventPayload
>;

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
export type WsPolicyOverrideRevokedEventPayload = z.infer<
  typeof WsPolicyOverrideRevokedEventPayload
>;

export const WsPolicyOverrideRevokedEvent = WsEventEnvelope.extend({
  type: z.literal("policy_override.revoked"),
  payload: WsPolicyOverrideRevokedEventPayload,
});
export type WsPolicyOverrideRevokedEvent = z.infer<typeof WsPolicyOverrideRevokedEvent>;

export const WsPolicyOverrideExpiredEventPayload = z
  .object({
    override: PolicyOverride,
  })
  .strict();
export type WsPolicyOverrideExpiredEventPayload = z.infer<
  typeof WsPolicyOverrideExpiredEventPayload
>;

export const WsPolicyOverrideExpiredEvent = WsEventEnvelope.extend({
  type: z.literal("policy_override.expired"),
  payload: WsPolicyOverrideExpiredEventPayload,
});
export type WsPolicyOverrideExpiredEvent = z.infer<typeof WsPolicyOverrideExpiredEvent>;

export const WsAuditLink = z
  .object({
    plan_id: z.string().min(1),
    step_index: z.number().int().nonnegative(),
    event_id: z.number().int().positive(),
  })
  .strict();
export type WsAuditLink = z.infer<typeof WsAuditLink>;

export const WsAuthFailedSurface = z.enum(["http", "ws.upgrade"]);
export type WsAuthFailedSurface = z.infer<typeof WsAuthFailedSurface>;

export const WsAuthFailedReason = z.enum(["missing_token", "invalid_token", "unauthorized"]);
export type WsAuthFailedReason = z.infer<typeof WsAuthFailedReason>;

export const WsAuthTokenTransport = z.enum([
  "authorization",
  "cookie",
  "query",
  "subprotocol",
  "missing",
]);
export type WsAuthTokenTransport = z.infer<typeof WsAuthTokenTransport>;

export const WsAuthFailedEventPayload = z
  .object({
    surface: WsAuthFailedSurface,
    reason: WsAuthFailedReason,
    token_transport: WsAuthTokenTransport,
    client_ip: z.string().trim().min(1).optional(),
    method: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    user_agent: z.string().trim().min(1).optional(),
    request_id: z.string().trim().min(1).optional(),
    audit: WsAuditLink,
  })
  .strict();
export type WsAuthFailedEventPayload = z.infer<typeof WsAuthFailedEventPayload>;

export const WsAuthFailedEvent = WsEventEnvelope.extend({
  type: z.literal("auth.failed"),
  payload: WsAuthFailedEventPayload,
});
export type WsAuthFailedEvent = z.infer<typeof WsAuthFailedEvent>;

export const WsAuthzDeniedSurface = z.enum(["http", "ws"]);
export type WsAuthzDeniedSurface = z.infer<typeof WsAuthzDeniedSurface>;

export const WsAuthzDeniedReason = z.enum(["insufficient_scope", "not_scope_authorized"]);
export type WsAuthzDeniedReason = z.infer<typeof WsAuthzDeniedReason>;

export const WsAuthzDeniedEventPayload = z
  .object({
    surface: WsAuthzDeniedSurface,
    reason: WsAuthzDeniedReason,
    token: DeviceTokenClaims,
    required_scopes: z.array(z.string().trim().min(1)).nullable(),
    method: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    request_type: z.string().trim().min(1).optional(),
    request_id: z.string().trim().min(1).optional(),
    client_ip: z.string().trim().min(1).optional(),
    client_id: z.string().trim().min(1).optional(),
    audit: WsAuditLink,
  })
  .strict();
export type WsAuthzDeniedEventPayload = z.infer<typeof WsAuthzDeniedEventPayload>;

export const WsAuthzDeniedEvent = WsEventEnvelope.extend({
  type: z.literal("authz.denied"),
  payload: WsAuthzDeniedEventPayload,
});
export type WsAuthzDeniedEvent = z.infer<typeof WsAuthzDeniedEvent>;

export const WsPluginLifecycleKind = z.enum(["loaded", "unloaded", "failed"]);
export type WsPluginLifecycleKind = z.infer<typeof WsPluginLifecycleKind>;

export const WsPluginLifecycleEventPayload = z
  .object({
    kind: WsPluginLifecycleKind,
    plugin: z
      .object({
        id: PluginId.optional(),
        name: z.string().trim().min(1).optional(),
        version: z.string().trim().min(1).optional(),
        source_kind: z.enum(["workspace", "user", "bundled"]),
        source_dir: z.string().trim().min(1),
        tools_count: z.number().int().nonnegative().optional(),
        commands_count: z.number().int().nonnegative().optional(),
        router: z.boolean().optional(),
      })
      .strict(),
    reason: z.string().trim().min(1).optional(),
    error: z.string().trim().min(1).optional(),
    audit: WsAuditLink,
  })
  .strict();
export type WsPluginLifecycleEventPayload = z.infer<typeof WsPluginLifecycleEventPayload>;

export const WsPluginLifecycleEvent = WsEventEnvelope.extend({
  type: z.literal("plugin.lifecycle"),
  payload: WsPluginLifecycleEventPayload,
});
export type WsPluginLifecycleEvent = z.infer<typeof WsPluginLifecycleEvent>;

export const WsPluginToolInvocationOutcome = z.enum(["succeeded", "failed"]);
export type WsPluginToolInvocationOutcome = z.infer<typeof WsPluginToolInvocationOutcome>;

export const WsPluginToolInvokedEventPayload = z
  .object({
    plugin_id: PluginId,
    plugin_version: z.string().trim().min(1),
    tool_id: z.string().trim().min(1),
    tool_call_id: z.string().trim().min(1),
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    session_id: z.string().trim().min(1).optional(),
    channel: ChannelKey.optional(),
    thread_id: ThreadId.optional(),
    policy_snapshot_id: PolicySnapshotId.optional(),
    outcome: WsPluginToolInvocationOutcome,
    duration_ms: z.number().int().nonnegative(),
    error: z.string().trim().min(1).optional(),
    audit: WsAuditLink,
  })
  .strict();
export type WsPluginToolInvokedEventPayload = z.infer<typeof WsPluginToolInvokedEventPayload>;

export const WsPluginToolInvokedEvent = WsEventEnvelope.extend({
  type: z.literal("plugin_tool.invoked"),
  payload: WsPluginToolInvokedEventPayload,
});
export type WsPluginToolInvokedEvent = z.infer<typeof WsPluginToolInvokedEvent>;

export const WsUsageScopeKind = z.enum(["run", "session", "agent", "deployment"]);
export type WsUsageScopeKind = z.infer<typeof WsUsageScopeKind>;

export const WsUsageScope = z
  .object({
    kind: WsUsageScopeKind,
    run_id: ExecutionRunId.nullable(),
    key: TyrumKey.nullable(),
    agent_id: AgentId.nullable(),
  })
  .strict();
export type WsUsageScope = z.infer<typeof WsUsageScope>;

export const WsUsageTotals = z
  .object({
    duration_ms: z.number().int().nonnegative(),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    usd_micros: z.number().int().nonnegative(),
  })
  .strict();
export type WsUsageTotals = z.infer<typeof WsUsageTotals>;

export const WsUsageSnapshotEventPayload = z
  .object({
    scope: WsUsageScope,
    local: z
      .object({
        totals: WsUsageTotals,
      })
      .strict(),
    provider: z.unknown().nullable(),
  })
  .strict();
export type WsUsageSnapshotEventPayload = z.infer<typeof WsUsageSnapshotEventPayload>;

export const WsUsageSnapshotEvent = WsEventEnvelope.extend({
  type: z.literal("usage.snapshot"),
  payload: WsUsageSnapshotEventPayload,
});
export type WsUsageSnapshotEvent = z.infer<typeof WsUsageSnapshotEvent>;

export const WsProviderUsageError = z
  .object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    detail: z.string().trim().min(1).optional(),
    retryable: z.boolean(),
  })
  .strict();
export type WsProviderUsageError = z.infer<typeof WsProviderUsageError>;

export const WsProviderUsageResult = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      provider: z.string().trim().min(1),
      profile_id: z.string().trim().min(1),
      cached: z.boolean(),
      polled_at: DateTimeSchema,
      data: z.unknown(),
    })
    .strict(),
  z
    .object({
      status: z.literal("error"),
      provider: z.string().trim().min(1).nullable(),
      profile_id: z.string().trim().min(1).nullable(),
      cached: z.boolean(),
      polled_at: DateTimeSchema.nullable(),
      error: WsProviderUsageError,
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      cached: z.boolean(),
      polled_at: DateTimeSchema.nullable(),
      error: WsProviderUsageError,
    })
    .strict(),
]);
export type WsProviderUsageResult = z.infer<typeof WsProviderUsageResult>;

export const WsProviderUsagePolledEventPayload = z
  .object({
    result: WsProviderUsageResult,
  })
  .strict();
export type WsProviderUsagePolledEventPayload = z.infer<typeof WsProviderUsagePolledEventPayload>;

export const WsProviderUsagePolledEvent = WsEventEnvelope.extend({
  type: z.literal("provider_usage.polled"),
  payload: WsProviderUsagePolledEventPayload,
});
export type WsProviderUsagePolledEvent = z.infer<typeof WsProviderUsagePolledEvent>;

export const WsContextReportCreatedEventPayload = z
  .object({
    run_id: ExecutionRunId,
    report: ContextReport,
  })
  .strict();
export type WsContextReportCreatedEventPayload = z.infer<typeof WsContextReportCreatedEventPayload>;

export const WsContextReportCreatedEvent = WsEventEnvelope.extend({
  type: z.literal("context_report.created"),
  payload: WsContextReportCreatedEventPayload,
});
export type WsContextReportCreatedEvent = z.infer<typeof WsContextReportCreatedEvent>;

export const WsRoutingConfigUpdatedEventPayload = z
  .object({
    revision: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
    config_sha256: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/, "config_sha256 must be a lowercase hex SHA-256")
      .optional(),
    reverted_from_revision: z.number().int().positive().optional(),
  })
  .strict();
export type WsRoutingConfigUpdatedEventPayload = z.infer<typeof WsRoutingConfigUpdatedEventPayload>;

export const WsRoutingConfigUpdatedEvent = WsEventEnvelope.extend({
  type: z.literal("routing.config.updated"),
  payload: WsRoutingConfigUpdatedEventPayload,
});
export type WsRoutingConfigUpdatedEvent = z.infer<typeof WsRoutingConfigUpdatedEvent>;

export const ChannelQueueOverflowPolicy = z.enum([
  "drop_oldest",
  "drop_newest",
  "summarize_dropped",
]);
export type ChannelQueueOverflowPolicy = z.infer<typeof ChannelQueueOverflowPolicy>;

export const WsChannelQueueOverflowEventPayload = z
  .object({
    key: TyrumKey,
    lane: Lane,
    cap: z.number().int().positive(),
    overflow: ChannelQueueOverflowPolicy,
    queued_before: z.number().int().nonnegative(),
    queued_after: z.number().int().nonnegative(),
    dropped_inbox_ids: z.array(z.number().int().positive()).default([]),
    dropped_message_ids: z.array(z.string().trim().min(1)).default([]),
    summary_inbox_id: z.number().int().positive().optional(),
    summary_message_id: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsChannelQueueOverflowEventPayload = z.infer<typeof WsChannelQueueOverflowEventPayload>;

export const WsChannelQueueOverflowEvent = WsEventEnvelope.extend({
  type: z.literal("channel.queue.overflow"),
  payload: WsChannelQueueOverflowEventPayload,
});
export type WsChannelQueueOverflowEvent = z.infer<typeof WsChannelQueueOverflowEvent>;

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
