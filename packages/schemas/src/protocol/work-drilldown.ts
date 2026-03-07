import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "../common.js";
import { ExecutionRunId } from "../execution.js";
import { WorkArtifact, WorkArtifactId, WorkArtifactKind } from "../work-artifacts.js";
import { DecisionRecord, DecisionRecordId } from "../work-decisions.js";
import {
  WorkSignal,
  WorkSignalId,
  WorkSignalStatus,
  WorkSignalTriggerKind,
} from "../work-signals.js";
import {
  AgentStateKVEntry,
  WorkItemStateKVEntry,
  WorkStateKVKey,
  WorkStateKVScope,
} from "../work-state-kv.js";
import { WorkItemId, WorkScope } from "../workboard.js";
import { ScopeKeys } from "../scope.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

const WorkStateKVEntry = z.union([AgentStateKVEntry, WorkItemStateKVEntry]);
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
// Drilldown operations (typed) — artifacts
// ---------------------------------------------------------------------------

export const WsWorkArtifactListPayload = ScopeKeys.extend({
  work_item_id: WorkItemId.optional(),
  limit: PositiveInt.optional(),
  cursor: NonEmptyString.optional(),
});
export type WsWorkArtifactListPayload = z.infer<typeof WsWorkArtifactListPayload>;

export const WsWorkArtifactListRequest = createRequest(
  "work.artifact.list",
  WsWorkArtifactListPayload,
);
export type WsWorkArtifactListRequest = z.infer<typeof WsWorkArtifactListRequest>;

export const WsWorkArtifactGetPayload = ScopeKeys.extend({ artifact_id: WorkArtifactId });
export type WsWorkArtifactGetPayload = z.infer<typeof WsWorkArtifactGetPayload>;

export const WsWorkArtifactGetRequest = createRequest(
  "work.artifact.get",
  WsWorkArtifactGetPayload,
);
export type WsWorkArtifactGetRequest = z.infer<typeof WsWorkArtifactGetRequest>;

export const WsWorkArtifactCreateInput = strictObject({
  work_item_id: WorkItemId.optional(),
  kind: WorkArtifactKind,
  title: NonEmptyString,
  body_md: z.string().optional(),
  refs: z.array(NonEmptyString).default([]),
  confidence: z.number().min(0).max(1).optional(),
  created_by_run_id: ExecutionRunId.optional(),
  created_by_subagent_id: UuidSchema.optional(),
  provenance_json: z.unknown().optional(),
});
export type WsWorkArtifactCreateInput = z.infer<typeof WsWorkArtifactCreateInput>;

export const WsWorkArtifactCreatePayload = ScopeKeys.extend({
  artifact: WsWorkArtifactCreateInput,
});
export type WsWorkArtifactCreatePayload = z.infer<typeof WsWorkArtifactCreatePayload>;

export const WsWorkArtifactCreateRequest = createRequest(
  "work.artifact.create",
  WsWorkArtifactCreatePayload,
);
export type WsWorkArtifactCreateRequest = z.infer<typeof WsWorkArtifactCreateRequest>;

// ---------------------------------------------------------------------------
// Drilldown operations (typed) — decisions
// ---------------------------------------------------------------------------

export const WsWorkDecisionListPayload = ScopeKeys.extend({
  work_item_id: WorkItemId.optional(),
  limit: PositiveInt.optional(),
  cursor: NonEmptyString.optional(),
});
export type WsWorkDecisionListPayload = z.infer<typeof WsWorkDecisionListPayload>;

export const WsWorkDecisionListRequest = createRequest(
  "work.decision.list",
  WsWorkDecisionListPayload,
);
export type WsWorkDecisionListRequest = z.infer<typeof WsWorkDecisionListRequest>;

export const WsWorkDecisionGetPayload = ScopeKeys.extend({ decision_id: DecisionRecordId });
export type WsWorkDecisionGetPayload = z.infer<typeof WsWorkDecisionGetPayload>;

export const WsWorkDecisionGetRequest = createRequest(
  "work.decision.get",
  WsWorkDecisionGetPayload,
);
export type WsWorkDecisionGetRequest = z.infer<typeof WsWorkDecisionGetRequest>;

export const WsWorkDecisionCreateInput = strictObject({
  work_item_id: WorkItemId.optional(),
  question: NonEmptyString,
  chosen: NonEmptyString,
  alternatives: z.array(NonEmptyString).default([]),
  rationale_md: NonEmptyString,
  input_artifact_ids: z.array(WorkArtifactId).default([]),
  created_by_run_id: ExecutionRunId.optional(),
  created_by_subagent_id: UuidSchema.optional(),
});
export type WsWorkDecisionCreateInput = z.infer<typeof WsWorkDecisionCreateInput>;

