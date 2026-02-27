import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "../common.js";
import { ExecutionBudgets, ExecutionRunId } from "../execution.js";
import { TyrumKey } from "../keys.js";
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

const WorkStateKVEntry = z.union([AgentStateKVEntry, WorkItemStateKVEntry]);

// ---------------------------------------------------------------------------
// Operation payloads (typed) — workboard
// ---------------------------------------------------------------------------

export const WsWorkListPayload = WorkScope.extend({
  statuses: z.array(WorkItemState).optional(),
  kinds: z.array(WorkItemKind).optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().trim().min(1).optional(),
});
export type WsWorkListPayload = z.infer<typeof WsWorkListPayload>;

export const WsWorkListRequest = WsRequestEnvelope.extend({
  type: z.literal("work.list"),
  payload: WsWorkListPayload,
});
export type WsWorkListRequest = z.infer<typeof WsWorkListRequest>;

export const WsWorkGetPayload = WorkScope.extend({
  work_item_id: WorkItemId,
});
export type WsWorkGetPayload = z.infer<typeof WsWorkGetPayload>;

export const WsWorkGetRequest = WsRequestEnvelope.extend({
  type: z.literal("work.get"),
  payload: WsWorkGetPayload,
});
export type WsWorkGetRequest = z.infer<typeof WsWorkGetRequest>;

export const WsWorkCreateItemInput = z
  .object({
    kind: WorkItemKind,
    title: z.string().trim().min(1),
    priority: z.number().int().nonnegative().optional(),
    acceptance: z.unknown().optional(),
    fingerprint: WorkItemFingerprint.optional(),
    budgets: ExecutionBudgets.optional(),
    parent_work_item_id: WorkItemId.optional(),
    created_from_session_key: TyrumKey.optional(),
  })
  .strict();
export type WsWorkCreateItemInput = z.infer<typeof WsWorkCreateItemInput>;

export const WsWorkCreatePayload = WorkScope.extend({
  item: WsWorkCreateItemInput,
});
export type WsWorkCreatePayload = z.infer<typeof WsWorkCreatePayload>;

export const WsWorkCreateRequest = WsRequestEnvelope.extend({
  type: z.literal("work.create"),
  payload: WsWorkCreatePayload,
});
export type WsWorkCreateRequest = z.infer<typeof WsWorkCreateRequest>;

export const WsWorkUpdatePatch = z
  .object({
    title: z.string().trim().min(1).optional(),
    priority: z.number().int().nonnegative().optional(),
    acceptance: z.unknown().optional(),
    fingerprint: WorkItemFingerprint.optional(),
    budgets: ExecutionBudgets.nullable().optional(),
    last_active_at: DateTimeSchema.nullable().optional(),
  })
  .strict();
export type WsWorkUpdatePatch = z.infer<typeof WsWorkUpdatePatch>;

export const WsWorkUpdatePayload = WorkScope.extend({
  work_item_id: WorkItemId,
  patch: WsWorkUpdatePatch,
});
export type WsWorkUpdatePayload = z.infer<typeof WsWorkUpdatePayload>;

export const WsWorkUpdateRequest = WsRequestEnvelope.extend({
  type: z.literal("work.update"),
  payload: WsWorkUpdatePayload,
});
export type WsWorkUpdateRequest = z.infer<typeof WsWorkUpdateRequest>;

export const WsWorkTransitionPayload = WorkScope.extend({
  work_item_id: WorkItemId,
  status: WorkItemState,
  reason: z.string().trim().min(1).optional(),
});
export type WsWorkTransitionPayload = z.infer<typeof WsWorkTransitionPayload>;

export const WsWorkTransitionRequest = WsRequestEnvelope.extend({
  type: z.literal("work.transition"),
  payload: WsWorkTransitionPayload,
});
export type WsWorkTransitionRequest = z.infer<typeof WsWorkTransitionRequest>;

export const WsWorkLinkCreatePayload = WorkScope.extend({
  work_item_id: WorkItemId,
  linked_work_item_id: WorkItemId,
  kind: WorkItemLinkKind,
  meta_json: z.unknown().optional(),
}).strict();
export type WsWorkLinkCreatePayload = z.infer<typeof WsWorkLinkCreatePayload>;

export const WsWorkLinkCreateRequest = WsRequestEnvelope.extend({
  type: z.literal("work.link.create"),
  payload: WsWorkLinkCreatePayload,
});
export type WsWorkLinkCreateRequest = z.infer<typeof WsWorkLinkCreateRequest>;

