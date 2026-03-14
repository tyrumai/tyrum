import { z } from "zod";
import { DateTimeSchema } from "../common.js";
import { ContextReport } from "../context.js";
import { DeviceTokenClaims } from "../device-token.js";
import { ExecutionRunId } from "../execution.js";
import { AgentId, ChannelKey, Lane, ThreadId, TyrumKey, WorkspaceId } from "../keys.js";
import { PolicyOverride, PolicySnapshotId } from "../policy-bundle.js";
import { PluginId } from "../plugin.js";
import { ToolLifecycleStatus } from "../tool-lifecycle.js";
import { WsEventEnvelope } from "./envelopes.js";

const wsEvent = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  WsEventEnvelope.extend({ type: z.literal(type), payload });
const WsPolicyOverrideEventPayload = z.object({ override: PolicyOverride }).strict();

// ---------------------------------------------------------------------------
// Events (typed) — policy overrides
// ---------------------------------------------------------------------------

export const WsPolicyOverrideCreatedEventPayload = WsPolicyOverrideEventPayload;
export type WsPolicyOverrideCreatedEventPayload = z.infer<
  typeof WsPolicyOverrideCreatedEventPayload
>;

export const WsPolicyOverrideCreatedEvent = wsEvent(
  "policy_override.created",
  WsPolicyOverrideCreatedEventPayload,
);
export type WsPolicyOverrideCreatedEvent = z.infer<typeof WsPolicyOverrideCreatedEvent>;

export const WsPolicyOverrideRevokedEventPayload = WsPolicyOverrideEventPayload;
export type WsPolicyOverrideRevokedEventPayload = z.infer<
  typeof WsPolicyOverrideRevokedEventPayload
>;

export const WsPolicyOverrideRevokedEvent = wsEvent(
  "policy_override.revoked",
  WsPolicyOverrideRevokedEventPayload,
);
export type WsPolicyOverrideRevokedEvent = z.infer<typeof WsPolicyOverrideRevokedEvent>;

export const WsPolicyOverrideExpiredEventPayload = WsPolicyOverrideEventPayload;
export type WsPolicyOverrideExpiredEventPayload = z.infer<
  typeof WsPolicyOverrideExpiredEventPayload
>;

export const WsPolicyOverrideExpiredEvent = wsEvent(
  "policy_override.expired",
  WsPolicyOverrideExpiredEventPayload,
);
export type WsPolicyOverrideExpiredEvent = z.infer<typeof WsPolicyOverrideExpiredEvent>;

// ---------------------------------------------------------------------------
// Events (typed) — auth
// ---------------------------------------------------------------------------

export const WsAuditLink = z
  .object({
    plan_id: z.string().min(1),
    step_index: z.number().int().nonnegative(),
    event_id: z.number().int().nonnegative(),
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

export const WsAuthFailedEvent = wsEvent("auth.failed", WsAuthFailedEventPayload);
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

export const WsAuthzDeniedEvent = wsEvent("authz.denied", WsAuthzDeniedEventPayload);
export type WsAuthzDeniedEvent = z.infer<typeof WsAuthzDeniedEvent>;

// ---------------------------------------------------------------------------
// Events (typed) — plugins
// ---------------------------------------------------------------------------

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

export const WsPluginLifecycleEvent = wsEvent("plugin.lifecycle", WsPluginLifecycleEventPayload);
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

export const WsPluginToolInvokedEvent = wsEvent(
  "plugin_tool.invoked",
  WsPluginToolInvokedEventPayload,
);
export type WsPluginToolInvokedEvent = z.infer<typeof WsPluginToolInvokedEvent>;

export const WsToolLifecycleEventPayload = z
  .object({
    session_id: z.string().trim().min(1),
    thread_id: ThreadId,
    tool_call_id: z.string().trim().min(1),
    tool_id: z.string().trim().min(1),
    status: ToolLifecycleStatus,
    summary: z.string(),
    duration_ms: z.number().int().nonnegative().optional(),
    error: z.string().trim().min(1).optional(),
    run_id: ExecutionRunId.optional(),
    agent_id: AgentId.optional(),
    workspace_id: WorkspaceId.optional(),
    channel: ChannelKey.optional(),
  })
  .strict();
export type WsToolLifecycleEventPayload = z.infer<typeof WsToolLifecycleEventPayload>;

export const WsToolLifecycleEvent = wsEvent("tool.lifecycle", WsToolLifecycleEventPayload);
export type WsToolLifecycleEvent = z.infer<typeof WsToolLifecycleEvent>;

// ---------------------------------------------------------------------------
// Events (typed) — usage, context, routing, channel, error
// ---------------------------------------------------------------------------

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

export const WsProviderUsagePolledEvent = wsEvent(
  "provider_usage.polled",
  WsProviderUsagePolledEventPayload,
);
export type WsProviderUsagePolledEvent = z.infer<typeof WsProviderUsagePolledEvent>;

export const WsContextReportCreatedEventPayload = z
  .object({
    run_id: ExecutionRunId,
    report: ContextReport,
  })
  .strict();
export type WsContextReportCreatedEventPayload = z.infer<typeof WsContextReportCreatedEventPayload>;

export const WsContextReportCreatedEvent = wsEvent(
  "context_report.created",
  WsContextReportCreatedEventPayload,
);
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

export const WsRoutingConfigUpdatedEvent = wsEvent(
  "routing.config.updated",
  WsRoutingConfigUpdatedEventPayload,
);
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

export const WsChannelQueueOverflowEvent = wsEvent(
  "channel.queue.overflow",
  WsChannelQueueOverflowEventPayload,
);
export type WsChannelQueueOverflowEvent = z.infer<typeof WsChannelQueueOverflowEvent>;

export const WsErrorEventPayload = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type WsErrorEventPayload = z.infer<typeof WsErrorEventPayload>;

export const WsErrorEvent = wsEvent("error", WsErrorEventPayload);
export type WsErrorEvent = z.infer<typeof WsErrorEvent>;