export const WsWorkDecisionCreatePayload = ScopeKeys.extend({
  decision: WsWorkDecisionCreateInput,
});
export type WsWorkDecisionCreatePayload = z.infer<typeof WsWorkDecisionCreatePayload>;

export const WsWorkDecisionCreateRequest = createRequest(
  "work.decision.create",
  WsWorkDecisionCreatePayload,
);
export type WsWorkDecisionCreateRequest = z.infer<typeof WsWorkDecisionCreateRequest>;

// ---------------------------------------------------------------------------
// Drilldown operations (typed) — signals
// ---------------------------------------------------------------------------

export const WsWorkSignalListPayload = ScopeKeys.extend({
  work_item_id: WorkItemId.optional(),
  statuses: z.array(WorkSignalStatus).optional(),
  limit: PositiveInt.optional(),
  cursor: NonEmptyString.optional(),
});
export type WsWorkSignalListPayload = z.infer<typeof WsWorkSignalListPayload>;

export const WsWorkSignalListRequest = createRequest("work.signal.list", WsWorkSignalListPayload);
export type WsWorkSignalListRequest = z.infer<typeof WsWorkSignalListRequest>;

export const WsWorkSignalGetPayload = ScopeKeys.extend({ signal_id: WorkSignalId });
export type WsWorkSignalGetPayload = z.infer<typeof WsWorkSignalGetPayload>;

export const WsWorkSignalGetRequest = createRequest("work.signal.get", WsWorkSignalGetPayload);
export type WsWorkSignalGetRequest = z.infer<typeof WsWorkSignalGetRequest>;

export const WsWorkSignalCreateInput = strictObject({
  work_item_id: WorkItemId.optional(),
  trigger_kind: WorkSignalTriggerKind,
  trigger_spec_json: z.unknown(),
  payload_json: z.unknown().optional(),
  status: WorkSignalStatus.optional(),
});
export type WsWorkSignalCreateInput = z.infer<typeof WsWorkSignalCreateInput>;

export const WsWorkSignalCreatePayload = ScopeKeys.extend({ signal: WsWorkSignalCreateInput });
export type WsWorkSignalCreatePayload = z.infer<typeof WsWorkSignalCreatePayload>;

export const WsWorkSignalCreateRequest = createRequest(
  "work.signal.create",
  WsWorkSignalCreatePayload,
);
export type WsWorkSignalCreateRequest = z.infer<typeof WsWorkSignalCreateRequest>;

export const WsWorkSignalUpdatePatch = strictObject({
  trigger_spec_json: z.unknown().optional(),
  payload_json: z.unknown().optional(),
  status: WorkSignalStatus.optional(),
});
export type WsWorkSignalUpdatePatch = z.infer<typeof WsWorkSignalUpdatePatch>;

export const WsWorkSignalUpdatePayload = ScopeKeys.extend({
  signal_id: WorkSignalId,
  patch: WsWorkSignalUpdatePatch,
});
export type WsWorkSignalUpdatePayload = z.infer<typeof WsWorkSignalUpdatePayload>;

export const WsWorkSignalUpdateRequest = createRequest(
  "work.signal.update",
  WsWorkSignalUpdatePayload,
);
export type WsWorkSignalUpdateRequest = z.infer<typeof WsWorkSignalUpdateRequest>;

// ---------------------------------------------------------------------------
// Drilldown operations (typed) — state KV
// ---------------------------------------------------------------------------

export const WsWorkStateKvGetPayload = strictObject({
  scope: WorkStateKVScope,
  key: WorkStateKVKey,
});
export type WsWorkStateKvGetPayload = z.infer<typeof WsWorkStateKvGetPayload>;

export const WsWorkStateKvGetRequest = createRequest("work.state_kv.get", WsWorkStateKvGetPayload);
export type WsWorkStateKvGetRequest = z.infer<typeof WsWorkStateKvGetRequest>;

export const WsWorkStateKvListPayload = strictObject({
  scope: WorkStateKVScope,
  prefix: NonEmptyString.optional(),
});
export type WsWorkStateKvListPayload = z.infer<typeof WsWorkStateKvListPayload>;

export const WsWorkStateKvListRequest = createRequest(
  "work.state_kv.list",
  WsWorkStateKvListPayload,
);
export type WsWorkStateKvListRequest = z.infer<typeof WsWorkStateKvListRequest>;