export const WsWorkLinkListPayload = WorkScope.extend({
  work_item_id: WorkItemId,
  limit: z.number().int().positive().optional(),
}).strict();
export type WsWorkLinkListPayload = z.infer<typeof WsWorkLinkListPayload>;

export const WsWorkLinkListRequest = WsRequestEnvelope.extend({
  type: z.literal("work.link.list"),
  payload: WsWorkLinkListPayload,
});
export type WsWorkLinkListRequest = z.infer<typeof WsWorkLinkListRequest>;

// ---------------------------------------------------------------------------
// Drilldown operations (typed) — artifacts
// ---------------------------------------------------------------------------

export const WsWorkArtifactListPayload = WorkScope.extend({
  work_item_id: WorkItemId.optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().trim().min(1).optional(),
});
export type WsWorkArtifactListPayload = z.infer<typeof WsWorkArtifactListPayload>;

export const WsWorkArtifactListRequest = WsRequestEnvelope.extend({
  type: z.literal("work.artifact.list"),
  payload: WsWorkArtifactListPayload,
});
export type WsWorkArtifactListRequest = z.infer<typeof WsWorkArtifactListRequest>;

export const WsWorkArtifactGetPayload = WorkScope.extend({
  artifact_id: WorkArtifactId,
});
export type WsWorkArtifactGetPayload = z.infer<typeof WsWorkArtifactGetPayload>;

export const WsWorkArtifactGetRequest = WsRequestEnvelope.extend({
  type: z.literal("work.artifact.get"),
  payload: WsWorkArtifactGetPayload,
});
export type WsWorkArtifactGetRequest = z.infer<typeof WsWorkArtifactGetRequest>;

export const WsWorkArtifactCreateInput = z
  .object({
    work_item_id: WorkItemId.optional(),
    kind: WorkArtifactKind,
    title: z.string().trim().min(1),
    body_md: z.string().optional(),
    refs: z.array(z.string().trim().min(1)).default([]),
    confidence: z.number().min(0).max(1).optional(),
    created_by_run_id: ExecutionRunId.optional(),
    created_by_subagent_id: UuidSchema.optional(),
    provenance_json: z.unknown().optional(),
  })
  .strict();
export type WsWorkArtifactCreateInput = z.infer<typeof WsWorkArtifactCreateInput>;

export const WsWorkArtifactCreatePayload = WorkScope.extend({
  artifact: WsWorkArtifactCreateInput,
});
export type WsWorkArtifactCreatePayload = z.infer<typeof WsWorkArtifactCreatePayload>;

export const WsWorkArtifactCreateRequest = WsRequestEnvelope.extend({
  type: z.literal("work.artifact.create"),
  payload: WsWorkArtifactCreatePayload,
});
export type WsWorkArtifactCreateRequest = z.infer<typeof WsWorkArtifactCreateRequest>;

// ---------------------------------------------------------------------------
// Drilldown operations (typed) — decisions
// ---------------------------------------------------------------------------

export const WsWorkDecisionListPayload = WorkScope.extend({
  work_item_id: WorkItemId.optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().trim().min(1).optional(),
});
export type WsWorkDecisionListPayload = z.infer<typeof WsWorkDecisionListPayload>;

export const WsWorkDecisionListRequest = WsRequestEnvelope.extend({
  type: z.literal("work.decision.list"),
  payload: WsWorkDecisionListPayload,
});
export type WsWorkDecisionListRequest = z.infer<typeof WsWorkDecisionListRequest>;

export const WsWorkDecisionGetPayload = WorkScope.extend({
  decision_id: DecisionRecordId,
});
export type WsWorkDecisionGetPayload = z.infer<typeof WsWorkDecisionGetPayload>;

export const WsWorkDecisionGetRequest = WsRequestEnvelope.extend({
  type: z.literal("work.decision.get"),
  payload: WsWorkDecisionGetPayload,
});
export type WsWorkDecisionGetRequest = z.infer<typeof WsWorkDecisionGetRequest>;

export const WsWorkDecisionCreateInput = z
  .object({
    work_item_id: WorkItemId.optional(),
    question: z.string().trim().min(1),
    chosen: z.string().trim().min(1),
    alternatives: z.array(z.string().trim().min(1)).default([]),
    rationale_md: z.string().trim().min(1),
    input_artifact_ids: z.array(WorkArtifactId).default([]),
    created_by_run_id: ExecutionRunId.optional(),
    created_by_subagent_id: UuidSchema.optional(),
  })
  .strict();
