import { z } from "zod";
import { ArtifactRef } from "../artifact.js";
import {
  ExecutionAttempt,
  ExecutionAttemptId,
  ExecutionStep,
  ExecutionStepId,
  Turn,
  TurnBlockedPayload,
  TurnId,
  TurnStatus,
} from "../execution.js";
import { NodeId } from "../keys.js";
import { ActionPrimitive } from "../planner.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

export * from "./execution-events.js";

const wsRequest = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  WsRequestEnvelope.extend({ type: z.literal(type), payload });
const wsEvent = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  WsEventEnvelope.extend({ type: z.literal(type), payload });
const wsResponseOk = <T extends string>(type: T) =>
  WsResponseOkEnvelope.extend({ type: z.literal(type) });
const wsResponseErr = <T extends string>(type: T) =>
  WsResponseErrEnvelope.extend({ type: z.literal(type) });
const strictObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape).strict();
const WsTurnIdEventPayload = z.object({ turn_id: TurnId }).strict();

export const WsAttemptEvidencePayload = z
  .object({
    turn_id: TurnId,
    step_id: ExecutionStepId,
    attempt_id: ExecutionAttemptId,
    evidence: z.unknown(),
  })
  .strict();
export type WsAttemptEvidencePayload = z.infer<typeof WsAttemptEvidencePayload>;

export const WsAttemptEvidenceRequest = wsRequest("attempt.evidence", WsAttemptEvidencePayload);
export type WsAttemptEvidenceRequest = z.infer<typeof WsAttemptEvidenceRequest>;

export const WsTaskExecutePayload = z
  .object({
    turn_id: TurnId,
    step_id: ExecutionStepId,
    attempt_id: ExecutionAttemptId,
    action: ActionPrimitive,
  })
  .strict();
export type WsTaskExecutePayload = z.infer<typeof WsTaskExecutePayload>;

export const WsTaskExecuteRequest = wsRequest("task.execute", WsTaskExecutePayload);
export type WsTaskExecuteRequest = z.infer<typeof WsTaskExecuteRequest>;

export const WsTaskExecuteResult = z
  .object({
    result: z.unknown().optional(),
    evidence: z.unknown().optional(),
  })
  .strict();
export type WsTaskExecuteResult = z.infer<typeof WsTaskExecuteResult>;

export const WsAttemptEvidenceResponseOkEnvelope = wsResponseOk("attempt.evidence");
export type WsAttemptEvidenceResponseOkEnvelope = z.infer<
  typeof WsAttemptEvidenceResponseOkEnvelope
>;

export const WsAttemptEvidenceResponseErrEnvelope = wsResponseErr("attempt.evidence");
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

export const WsTaskExecuteResponseErrEnvelope = wsResponseErr("task.execute");
export type WsTaskExecuteResponseErrEnvelope = z.infer<typeof WsTaskExecuteResponseErrEnvelope>;

export const WsTaskExecuteResponseEnvelope = z.union([
  WsTaskExecuteResponseOkEnvelope,
  WsTaskExecuteResponseErrEnvelope,
]);
export type WsTaskExecuteResponseEnvelope = z.infer<typeof WsTaskExecuteResponseEnvelope>;

export const WsTurnListPayload = strictObject({
  statuses: z.array(TurnStatus).optional(),
  limit: z.number().int().positive().max(200).optional(),
});
export type WsTurnListPayload = z.infer<typeof WsTurnListPayload>;

export const WsTurnListRequest = wsRequest("turn.list", WsTurnListPayload);
export type WsTurnListRequest = z.infer<typeof WsTurnListRequest>;

export const WsTurnListItem = strictObject({
  turn: Turn,
  agent_key: z.string().trim().min(1).optional(),
  conversation_key: z.string().trim().min(1).optional(),
});
export type WsTurnListItem = z.infer<typeof WsTurnListItem>;

export const WsTurnListResult = strictObject({
  turns: z.array(WsTurnListItem),
  steps: z.array(ExecutionStep),
  attempts: z.array(ExecutionAttempt),
});
export type WsTurnListResult = z.infer<typeof WsTurnListResult>;

export const WsTurnListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("turn.list"),
  result: WsTurnListResult,
});
export type WsTurnListResponseOkEnvelope = z.infer<typeof WsTurnListResponseOkEnvelope>;

export const WsTurnListResponseErrEnvelope = wsResponseErr("turn.list");
export type WsTurnListResponseErrEnvelope = z.infer<typeof WsTurnListResponseErrEnvelope>;

export const WsTurnListResponseEnvelope = z.union([
  WsTurnListResponseOkEnvelope,
  WsTurnListResponseErrEnvelope,
]);
export type WsTurnListResponseEnvelope = z.infer<typeof WsTurnListResponseEnvelope>;

export const WsPlanUpdatePayload = z
  .object({
    plan_id: z.string().min(1),
    status: z.string().min(1),
    detail: z.string().optional(),
  })
  .strict();
export type WsPlanUpdatePayload = z.infer<typeof WsPlanUpdatePayload>;

export const WsPlanUpdateEvent = wsEvent("plan.update", WsPlanUpdatePayload);
export type WsPlanUpdateEvent = z.infer<typeof WsPlanUpdateEvent>;

export const WsTurnUpdatedEventPayload = z
  .object({
    turn: Turn,
  })
  .strict();
export type WsTurnUpdatedEventPayload = z.infer<typeof WsTurnUpdatedEventPayload>;

