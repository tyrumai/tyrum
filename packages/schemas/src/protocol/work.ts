import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "../common.js";
import { ExecutionBudgets, ExecutionRunId } from "../execution.js";
import { TyrumKey } from "../keys.js";
import { ScopeKeys } from "../scope.js";
import {
  WorkScope,
  WorkItem,
  WorkItemFingerprint,
  WorkItemId,
  WorkItemKind,
  WorkItemLink,
  WorkItemLinkKind,
  WorkItemState,
  WorkItemTaskId,
} from "../workboard.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

export * from "./work-drilldown.js";

const NonEmptyString = z.string().trim().min(1);
const PositiveInt = z.number().int().positive();
const strictObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape).strict();
const createRequest = <Type extends string, Payload extends z.ZodTypeAny>(
  type: Type,
  payload: Payload,
) => WsRequestEnvelope.extend({ type: z.literal(type), payload });
const createResponseOkEnvelope = <Type extends string, Result extends z.ZodTypeAny>(
  type: Type,
  result: Result,
) => WsResponseOkEnvelope.extend({ type: z.literal(type), result });
const createResponseErrEnvelope = <Type extends string>(type: Type) =>
  WsResponseErrEnvelope.extend({ type: z.literal(type) });
const createEvent = <Type extends string, Payload extends z.ZodTypeAny>(
  type: Type,
  payload: Payload,
) => WsEventEnvelope.extend({ type: z.literal(type), payload });

// ---------------------------------------------------------------------------
// Operation payloads (typed) — workboard
// ---------------------------------------------------------------------------

export const WsWorkListPayload = ScopeKeys.extend({
  statuses: z.array(WorkItemState).optional(),
  kinds: z.array(WorkItemKind).optional(),
  limit: PositiveInt.optional(),
  cursor: NonEmptyString.optional(),
});
export type WsWorkListPayload = z.infer<typeof WsWorkListPayload>;

export const WsWorkListRequest = createRequest("work.list", WsWorkListPayload);
export type WsWorkListRequest = z.infer<typeof WsWorkListRequest>;

export const WsWorkGetPayload = ScopeKeys.extend({ work_item_id: WorkItemId });
export type WsWorkGetPayload = z.infer<typeof WsWorkGetPayload>;

export const WsWorkGetRequest = createRequest("work.get", WsWorkGetPayload);
export type WsWorkGetRequest = z.infer<typeof WsWorkGetRequest>;

export const WsWorkCreateItemInput = strictObject({
  kind: WorkItemKind,
  title: NonEmptyString,
  priority: z.number().int().nonnegative().optional(),
  acceptance: z.unknown().optional(),
  fingerprint: WorkItemFingerprint.optional(),
  budgets: ExecutionBudgets.optional(),
  parent_work_item_id: WorkItemId.optional(),
  created_from_session_key: TyrumKey.optional(),
});
export type WsWorkCreateItemInput = z.infer<typeof WsWorkCreateItemInput>;

export const WsWorkCreatePayload = ScopeKeys.extend({ item: WsWorkCreateItemInput });
export type WsWorkCreatePayload = z.infer<typeof WsWorkCreatePayload>;

export const WsWorkCreateRequest = createRequest("work.create", WsWorkCreatePayload);
export type WsWorkCreateRequest = z.infer<typeof WsWorkCreateRequest>;

export const WsWorkUpdatePatch = strictObject({
  title: NonEmptyString.optional(),
  priority: z.number().int().nonnegative().optional(),
  acceptance: z.unknown().optional(),
  fingerprint: WorkItemFingerprint.optional(),
  budgets: ExecutionBudgets.nullable().optional(),
  last_active_at: DateTimeSchema.nullable().optional(),
});
export type WsWorkUpdatePatch = z.infer<typeof WsWorkUpdatePatch>;

export const WsWorkUpdatePayload = ScopeKeys.extend({
  work_item_id: WorkItemId,
  patch: WsWorkUpdatePatch,
});
export type WsWorkUpdatePayload = z.infer<typeof WsWorkUpdatePayload>;

export const WsWorkUpdateRequest = createRequest("work.update", WsWorkUpdatePayload);
export type WsWorkUpdateRequest = z.infer<typeof WsWorkUpdateRequest>;

export const WsWorkTransitionPayload = ScopeKeys.extend({
  work_item_id: WorkItemId,
  status: WorkItemState,
  reason: NonEmptyString.optional(),
});
export type WsWorkTransitionPayload = z.infer<typeof WsWorkTransitionPayload>;

export const WsWorkTransitionRequest = createRequest("work.transition", WsWorkTransitionPayload);
export type WsWorkTransitionRequest = z.infer<typeof WsWorkTransitionRequest>;

export const WsWorkLinkCreatePayload = ScopeKeys.extend({
  work_item_id: WorkItemId,
  linked_work_item_id: WorkItemId,
  kind: WorkItemLinkKind,
  meta_json: z.unknown().optional(),
}).strict();
export type WsWorkLinkCreatePayload = z.infer<typeof WsWorkLinkCreatePayload>;

