import { z } from "zod";
import { Subagent, SubagentDescriptor, SubagentId, SubagentStatus } from "../subagent.js";
import { ScopeKeys } from "../scope.js";
import { WorkItemId, WorkItemTaskId, WorkScope } from "../workboard.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — subagent management
// ---------------------------------------------------------------------------

export const WsSubagentSpawnPayload = ScopeKeys.extend({
  execution_profile: z.string().trim().min(1),
  work_item_id: WorkItemId.optional(),
  work_item_task_id: WorkItemTaskId.optional(),
});
export type WsSubagentSpawnPayload = z.infer<typeof WsSubagentSpawnPayload>;

export const WsSubagentSpawnRequest = WsRequestEnvelope.extend({
  type: z.literal("subagent.spawn"),
  payload: WsSubagentSpawnPayload,
});
export type WsSubagentSpawnRequest = z.infer<typeof WsSubagentSpawnRequest>;

export const WsSubagentListPayload = ScopeKeys.extend({
  statuses: z.array(SubagentStatus).optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().trim().min(1).optional(),
});
export type WsSubagentListPayload = z.infer<typeof WsSubagentListPayload>;

export const WsSubagentListRequest = WsRequestEnvelope.extend({
  type: z.literal("subagent.list"),
  payload: WsSubagentListPayload,
});
export type WsSubagentListRequest = z.infer<typeof WsSubagentListRequest>;

export const WsSubagentGetPayload = ScopeKeys.extend({
  subagent_id: SubagentId,
});
export type WsSubagentGetPayload = z.infer<typeof WsSubagentGetPayload>;

export const WsSubagentGetRequest = WsRequestEnvelope.extend({
  type: z.literal("subagent.get"),
  payload: WsSubagentGetPayload,
});
export type WsSubagentGetRequest = z.infer<typeof WsSubagentGetRequest>;

export const WsSubagentSendPayload = ScopeKeys.extend({
  subagent_id: SubagentId,
  content: z.string().trim().min(1),
});
export type WsSubagentSendPayload = z.infer<typeof WsSubagentSendPayload>;

export const WsSubagentSendRequest = WsRequestEnvelope.extend({
  type: z.literal("subagent.send"),
  payload: WsSubagentSendPayload,
});
export type WsSubagentSendRequest = z.infer<typeof WsSubagentSendRequest>;

export const WsSubagentClosePayload = ScopeKeys.extend({
  subagent_id: SubagentId,
  reason: z.string().trim().min(1).optional(),
});
export type WsSubagentClosePayload = z.infer<typeof WsSubagentClosePayload>;

export const WsSubagentCloseRequest = WsRequestEnvelope.extend({
  type: z.literal("subagent.close"),
  payload: WsSubagentClosePayload,
});
export type WsSubagentCloseRequest = z.infer<typeof WsSubagentCloseRequest>;

// ---------------------------------------------------------------------------
// Operation responses (typed)
// ---------------------------------------------------------------------------

export const WsSubagentSpawnResult = z.object({ subagent: SubagentDescriptor }).strict();
export type WsSubagentSpawnResult = z.infer<typeof WsSubagentSpawnResult>;

export const WsSubagentSpawnResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("subagent.spawn"),
  result: WsSubagentSpawnResult,
});
export type WsSubagentSpawnResponseOkEnvelope = z.infer<typeof WsSubagentSpawnResponseOkEnvelope>;

export const WsSubagentSpawnResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("subagent.spawn"),
});
export type WsSubagentSpawnResponseErrEnvelope = z.infer<typeof WsSubagentSpawnResponseErrEnvelope>;

export const WsSubagentListResult = z
  .object({
    subagents: z.array(Subagent),
    next_cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsSubagentListResult = z.infer<typeof WsSubagentListResult>;

export const WsSubagentListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("subagent.list"),
  result: WsSubagentListResult,
});
export type WsSubagentListResponseOkEnvelope = z.infer<typeof WsSubagentListResponseOkEnvelope>;