export type WsWorkDecisionCreateInput = z.infer<typeof WsWorkDecisionCreateInput>;

export const WsWorkDecisionCreatePayload = WorkScope.extend({
  decision: WsWorkDecisionCreateInput,
});
export type WsWorkDecisionCreatePayload = z.infer<typeof WsWorkDecisionCreatePayload>;

export const WsWorkDecisionCreateRequest = WsRequestEnvelope.extend({
  type: z.literal("work.decision.create"),
  payload: WsWorkDecisionCreatePayload,
});
export type WsWorkDecisionCreateRequest = z.infer<typeof WsWorkDecisionCreateRequest>;

// ---------------------------------------------------------------------------
// Drilldown operations (typed) — signals
// ---------------------------------------------------------------------------

export const WsWorkSignalListPayload = WorkScope.extend({
  work_item_id: WorkItemId.optional(),
  statuses: z.array(WorkSignalStatus).optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().trim().min(1).optional(),
});
export type WsWorkSignalListPayload = z.infer<typeof WsWorkSignalListPayload>;

export const WsWorkSignalListRequest = WsRequestEnvelope.extend({
  type: z.literal("work.signal.list"),
  payload: WsWorkSignalListPayload,
});
export type WsWorkSignalListRequest = z.infer<typeof WsWorkSignalListRequest>;

export const WsWorkSignalGetPayload = WorkScope.extend({
  signal_id: WorkSignalId,
});
export type WsWorkSignalGetPayload = z.infer<typeof WsWorkSignalGetPayload>;

export const WsWorkSignalGetRequest = WsRequestEnvelope.extend({
  type: z.literal("work.signal.get"),
  payload: WsWorkSignalGetPayload,
});
export type WsWorkSignalGetRequest = z.infer<typeof WsWorkSignalGetRequest>;

export const WsWorkSignalCreateInput = z
  .object({
    work_item_id: WorkItemId.optional(),
    trigger_kind: WorkSignalTriggerKind,
    trigger_spec_json: z.unknown(),
    payload_json: z.unknown().optional(),
    status: WorkSignalStatus.optional(),
  })
  .strict();
export type WsWorkSignalCreateInput = z.infer<typeof WsWorkSignalCreateInput>;

export const WsWorkSignalCreatePayload = WorkScope.extend({
  signal: WsWorkSignalCreateInput,
});
export type WsWorkSignalCreatePayload = z.infer<typeof WsWorkSignalCreatePayload>;

export const WsWorkSignalCreateRequest = WsRequestEnvelope.extend({
  type: z.literal("work.signal.create"),
  payload: WsWorkSignalCreatePayload,
});
export type WsWorkSignalCreateRequest = z.infer<typeof WsWorkSignalCreateRequest>;

export const WsWorkSignalUpdatePatch = z
  .object({
    trigger_spec_json: z.unknown().optional(),
    payload_json: z.unknown().optional(),
    status: WorkSignalStatus.optional(),
  })
  .strict();
export type WsWorkSignalUpdatePatch = z.infer<typeof WsWorkSignalUpdatePatch>;

export const WsWorkSignalUpdatePayload = WorkScope.extend({
  signal_id: WorkSignalId,
  patch: WsWorkSignalUpdatePatch,
});
export type WsWorkSignalUpdatePayload = z.infer<typeof WsWorkSignalUpdatePayload>;

export const WsWorkSignalUpdateRequest = WsRequestEnvelope.extend({
  type: z.literal("work.signal.update"),
  payload: WsWorkSignalUpdatePayload,
});
export type WsWorkSignalUpdateRequest = z.infer<typeof WsWorkSignalUpdateRequest>;

// ---------------------------------------------------------------------------
// Drilldown operations (typed) — state KV
// ---------------------------------------------------------------------------

export const WsWorkStateKvGetPayload = z
  .object({
    scope: WorkStateKVScope,
    key: WorkStateKVKey,
  })
  .strict();
export type WsWorkStateKvGetPayload = z.infer<typeof WsWorkStateKvGetPayload>;

export const WsWorkStateKvGetRequest = WsRequestEnvelope.extend({
  type: z.literal("work.state_kv.get"),
  payload: WsWorkStateKvGetPayload,
});
export type WsWorkStateKvGetRequest = z.infer<typeof WsWorkStateKvGetRequest>;