export const WsWorkStateKvSetPayload = strictObject({
  scope: WorkStateKVScope,
  key: WorkStateKVKey,
  value_json: z.unknown(),
  provenance_json: z.unknown().optional(),
});
export type WsWorkStateKvSetPayload = z.infer<typeof WsWorkStateKvSetPayload>;

export const WsWorkStateKvSetRequest = createRequest("work.state_kv.set", WsWorkStateKvSetPayload);
export type WsWorkStateKvSetRequest = z.infer<typeof WsWorkStateKvSetRequest>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — drilldown
// ---------------------------------------------------------------------------

export const WsWorkArtifactListResult = strictObject({
  artifacts: z.array(WorkArtifact),
  next_cursor: NonEmptyString.optional(),
});
export type WsWorkArtifactListResult = z.infer<typeof WsWorkArtifactListResult>;

export const WsWorkArtifactListResponseOkEnvelope = createResponseOkEnvelope(
  "work.artifact.list",
  WsWorkArtifactListResult,
);
export type WsWorkArtifactListResponseOkEnvelope = z.infer<
  typeof WsWorkArtifactListResponseOkEnvelope
>;

export const WsWorkArtifactListResponseErrEnvelope =
  createResponseErrEnvelope("work.artifact.list");
export type WsWorkArtifactListResponseErrEnvelope = z.infer<
  typeof WsWorkArtifactListResponseErrEnvelope
>;

export const WsWorkArtifactGetResult = strictObject({ artifact: WorkArtifact });
export type WsWorkArtifactGetResult = z.infer<typeof WsWorkArtifactGetResult>;

export const WsWorkArtifactGetResponseOkEnvelope = createResponseOkEnvelope(
  "work.artifact.get",
  WsWorkArtifactGetResult,
);
export type WsWorkArtifactGetResponseOkEnvelope = z.infer<
  typeof WsWorkArtifactGetResponseOkEnvelope
>;

export const WsWorkArtifactGetResponseErrEnvelope = createResponseErrEnvelope("work.artifact.get");
export type WsWorkArtifactGetResponseErrEnvelope = z.infer<
  typeof WsWorkArtifactGetResponseErrEnvelope
>;

export const WsWorkArtifactCreateResult = strictObject({ artifact: WorkArtifact });
export type WsWorkArtifactCreateResult = z.infer<typeof WsWorkArtifactCreateResult>;

export const WsWorkArtifactCreateResponseOkEnvelope = createResponseOkEnvelope(
  "work.artifact.create",
  WsWorkArtifactCreateResult,
);
export type WsWorkArtifactCreateResponseOkEnvelope = z.infer<
  typeof WsWorkArtifactCreateResponseOkEnvelope
>;

export const WsWorkArtifactCreateResponseErrEnvelope =
  createResponseErrEnvelope("work.artifact.create");
export type WsWorkArtifactCreateResponseErrEnvelope = z.infer<
  typeof WsWorkArtifactCreateResponseErrEnvelope
>;

export const WsWorkDecisionListResult = strictObject({
  decisions: z.array(DecisionRecord),
  next_cursor: NonEmptyString.optional(),
});
export type WsWorkDecisionListResult = z.infer<typeof WsWorkDecisionListResult>;

export const WsWorkDecisionListResponseOkEnvelope = createResponseOkEnvelope(
  "work.decision.list",
  WsWorkDecisionListResult,
);
export type WsWorkDecisionListResponseOkEnvelope = z.infer<
  typeof WsWorkDecisionListResponseOkEnvelope
>;

export const WsWorkDecisionListResponseErrEnvelope =
  createResponseErrEnvelope("work.decision.list");
export type WsWorkDecisionListResponseErrEnvelope = z.infer<
  typeof WsWorkDecisionListResponseErrEnvelope
>;

export const WsWorkDecisionGetResult = strictObject({ decision: DecisionRecord });
export type WsWorkDecisionGetResult = z.infer<typeof WsWorkDecisionGetResult>;

export const WsWorkDecisionGetResponseOkEnvelope = createResponseOkEnvelope(
  "work.decision.get",
  WsWorkDecisionGetResult,
);
export type WsWorkDecisionGetResponseOkEnvelope = z.infer<
  typeof WsWorkDecisionGetResponseOkEnvelope
>;

export const WsWorkDecisionGetResponseErrEnvelope = createResponseErrEnvelope("work.decision.get");
export type WsWorkDecisionGetResponseErrEnvelope = z.infer<
  typeof WsWorkDecisionGetResponseErrEnvelope
>;

export const WsWorkDecisionCreateResult = strictObject({ decision: DecisionRecord });
export type WsWorkDecisionCreateResult = z.infer<typeof WsWorkDecisionCreateResult>;