export const WsWorkLinkCreateRequest = createRequest("work.link.create", WsWorkLinkCreatePayload);
export type WsWorkLinkCreateRequest = z.infer<typeof WsWorkLinkCreateRequest>;

export const WsWorkLinkListPayload = ScopeKeys.extend({
  work_item_id: WorkItemId,
  limit: PositiveInt.optional(),
}).strict();
export type WsWorkLinkListPayload = z.infer<typeof WsWorkLinkListPayload>;

export const WsWorkLinkListRequest = createRequest("work.link.list", WsWorkLinkListPayload);
export type WsWorkLinkListRequest = z.infer<typeof WsWorkLinkListRequest>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — workboard
// ---------------------------------------------------------------------------

export const WsWorkListResult = strictObject({
  items: z.array(WorkItem),
  next_cursor: NonEmptyString.optional(),
});
export type WsWorkListResult = z.infer<typeof WsWorkListResult>;

export const WsWorkListResponseOkEnvelope = createResponseOkEnvelope("work.list", WsWorkListResult);
export type WsWorkListResponseOkEnvelope = z.infer<typeof WsWorkListResponseOkEnvelope>;

export const WsWorkListResponseErrEnvelope = createResponseErrEnvelope("work.list");
export type WsWorkListResponseErrEnvelope = z.infer<typeof WsWorkListResponseErrEnvelope>;

export const WsWorkGetResult = strictObject({ item: WorkItem });
export type WsWorkGetResult = z.infer<typeof WsWorkGetResult>;

export const WsWorkGetResponseOkEnvelope = createResponseOkEnvelope("work.get", WsWorkGetResult);
export type WsWorkGetResponseOkEnvelope = z.infer<typeof WsWorkGetResponseOkEnvelope>;

export const WsWorkGetResponseErrEnvelope = createResponseErrEnvelope("work.get");
export type WsWorkGetResponseErrEnvelope = z.infer<typeof WsWorkGetResponseErrEnvelope>;

export const WsWorkCreateResult = strictObject({ item: WorkItem });
export type WsWorkCreateResult = z.infer<typeof WsWorkCreateResult>;

export const WsWorkCreateResponseOkEnvelope = createResponseOkEnvelope(
  "work.create",
  WsWorkCreateResult,
);
export type WsWorkCreateResponseOkEnvelope = z.infer<typeof WsWorkCreateResponseOkEnvelope>;

export const WsWorkCreateResponseErrEnvelope = createResponseErrEnvelope("work.create");
export type WsWorkCreateResponseErrEnvelope = z.infer<typeof WsWorkCreateResponseErrEnvelope>;

export const WsWorkUpdateResult = strictObject({ item: WorkItem });
export type WsWorkUpdateResult = z.infer<typeof WsWorkUpdateResult>;

export const WsWorkUpdateResponseOkEnvelope = createResponseOkEnvelope(
  "work.update",
  WsWorkUpdateResult,
);
export type WsWorkUpdateResponseOkEnvelope = z.infer<typeof WsWorkUpdateResponseOkEnvelope>;

export const WsWorkUpdateResponseErrEnvelope = createResponseErrEnvelope("work.update");
export type WsWorkUpdateResponseErrEnvelope = z.infer<typeof WsWorkUpdateResponseErrEnvelope>;

export const WsWorkTransitionResult = strictObject({ item: WorkItem });
export type WsWorkTransitionResult = z.infer<typeof WsWorkTransitionResult>;

export const WsWorkTransitionResponseOkEnvelope = createResponseOkEnvelope(
  "work.transition",
  WsWorkTransitionResult,
);
export type WsWorkTransitionResponseOkEnvelope = z.infer<typeof WsWorkTransitionResponseOkEnvelope>;

export const WsWorkTransitionResponseErrEnvelope = createResponseErrEnvelope("work.transition");
export type WsWorkTransitionResponseErrEnvelope = z.infer<
  typeof WsWorkTransitionResponseErrEnvelope
>;

export const WsWorkLinkCreateResult = strictObject({ link: WorkItemLink });
export type WsWorkLinkCreateResult = z.infer<typeof WsWorkLinkCreateResult>;

export const WsWorkLinkCreateResponseOkEnvelope = createResponseOkEnvelope(
  "work.link.create",
  WsWorkLinkCreateResult,
);
export type WsWorkLinkCreateResponseOkEnvelope = z.infer<typeof WsWorkLinkCreateResponseOkEnvelope>;

export const WsWorkLinkCreateResponseErrEnvelope = createResponseErrEnvelope("work.link.create");
export type WsWorkLinkCreateResponseErrEnvelope = z.infer<
  typeof WsWorkLinkCreateResponseErrEnvelope
>;