export const WsWorkStateKvListPayload = z
  .object({
    scope: WorkStateKVScope,
    prefix: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsWorkStateKvListPayload = z.infer<typeof WsWorkStateKvListPayload>;

export const WsWorkStateKvListRequest = WsRequestEnvelope.extend({
  type: z.literal("work.state_kv.list"),
  payload: WsWorkStateKvListPayload,
});
export type WsWorkStateKvListRequest = z.infer<typeof WsWorkStateKvListRequest>;

export const WsWorkStateKvSetPayload = z
  .object({
    scope: WorkStateKVScope,
    key: WorkStateKVKey,
    value_json: z.unknown(),
    provenance_json: z.unknown().optional(),
  })
  .strict();
export type WsWorkStateKvSetPayload = z.infer<typeof WsWorkStateKvSetPayload>;

export const WsWorkStateKvSetRequest = WsRequestEnvelope.extend({
  type: z.literal("work.state_kv.set"),
  payload: WsWorkStateKvSetPayload,
});
export type WsWorkStateKvSetRequest = z.infer<typeof WsWorkStateKvSetRequest>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — workboard
// ---------------------------------------------------------------------------

export const WsWorkListResult = z
  .object({
    items: z.array(WorkItem),
    next_cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsWorkListResult = z.infer<typeof WsWorkListResult>;

export const WsWorkListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.list"),
  result: WsWorkListResult,
});
export type WsWorkListResponseOkEnvelope = z.infer<typeof WsWorkListResponseOkEnvelope>;

export const WsWorkListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.list"),
});
export type WsWorkListResponseErrEnvelope = z.infer<typeof WsWorkListResponseErrEnvelope>;

export const WsWorkGetResult = z.object({ item: WorkItem }).strict();
export type WsWorkGetResult = z.infer<typeof WsWorkGetResult>;

export const WsWorkGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.get"),
  result: WsWorkGetResult,
});
export type WsWorkGetResponseOkEnvelope = z.infer<typeof WsWorkGetResponseOkEnvelope>;

export const WsWorkGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.get"),
});
export type WsWorkGetResponseErrEnvelope = z.infer<typeof WsWorkGetResponseErrEnvelope>;

export const WsWorkCreateResult = z.object({ item: WorkItem }).strict();
export type WsWorkCreateResult = z.infer<typeof WsWorkCreateResult>;

export const WsWorkCreateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.create"),
  result: WsWorkCreateResult,
});
export type WsWorkCreateResponseOkEnvelope = z.infer<typeof WsWorkCreateResponseOkEnvelope>;

export const WsWorkCreateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.create"),
});
export type WsWorkCreateResponseErrEnvelope = z.infer<typeof WsWorkCreateResponseErrEnvelope>;

export const WsWorkUpdateResult = z.object({ item: WorkItem }).strict();
export type WsWorkUpdateResult = z.infer<typeof WsWorkUpdateResult>;

export const WsWorkUpdateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.update"),
  result: WsWorkUpdateResult,
});
export type WsWorkUpdateResponseOkEnvelope = z.infer<typeof WsWorkUpdateResponseOkEnvelope>;

export const WsWorkUpdateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.update"),
});
export type WsWorkUpdateResponseErrEnvelope = z.infer<typeof WsWorkUpdateResponseErrEnvelope>;

export const WsWorkTransitionResult = z.object({ item: WorkItem }).strict();
export type WsWorkTransitionResult = z.infer<typeof WsWorkTransitionResult>;

export const WsWorkTransitionResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.transition"),
  result: WsWorkTransitionResult,
});
export type WsWorkTransitionResponseOkEnvelope = z.infer<typeof WsWorkTransitionResponseOkEnvelope>;

export const WsWorkTransitionResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.transition"),
});
export type WsWorkTransitionResponseErrEnvelope = z.infer<
  typeof WsWorkTransitionResponseErrEnvelope
>;

export const WsWorkLinkCreateResult = z.object({ link: WorkItemLink }).strict();
export type WsWorkLinkCreateResult = z.infer<typeof WsWorkLinkCreateResult>;

export const WsWorkLinkCreateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.link.create"),
  result: WsWorkLinkCreateResult,
});
export type WsWorkLinkCreateResponseOkEnvelope = z.infer<typeof WsWorkLinkCreateResponseOkEnvelope>;