export const WsWorkDecisionCreateResponseOkEnvelope = createResponseOkEnvelope(
  "work.decision.create",
  WsWorkDecisionCreateResult,
);
export type WsWorkDecisionCreateResponseOkEnvelope = z.infer<
  typeof WsWorkDecisionCreateResponseOkEnvelope
>;

export const WsWorkDecisionCreateResponseErrEnvelope =
  createResponseErrEnvelope("work.decision.create");
export type WsWorkDecisionCreateResponseErrEnvelope = z.infer<
  typeof WsWorkDecisionCreateResponseErrEnvelope
>;

export const WsWorkSignalListResult = strictObject({
  signals: z.array(WorkSignal),
  next_cursor: NonEmptyString.optional(),
});
export type WsWorkSignalListResult = z.infer<typeof WsWorkSignalListResult>;

export const WsWorkSignalListResponseOkEnvelope = createResponseOkEnvelope(
  "work.signal.list",
  WsWorkSignalListResult,
);
export type WsWorkSignalListResponseOkEnvelope = z.infer<typeof WsWorkSignalListResponseOkEnvelope>;

export const WsWorkSignalListResponseErrEnvelope = createResponseErrEnvelope("work.signal.list");
export type WsWorkSignalListResponseErrEnvelope = z.infer<
  typeof WsWorkSignalListResponseErrEnvelope
>;

export const WsWorkSignalGetResult = strictObject({ signal: WorkSignal });
export type WsWorkSignalGetResult = z.infer<typeof WsWorkSignalGetResult>;

export const WsWorkSignalGetResponseOkEnvelope = createResponseOkEnvelope(
  "work.signal.get",
  WsWorkSignalGetResult,
);
export type WsWorkSignalGetResponseOkEnvelope = z.infer<typeof WsWorkSignalGetResponseOkEnvelope>;

export const WsWorkSignalGetResponseErrEnvelope = createResponseErrEnvelope("work.signal.get");
export type WsWorkSignalGetResponseErrEnvelope = z.infer<typeof WsWorkSignalGetResponseErrEnvelope>;

export const WsWorkSignalCreateResult = strictObject({ signal: WorkSignal });
export type WsWorkSignalCreateResult = z.infer<typeof WsWorkSignalCreateResult>;

export const WsWorkSignalCreateResponseOkEnvelope = createResponseOkEnvelope(
  "work.signal.create",
  WsWorkSignalCreateResult,
);
export type WsWorkSignalCreateResponseOkEnvelope = z.infer<
  typeof WsWorkSignalCreateResponseOkEnvelope
>;

export const WsWorkSignalCreateResponseErrEnvelope =
  createResponseErrEnvelope("work.signal.create");
export type WsWorkSignalCreateResponseErrEnvelope = z.infer<
  typeof WsWorkSignalCreateResponseErrEnvelope
>;

export const WsWorkSignalUpdateResult = strictObject({ signal: WorkSignal });
export type WsWorkSignalUpdateResult = z.infer<typeof WsWorkSignalUpdateResult>;

export const WsWorkSignalUpdateResponseOkEnvelope = createResponseOkEnvelope(
  "work.signal.update",
  WsWorkSignalUpdateResult,
);
export type WsWorkSignalUpdateResponseOkEnvelope = z.infer<
  typeof WsWorkSignalUpdateResponseOkEnvelope
>;

export const WsWorkSignalUpdateResponseErrEnvelope =
  createResponseErrEnvelope("work.signal.update");
export type WsWorkSignalUpdateResponseErrEnvelope = z.infer<
  typeof WsWorkSignalUpdateResponseErrEnvelope
>;

export const WsWorkStateKvGetResult = strictObject({ entry: WorkStateKVEntry.nullable() });
export type WsWorkStateKvGetResult = z.infer<typeof WsWorkStateKvGetResult>;

export const WsWorkStateKvGetResponseOkEnvelope = createResponseOkEnvelope(
  "work.state_kv.get",
  WsWorkStateKvGetResult,
);
export type WsWorkStateKvGetResponseOkEnvelope = z.infer<typeof WsWorkStateKvGetResponseOkEnvelope>;

export const WsWorkStateKvGetResponseErrEnvelope = createResponseErrEnvelope("work.state_kv.get");
export type WsWorkStateKvGetResponseErrEnvelope = z.infer<
  typeof WsWorkStateKvGetResponseErrEnvelope
>;

export const WsWorkStateKvListResult = strictObject({ entries: z.array(WorkStateKVEntry) });
export type WsWorkStateKvListResult = z.infer<typeof WsWorkStateKvListResult>;