export const WsTurnUpdatedEvent = wsEvent("turn.updated", WsTurnUpdatedEventPayload);
export type WsTurnUpdatedEvent = z.infer<typeof WsTurnUpdatedEvent>;

export const WsTurnBlockedEventPayload = TurnBlockedPayload;
export type WsTurnBlockedEventPayload = z.infer<typeof WsTurnBlockedEventPayload>;

export const WsTurnBlockedEvent = wsEvent("turn.blocked", WsTurnBlockedEventPayload);
export type WsTurnBlockedEvent = z.infer<typeof WsTurnBlockedEvent>;

export const WsTurnQueuedEventPayload = WsTurnIdEventPayload;
export type WsTurnQueuedEventPayload = z.infer<typeof WsTurnQueuedEventPayload>;

export const WsTurnQueuedEvent = wsEvent("turn.queued", WsTurnQueuedEventPayload);
export type WsTurnQueuedEvent = z.infer<typeof WsTurnQueuedEvent>;

export const WsTurnStartedEventPayload = WsTurnIdEventPayload;
export type WsTurnStartedEventPayload = z.infer<typeof WsTurnStartedEventPayload>;

export const WsTurnStartedEvent = wsEvent("turn.started", WsTurnStartedEventPayload);
export type WsTurnStartedEvent = z.infer<typeof WsTurnStartedEvent>;

export const WsTurnResumedEventPayload = WsTurnIdEventPayload;
export type WsTurnResumedEventPayload = z.infer<typeof WsTurnResumedEventPayload>;

export const WsTurnResumedEvent = wsEvent("turn.resumed", WsTurnResumedEventPayload);
export type WsTurnResumedEvent = z.infer<typeof WsTurnResumedEvent>;

export const WsTurnCompletedEventPayload = WsTurnIdEventPayload;
export type WsTurnCompletedEventPayload = z.infer<typeof WsTurnCompletedEventPayload>;

export const WsTurnCompletedEvent = wsEvent("turn.completed", WsTurnCompletedEventPayload);
export type WsTurnCompletedEvent = z.infer<typeof WsTurnCompletedEvent>;

export const WsTurnFailedEventPayload = WsTurnIdEventPayload;
export type WsTurnFailedEventPayload = z.infer<typeof WsTurnFailedEventPayload>;

export const WsTurnFailedEvent = wsEvent("turn.failed", WsTurnFailedEventPayload);
export type WsTurnFailedEvent = z.infer<typeof WsTurnFailedEvent>;

export const WsTurnCancelledEventPayload = z
  .object({
    turn_id: TurnId,
    reason: z.string().optional(),
  })
  .strict();
export type WsTurnCancelledEventPayload = z.infer<typeof WsTurnCancelledEventPayload>;

export const WsTurnCancelledEvent = wsEvent("turn.cancelled", WsTurnCancelledEventPayload);
export type WsTurnCancelledEvent = z.infer<typeof WsTurnCancelledEvent>;

export const WsStepUpdatedEventPayload = z
  .object({
    step: ExecutionStep,
  })
  .strict();
export type WsStepUpdatedEventPayload = z.infer<typeof WsStepUpdatedEventPayload>;

export const WsStepUpdatedEvent = wsEvent("step.updated", WsStepUpdatedEventPayload);
export type WsStepUpdatedEvent = z.infer<typeof WsStepUpdatedEvent>;

export const WsAttemptUpdatedEventPayload = z
  .object({
    attempt: ExecutionAttempt,
  })
  .strict();
export type WsAttemptUpdatedEventPayload = z.infer<typeof WsAttemptUpdatedEventPayload>;

export const WsAttemptUpdatedEvent = wsEvent("attempt.updated", WsAttemptUpdatedEventPayload);
export type WsAttemptUpdatedEvent = z.infer<typeof WsAttemptUpdatedEvent>;

export const WsArtifactCreatedEventPayload = z
  .object({
    artifact: ArtifactRef,
  })
  .strict();
export type WsArtifactCreatedEventPayload = z.infer<typeof WsArtifactCreatedEventPayload>;

export const WsArtifactCreatedEvent = wsEvent("artifact.created", WsArtifactCreatedEventPayload);
export type WsArtifactCreatedEvent = z.infer<typeof WsArtifactCreatedEvent>;

export const WsArtifactAttachedEventPayload = z
  .object({
    artifact: ArtifactRef,
    turn_id: TurnId,
    step_id: ExecutionStepId,
    attempt_id: ExecutionAttemptId,
  })
  .strict();
export type WsArtifactAttachedEventPayload = z.infer<typeof WsArtifactAttachedEventPayload>;

export const WsArtifactAttachedEvent = wsEvent("artifact.attached", WsArtifactAttachedEventPayload);
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

export const WsArtifactFetchedEvent = wsEvent("artifact.fetched", WsArtifactFetchedEventPayload);
export type WsArtifactFetchedEvent = z.infer<typeof WsArtifactFetchedEvent>;

export const WsAttemptEvidenceEventPayload = z
  .object({
    node_id: NodeId,
    turn_id: TurnId,
    step_id: ExecutionStepId,
    attempt_id: ExecutionAttemptId,
    evidence: z.unknown(),
  })
  .strict();
export type WsAttemptEvidenceEventPayload = z.infer<typeof WsAttemptEvidenceEventPayload>;

export const WsAttemptEvidenceEvent = wsEvent("attempt.evidence", WsAttemptEvidenceEventPayload);
export type WsAttemptEvidenceEvent = z.infer<typeof WsAttemptEvidenceEvent>;