export const WsWorkLinkCreateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.link.create"),
});
export type WsWorkLinkCreateResponseErrEnvelope = z.infer<
  typeof WsWorkLinkCreateResponseErrEnvelope
>;

export const WsWorkLinkListResult = z.object({ links: z.array(WorkItemLink) }).strict();
export type WsWorkLinkListResult = z.infer<typeof WsWorkLinkListResult>;

export const WsWorkLinkListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.link.list"),
  result: WsWorkLinkListResult,
});
export type WsWorkLinkListResponseOkEnvelope = z.infer<typeof WsWorkLinkListResponseOkEnvelope>;

export const WsWorkLinkListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.link.list"),
});
export type WsWorkLinkListResponseErrEnvelope = z.infer<typeof WsWorkLinkListResponseErrEnvelope>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — drilldown
// ---------------------------------------------------------------------------

export const WsWorkArtifactListResult = z
  .object({
    artifacts: z.array(WorkArtifact),
    next_cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsWorkArtifactListResult = z.infer<typeof WsWorkArtifactListResult>;

export const WsWorkArtifactListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.artifact.list"),
  result: WsWorkArtifactListResult,
});
export type WsWorkArtifactListResponseOkEnvelope = z.infer<
  typeof WsWorkArtifactListResponseOkEnvelope
>;

export const WsWorkArtifactListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.artifact.list"),
});
export type WsWorkArtifactListResponseErrEnvelope = z.infer<
  typeof WsWorkArtifactListResponseErrEnvelope
>;

export const WsWorkArtifactGetResult = z.object({ artifact: WorkArtifact }).strict();
export type WsWorkArtifactGetResult = z.infer<typeof WsWorkArtifactGetResult>;

export const WsWorkArtifactGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.artifact.get"),
  result: WsWorkArtifactGetResult,
});
export type WsWorkArtifactGetResponseOkEnvelope = z.infer<
  typeof WsWorkArtifactGetResponseOkEnvelope
>;

export const WsWorkArtifactGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.artifact.get"),
});
export type WsWorkArtifactGetResponseErrEnvelope = z.infer<
  typeof WsWorkArtifactGetResponseErrEnvelope
>;

export const WsWorkArtifactCreateResult = z.object({ artifact: WorkArtifact }).strict();
export type WsWorkArtifactCreateResult = z.infer<typeof WsWorkArtifactCreateResult>;

export const WsWorkArtifactCreateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.artifact.create"),
  result: WsWorkArtifactCreateResult,
});
export type WsWorkArtifactCreateResponseOkEnvelope = z.infer<
  typeof WsWorkArtifactCreateResponseOkEnvelope
>;

export const WsWorkArtifactCreateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.artifact.create"),
});
export type WsWorkArtifactCreateResponseErrEnvelope = z.infer<
  typeof WsWorkArtifactCreateResponseErrEnvelope
>;

export const WsWorkDecisionListResult = z
  .object({
    decisions: z.array(DecisionRecord),
    next_cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsWorkDecisionListResult = z.infer<typeof WsWorkDecisionListResult>;

export const WsWorkDecisionListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.decision.list"),
  result: WsWorkDecisionListResult,
});
export type WsWorkDecisionListResponseOkEnvelope = z.infer<
  typeof WsWorkDecisionListResponseOkEnvelope
>;

export const WsWorkDecisionListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.decision.list"),
});
export type WsWorkDecisionListResponseErrEnvelope = z.infer<
  typeof WsWorkDecisionListResponseErrEnvelope
>;

export const WsWorkDecisionGetResult = z.object({ decision: DecisionRecord }).strict();
export type WsWorkDecisionGetResult = z.infer<typeof WsWorkDecisionGetResult>;

export const WsWorkDecisionGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.decision.get"),
  result: WsWorkDecisionGetResult,
});
export type WsWorkDecisionGetResponseOkEnvelope = z.infer<
  typeof WsWorkDecisionGetResponseOkEnvelope
>;

export const WsWorkDecisionGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.decision.get"),
});
export type WsWorkDecisionGetResponseErrEnvelope = z.infer<
  typeof WsWorkDecisionGetResponseErrEnvelope
>;

export const WsWorkDecisionCreateResult = z.object({ decision: DecisionRecord }).strict();
export type WsWorkDecisionCreateResult = z.infer<typeof WsWorkDecisionCreateResult>;