export const WsWorkStateKvListResponseOkEnvelope = createResponseOkEnvelope(
  "work.state_kv.list",
  WsWorkStateKvListResult,
);
export type WsWorkStateKvListResponseOkEnvelope = z.infer<
  typeof WsWorkStateKvListResponseOkEnvelope
>;

export const WsWorkStateKvListResponseErrEnvelope = createResponseErrEnvelope("work.state_kv.list");
export type WsWorkStateKvListResponseErrEnvelope = z.infer<
  typeof WsWorkStateKvListResponseErrEnvelope
>;

export const WsWorkStateKvSetResult = strictObject({ entry: WorkStateKVEntry });
export type WsWorkStateKvSetResult = z.infer<typeof WsWorkStateKvSetResult>;

export const WsWorkStateKvSetResponseOkEnvelope = createResponseOkEnvelope(
  "work.state_kv.set",
  WsWorkStateKvSetResult,
);
export type WsWorkStateKvSetResponseOkEnvelope = z.infer<typeof WsWorkStateKvSetResponseOkEnvelope>;

export const WsWorkStateKvSetResponseErrEnvelope = createResponseErrEnvelope("work.state_kv.set");
export type WsWorkStateKvSetResponseErrEnvelope = z.infer<
  typeof WsWorkStateKvSetResponseErrEnvelope
>;

// ---------------------------------------------------------------------------
// Events (typed) — drilldown
// ---------------------------------------------------------------------------

export const WsWorkArtifactCreatedEventPayload = strictObject({ artifact: WorkArtifact });
export type WsWorkArtifactCreatedEventPayload = z.infer<typeof WsWorkArtifactCreatedEventPayload>;

export const WsWorkArtifactCreatedEvent = createEvent(
  "work.artifact.created",
  WsWorkArtifactCreatedEventPayload,
);
export type WsWorkArtifactCreatedEvent = z.infer<typeof WsWorkArtifactCreatedEvent>;

export const WsWorkDecisionCreatedEventPayload = strictObject({ decision: DecisionRecord });
export type WsWorkDecisionCreatedEventPayload = z.infer<typeof WsWorkDecisionCreatedEventPayload>;

export const WsWorkDecisionCreatedEvent = createEvent(
  "work.decision.created",
  WsWorkDecisionCreatedEventPayload,
);
export type WsWorkDecisionCreatedEvent = z.infer<typeof WsWorkDecisionCreatedEvent>;

export const WsWorkSignalCreatedEventPayload = strictObject({ signal: WorkSignal });
export type WsWorkSignalCreatedEventPayload = z.infer<typeof WsWorkSignalCreatedEventPayload>;

export const WsWorkSignalCreatedEvent = createEvent(
  "work.signal.created",
  WsWorkSignalCreatedEventPayload,
);
export type WsWorkSignalCreatedEvent = z.infer<typeof WsWorkSignalCreatedEvent>;

export const WsWorkSignalUpdatedEventPayload = strictObject({ signal: WorkSignal });
export type WsWorkSignalUpdatedEventPayload = z.infer<typeof WsWorkSignalUpdatedEventPayload>;

export const WsWorkSignalUpdatedEvent = createEvent(
  "work.signal.updated",
  WsWorkSignalUpdatedEventPayload,
);
export type WsWorkSignalUpdatedEvent = z.infer<typeof WsWorkSignalUpdatedEvent>;

export const WsWorkSignalFiredEventPayload = WorkScope.extend({
  signal_id: WorkSignalId,
  firing_id: NonEmptyString,
  enqueued_job_id: UuidSchema.optional(),
});
export type WsWorkSignalFiredEventPayload = z.infer<typeof WsWorkSignalFiredEventPayload>;

export const WsWorkSignalFiredEvent = createEvent(
  "work.signal.fired",
  WsWorkSignalFiredEventPayload,
);
export type WsWorkSignalFiredEvent = z.infer<typeof WsWorkSignalFiredEvent>;

export const WsWorkStateKvUpdatedEventPayload = strictObject({
  scope: WorkStateKVScope,
  key: WorkStateKVKey,
  updated_at: DateTimeSchema,
});
export type WsWorkStateKvUpdatedEventPayload = z.infer<typeof WsWorkStateKvUpdatedEventPayload>;

export const WsWorkStateKvUpdatedEvent = createEvent(
  "work.state_kv.updated",
  WsWorkStateKvUpdatedEventPayload,
);
export type WsWorkStateKvUpdatedEvent = z.infer<typeof WsWorkStateKvUpdatedEvent>;