export const WsWorkLinkListResult = strictObject({ links: z.array(WorkItemLink) });
export type WsWorkLinkListResult = z.infer<typeof WsWorkLinkListResult>;

export const WsWorkLinkListResponseOkEnvelope = createResponseOkEnvelope(
  "work.link.list",
  WsWorkLinkListResult,
);
export type WsWorkLinkListResponseOkEnvelope = z.infer<typeof WsWorkLinkListResponseOkEnvelope>;

export const WsWorkLinkListResponseErrEnvelope = createResponseErrEnvelope("work.link.list");
export type WsWorkLinkListResponseErrEnvelope = z.infer<typeof WsWorkLinkListResponseErrEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed) — workboard
// ---------------------------------------------------------------------------

export const WsWorkItemEventPayload = strictObject({ item: WorkItem });
export type WsWorkItemEventPayload = z.infer<typeof WsWorkItemEventPayload>;

export const WsWorkItemCreatedEvent = createEvent("work.item.created", WsWorkItemEventPayload);
export type WsWorkItemCreatedEvent = z.infer<typeof WsWorkItemCreatedEvent>;

export const WsWorkItemUpdatedEvent = createEvent("work.item.updated", WsWorkItemEventPayload);
export type WsWorkItemUpdatedEvent = z.infer<typeof WsWorkItemUpdatedEvent>;

export const WsWorkItemBlockedEvent = createEvent("work.item.blocked", WsWorkItemEventPayload);
export type WsWorkItemBlockedEvent = z.infer<typeof WsWorkItemBlockedEvent>;

export const WsWorkItemCompletedEvent = createEvent("work.item.completed", WsWorkItemEventPayload);
export type WsWorkItemCompletedEvent = z.infer<typeof WsWorkItemCompletedEvent>;

export const WsWorkItemFailedEvent = createEvent("work.item.failed", WsWorkItemEventPayload);
export type WsWorkItemFailedEvent = z.infer<typeof WsWorkItemFailedEvent>;

export const WsWorkItemCancelledEvent = createEvent("work.item.cancelled", WsWorkItemEventPayload);
export type WsWorkItemCancelledEvent = z.infer<typeof WsWorkItemCancelledEvent>;

export const WsWorkLinkCreatedEventPayload = WorkScope.extend({ link: WorkItemLink }).strict();
export type WsWorkLinkCreatedEventPayload = z.infer<typeof WsWorkLinkCreatedEventPayload>;

export const WsWorkLinkCreatedEvent = createEvent(
  "work.link.created",
  WsWorkLinkCreatedEventPayload,
);
export type WsWorkLinkCreatedEvent = z.infer<typeof WsWorkLinkCreatedEvent>;

export const WsWorkTaskLeasedEventPayload = WorkScope.extend({
  work_item_id: WorkItemId,
  task_id: WorkItemTaskId,
  lease_expires_at_ms: PositiveInt,
});
export type WsWorkTaskLeasedEventPayload = z.infer<typeof WsWorkTaskLeasedEventPayload>;

export const WsWorkTaskLeasedEvent = createEvent("work.task.leased", WsWorkTaskLeasedEventPayload);
export type WsWorkTaskLeasedEvent = z.infer<typeof WsWorkTaskLeasedEvent>;

export const WsWorkTaskStartedEventPayload = WorkScope.extend({
  work_item_id: WorkItemId,
  task_id: WorkItemTaskId,
  run_id: ExecutionRunId,
});
export type WsWorkTaskStartedEventPayload = z.infer<typeof WsWorkTaskStartedEventPayload>;

export const WsWorkTaskStartedEvent = createEvent(
  "work.task.started",
  WsWorkTaskStartedEventPayload,
);
export type WsWorkTaskStartedEvent = z.infer<typeof WsWorkTaskStartedEvent>;

export const WsWorkTaskPausedEventPayload = WorkScope.extend({
  work_item_id: WorkItemId,
  task_id: WorkItemTaskId,
  approval_id: UuidSchema,
});
export type WsWorkTaskPausedEventPayload = z.infer<typeof WsWorkTaskPausedEventPayload>;

export const WsWorkTaskPausedEvent = createEvent("work.task.paused", WsWorkTaskPausedEventPayload);
export type WsWorkTaskPausedEvent = z.infer<typeof WsWorkTaskPausedEvent>;

export const WsWorkTaskCompletedEventPayload = WorkScope.extend({
  work_item_id: WorkItemId,
  task_id: WorkItemTaskId,
  result_summary: NonEmptyString.optional(),
});
export type WsWorkTaskCompletedEventPayload = z.infer<typeof WsWorkTaskCompletedEventPayload>;

export const WsWorkTaskCompletedEvent = createEvent(
  "work.task.completed",
  WsWorkTaskCompletedEventPayload,
);
export type WsWorkTaskCompletedEvent = z.infer<typeof WsWorkTaskCompletedEvent>;