export const WsSubagentListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("subagent.list"),
});
export type WsSubagentListResponseErrEnvelope = z.infer<typeof WsSubagentListResponseErrEnvelope>;

export const WsSubagentGetResult = z.object({ subagent: SubagentDescriptor }).strict();
export type WsSubagentGetResult = z.infer<typeof WsSubagentGetResult>;

export const WsSubagentGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("subagent.get"),
  result: WsSubagentGetResult,
});
export type WsSubagentGetResponseOkEnvelope = z.infer<typeof WsSubagentGetResponseOkEnvelope>;

export const WsSubagentGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("subagent.get"),
});
export type WsSubagentGetResponseErrEnvelope = z.infer<typeof WsSubagentGetResponseErrEnvelope>;

export const WsSubagentSendResult = z.object({ accepted: z.boolean() }).strict();
export type WsSubagentSendResult = z.infer<typeof WsSubagentSendResult>;

export const WsSubagentSendResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("subagent.send"),
  result: WsSubagentSendResult,
});
export type WsSubagentSendResponseOkEnvelope = z.infer<typeof WsSubagentSendResponseOkEnvelope>;

export const WsSubagentSendResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("subagent.send"),
});
export type WsSubagentSendResponseErrEnvelope = z.infer<typeof WsSubagentSendResponseErrEnvelope>;

export const WsSubagentCloseResult = z.object({ subagent: SubagentDescriptor }).strict();
export type WsSubagentCloseResult = z.infer<typeof WsSubagentCloseResult>;

export const WsSubagentCloseResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("subagent.close"),
  result: WsSubagentCloseResult,
});
export type WsSubagentCloseResponseOkEnvelope = z.infer<typeof WsSubagentCloseResponseOkEnvelope>;

export const WsSubagentCloseResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("subagent.close"),
});
export type WsSubagentCloseResponseErrEnvelope = z.infer<typeof WsSubagentCloseResponseErrEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed)
// ---------------------------------------------------------------------------

export const WsSubagentLifecycleEventPayload = z.object({ subagent: SubagentDescriptor }).strict();
export type WsSubagentLifecycleEventPayload = z.infer<typeof WsSubagentLifecycleEventPayload>;

export const WsSubagentSpawnedEvent = WsEventEnvelope.extend({
  type: z.literal("subagent.spawned"),
  payload: WsSubagentLifecycleEventPayload,
});
export type WsSubagentSpawnedEvent = z.infer<typeof WsSubagentSpawnedEvent>;

export const WsSubagentUpdatedEvent = WsEventEnvelope.extend({
  type: z.literal("subagent.updated"),
  payload: WsSubagentLifecycleEventPayload,
});
export type WsSubagentUpdatedEvent = z.infer<typeof WsSubagentUpdatedEvent>;

export const WsSubagentClosedEvent = WsEventEnvelope.extend({
  type: z.literal("subagent.closed"),
  payload: WsSubagentLifecycleEventPayload,
});
export type WsSubagentClosedEvent = z.infer<typeof WsSubagentClosedEvent>;

export const WsSubagentOutputKind = z.enum(["log", "delta", "final"]);
export type WsSubagentOutputKind = z.infer<typeof WsSubagentOutputKind>;

export const WsSubagentOutputEventPayload = WorkScope.extend({
  subagent_id: SubagentId,
  work_item_id: WorkItemId.optional(),
  work_item_task_id: WorkItemTaskId.optional(),
  kind: WsSubagentOutputKind,
  content: z.string(),
});
export type WsSubagentOutputEventPayload = z.infer<typeof WsSubagentOutputEventPayload>;

export const WsSubagentOutputEvent = WsEventEnvelope.extend({
  type: z.literal("subagent.output"),
  payload: WsSubagentOutputEventPayload,
});
export type WsSubagentOutputEvent = z.infer<typeof WsSubagentOutputEvent>;