export const WsWorkDecisionCreateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.decision.create"),
  result: WsWorkDecisionCreateResult,
});
export type WsWorkDecisionCreateResponseOkEnvelope = z.infer<
  typeof WsWorkDecisionCreateResponseOkEnvelope
>;

export const WsWorkDecisionCreateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.decision.create"),
});
export type WsWorkDecisionCreateResponseErrEnvelope = z.infer<
  typeof WsWorkDecisionCreateResponseErrEnvelope
>;

export const WsWorkSignalListResult = z
  .object({
    signals: z.array(WorkSignal),
    next_cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsWorkSignalListResult = z.infer<typeof WsWorkSignalListResult>;

export const WsWorkSignalListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.signal.list"),
  result: WsWorkSignalListResult,
});
export type WsWorkSignalListResponseOkEnvelope = z.infer<typeof WsWorkSignalListResponseOkEnvelope>;

export const WsWorkSignalListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.signal.list"),
});
export type WsWorkSignalListResponseErrEnvelope = z.infer<
  typeof WsWorkSignalListResponseErrEnvelope
>;

export const WsWorkSignalGetResult = z.object({ signal: WorkSignal }).strict();
export type WsWorkSignalGetResult = z.infer<typeof WsWorkSignalGetResult>;

export const WsWorkSignalGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.signal.get"),
  result: WsWorkSignalGetResult,
});
export type WsWorkSignalGetResponseOkEnvelope = z.infer<typeof WsWorkSignalGetResponseOkEnvelope>;

export const WsWorkSignalGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.signal.get"),
});
export type WsWorkSignalGetResponseErrEnvelope = z.infer<typeof WsWorkSignalGetResponseErrEnvelope>;

export const WsWorkSignalCreateResult = z.object({ signal: WorkSignal }).strict();
export type WsWorkSignalCreateResult = z.infer<typeof WsWorkSignalCreateResult>;

export const WsWorkSignalCreateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.signal.create"),
  result: WsWorkSignalCreateResult,
});
export type WsWorkSignalCreateResponseOkEnvelope = z.infer<
  typeof WsWorkSignalCreateResponseOkEnvelope
>;

export const WsWorkSignalCreateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.signal.create"),
});
export type WsWorkSignalCreateResponseErrEnvelope = z.infer<
  typeof WsWorkSignalCreateResponseErrEnvelope
>;

export const WsWorkSignalUpdateResult = z.object({ signal: WorkSignal }).strict();
export type WsWorkSignalUpdateResult = z.infer<typeof WsWorkSignalUpdateResult>;

export const WsWorkSignalUpdateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.signal.update"),
  result: WsWorkSignalUpdateResult,
});
export type WsWorkSignalUpdateResponseOkEnvelope = z.infer<
  typeof WsWorkSignalUpdateResponseOkEnvelope
>;

export const WsWorkSignalUpdateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.signal.update"),
});
export type WsWorkSignalUpdateResponseErrEnvelope = z.infer<
  typeof WsWorkSignalUpdateResponseErrEnvelope
>;

export const WsWorkStateKvGetResult = z
  .object({
    entry: WorkStateKVEntry.nullable(),
  })
  .strict();
export type WsWorkStateKvGetResult = z.infer<typeof WsWorkStateKvGetResult>;

export const WsWorkStateKvGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.state_kv.get"),
  result: WsWorkStateKvGetResult,
});
export type WsWorkStateKvGetResponseOkEnvelope = z.infer<typeof WsWorkStateKvGetResponseOkEnvelope>;

export const WsWorkStateKvGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.state_kv.get"),
});
export type WsWorkStateKvGetResponseErrEnvelope = z.infer<
  typeof WsWorkStateKvGetResponseErrEnvelope
>;

export const WsWorkStateKvListResult = z.object({ entries: z.array(WorkStateKVEntry) }).strict();
export type WsWorkStateKvListResult = z.infer<typeof WsWorkStateKvListResult>;

export const WsWorkStateKvListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.state_kv.list"),
  result: WsWorkStateKvListResult,
});
export type WsWorkStateKvListResponseOkEnvelope = z.infer<
  typeof WsWorkStateKvListResponseOkEnvelope
>;

export const WsWorkStateKvListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.state_kv.list"),
});
export type WsWorkStateKvListResponseErrEnvelope = z.infer<
  typeof WsWorkStateKvListResponseErrEnvelope
>;

export const WsWorkStateKvSetResult = z.object({ entry: WorkStateKVEntry }).strict();
export type WsWorkStateKvSetResult = z.infer<typeof WsWorkStateKvSetResult>;

export const WsWorkStateKvSetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("work.state_kv.set"),
  result: WsWorkStateKvSetResult,
});
export type WsWorkStateKvSetResponseOkEnvelope = z.infer<typeof WsWorkStateKvSetResponseOkEnvelope>;

export const WsWorkStateKvSetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("work.state_kv.set"),
});
export type WsWorkStateKvSetResponseErrEnvelope = z.infer<
  typeof WsWorkStateKvSetResponseErrEnvelope
>;

// ---------------------------------------------------------------------------
// Events (typed) — workboard + drilldown
// ---------------------------------------------------------------------------

export const WsWorkItemEventPayload = z
  .object({
    item: WorkItem,
  })
  .strict();
export type WsWorkItemEventPayload = z.infer<typeof WsWorkItemEventPayload>;

export const WsWorkItemCreatedEvent = WsEventEnvelope.extend({
  type: z.literal("work.item.created"),
  payload: WsWorkItemEventPayload,
});
export type WsWorkItemCreatedEvent = z.infer<typeof WsWorkItemCreatedEvent>;

export const WsWorkItemUpdatedEvent = WsEventEnvelope.extend({
  type: z.literal("work.item.updated"),
  payload: WsWorkItemEventPayload,
});
export type WsWorkItemUpdatedEvent = z.infer<typeof WsWorkItemUpdatedEvent>;

export const WsWorkItemBlockedEvent = WsEventEnvelope.extend({
  type: z.literal("work.item.blocked"),
  payload: WsWorkItemEventPayload,
});
export type WsWorkItemBlockedEvent = z.infer<typeof WsWorkItemBlockedEvent>;

export const WsWorkItemCompletedEvent = WsEventEnvelope.extend({
  type: z.literal("work.item.completed"),
  payload: WsWorkItemEventPayload,
});
export type WsWorkItemCompletedEvent = z.infer<typeof WsWorkItemCompletedEvent>;

export const WsWorkItemCancelledEvent = WsEventEnvelope.extend({
  type: z.literal("work.item.cancelled"),
  payload: WsWorkItemEventPayload,
});
export type WsWorkItemCancelledEvent = z.infer<typeof WsWorkItemCancelledEvent>;

export const WsWorkLinkCreatedEventPayload = WorkScope.extend({
  link: WorkItemLink,
}).strict();
export type WsWorkLinkCreatedEventPayload = z.infer<typeof WsWorkLinkCreatedEventPayload>;

export const WsWorkLinkCreatedEvent = WsEventEnvelope.extend({
  type: z.literal("work.link.created"),
  payload: WsWorkLinkCreatedEventPayload,
});
export type WsWorkLinkCreatedEvent = z.infer<typeof WsWorkLinkCreatedEvent>;

export const WsWorkTaskLeasedEventPayload = WorkScope.extend({
  work_item_id: WorkItemId,
  task_id: WorkItemTaskId,
  lease_expires_at_ms: z.number().int().positive(),
});
export type WsWorkTaskLeasedEventPayload = z.infer<typeof WsWorkTaskLeasedEventPayload>;

export const WsWorkTaskLeasedEvent = WsEventEnvelope.extend({
  type: z.literal("work.task.leased"),
  payload: WsWorkTaskLeasedEventPayload,
});
export type WsWorkTaskLeasedEvent = z.infer<typeof WsWorkTaskLeasedEvent>;

export const WsWorkTaskStartedEventPayload = WorkScope.extend({
  work_item_id: WorkItemId,
  task_id: WorkItemTaskId,
  run_id: ExecutionRunId,
});
export type WsWorkTaskStartedEventPayload = z.infer<typeof WsWorkTaskStartedEventPayload>;

export const WsWorkTaskStartedEvent = WsEventEnvelope.extend({
  type: z.literal("work.task.started"),
  payload: WsWorkTaskStartedEventPayload,
});
export type WsWorkTaskStartedEvent = z.infer<typeof WsWorkTaskStartedEvent>;

export const WsWorkTaskPausedEventPayload = WorkScope.extend({
  work_item_id: WorkItemId,
  task_id: WorkItemTaskId,
  approval_id: z.number().int().positive(),
});
export type WsWorkTaskPausedEventPayload = z.infer<typeof WsWorkTaskPausedEventPayload>;

export const WsWorkTaskPausedEvent = WsEventEnvelope.extend({
  type: z.literal("work.task.paused"),
  payload: WsWorkTaskPausedEventPayload,
});
export type WsWorkTaskPausedEvent = z.infer<typeof WsWorkTaskPausedEvent>;

export const WsWorkTaskCompletedEventPayload = WorkScope.extend({
  work_item_id: WorkItemId,
  task_id: WorkItemTaskId,
  result_summary: z.string().trim().min(1).optional(),
});
export type WsWorkTaskCompletedEventPayload = z.infer<typeof WsWorkTaskCompletedEventPayload>;

export const WsWorkTaskCompletedEvent = WsEventEnvelope.extend({
  type: z.literal("work.task.completed"),
  payload: WsWorkTaskCompletedEventPayload,
});
export type WsWorkTaskCompletedEvent = z.infer<typeof WsWorkTaskCompletedEvent>;

export const WsWorkArtifactCreatedEventPayload = z
  .object({
    artifact: WorkArtifact,
  })
  .strict();
export type WsWorkArtifactCreatedEventPayload = z.infer<typeof WsWorkArtifactCreatedEventPayload>;

export const WsWorkArtifactCreatedEvent = WsEventEnvelope.extend({
  type: z.literal("work.artifact.created"),
  payload: WsWorkArtifactCreatedEventPayload,
});
export type WsWorkArtifactCreatedEvent = z.infer<typeof WsWorkArtifactCreatedEvent>;

export const WsWorkDecisionCreatedEventPayload = z
  .object({
    decision: DecisionRecord,
  })
  .strict();
export type WsWorkDecisionCreatedEventPayload = z.infer<typeof WsWorkDecisionCreatedEventPayload>;

export const WsWorkDecisionCreatedEvent = WsEventEnvelope.extend({
  type: z.literal("work.decision.created"),
  payload: WsWorkDecisionCreatedEventPayload,
});
export type WsWorkDecisionCreatedEvent = z.infer<typeof WsWorkDecisionCreatedEvent>;

export const WsWorkSignalCreatedEventPayload = z
  .object({
    signal: WorkSignal,
  })
  .strict();
export type WsWorkSignalCreatedEventPayload = z.infer<typeof WsWorkSignalCreatedEventPayload>;

export const WsWorkSignalCreatedEvent = WsEventEnvelope.extend({
  type: z.literal("work.signal.created"),
  payload: WsWorkSignalCreatedEventPayload,
});
export type WsWorkSignalCreatedEvent = z.infer<typeof WsWorkSignalCreatedEvent>;

export const WsWorkSignalUpdatedEventPayload = z
  .object({
    signal: WorkSignal,
  })
  .strict();
export type WsWorkSignalUpdatedEventPayload = z.infer<typeof WsWorkSignalUpdatedEventPayload>;

export const WsWorkSignalUpdatedEvent = WsEventEnvelope.extend({
  type: z.literal("work.signal.updated"),
  payload: WsWorkSignalUpdatedEventPayload,
});
export type WsWorkSignalUpdatedEvent = z.infer<typeof WsWorkSignalUpdatedEvent>;

export const WsWorkSignalFiredEventPayload = WorkScope.extend({
  signal_id: WorkSignalId,
  firing_id: z.string().trim().min(1),
  enqueued_job_id: UuidSchema.optional(),
});
export type WsWorkSignalFiredEventPayload = z.infer<typeof WsWorkSignalFiredEventPayload>;

export const WsWorkSignalFiredEvent = WsEventEnvelope.extend({
  type: z.literal("work.signal.fired"),
  payload: WsWorkSignalFiredEventPayload,
});
export type WsWorkSignalFiredEvent = z.infer<typeof WsWorkSignalFiredEvent>;

export const WsWorkStateKvUpdatedEventPayload = z
  .object({
    scope: WorkStateKVScope,
    key: WorkStateKVKey,
    updated_at: DateTimeSchema,
  })
  .strict();
export type WsWorkStateKvUpdatedEventPayload = z.infer<typeof WsWorkStateKvUpdatedEventPayload>;

export const WsWorkStateKvUpdatedEvent = WsEventEnvelope.extend({
  type: z.literal("work.state_kv.updated"),
  payload: WsWorkStateKvUpdatedEventPayload,
});
export type WsWorkStateKvUpdatedEvent = z.infer<typeof WsWorkStateKvUpdatedEvent>;
