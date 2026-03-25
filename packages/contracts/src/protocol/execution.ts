import { z } from "zod";
import { ArtifactRef } from "../artifact.js";
import {
  ExecutionAttempt,
  ExecutionAttemptId,
  ExecutionRun,
  ExecutionRunId,
  ExecutionRunPausedPayload,
  ExecutionRunStatus,
  ExecutionStep,
  ExecutionStepId,
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

// ---------------------------------------------------------------------------
// Operation payloads (typed) — execution
// ---------------------------------------------------------------------------

const wsRequest = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  WsRequestEnvelope.extend({ type: z.literal(type), payload });
const wsEvent = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  WsEventEnvelope.extend({ type: z.literal(type), payload });
const wsResponseOk = <T extends string>(type: T) =>
  WsResponseOkEnvelope.extend({ type: z.literal(type) });
const wsResponseErr = <T extends string>(type: T) =>
  WsResponseErrEnvelope.extend({ type: z.literal(type) });
const strictObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape).strict();
const WsRunIdEventPayload = z.object({ run_id: ExecutionRunId }).strict();

export const WsAttemptEvidencePayload = z
  .object({
    run_id: ExecutionRunId,
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
    run_id: ExecutionRunId,
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

// ---------------------------------------------------------------------------
// Operation responses (typed) — execution
// ---------------------------------------------------------------------------

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

export const WsRunListPayload = strictObject({
  statuses: z.array(ExecutionRunStatus).optional(),
  limit: z.number().int().positive().max(200).optional(),
});
export type WsRunListPayload = z.infer<typeof WsRunListPayload>;

export const WsRunListRequest = wsRequest("run.list", WsRunListPayload);
export type WsRunListRequest = z.infer<typeof WsRunListRequest>;

export const WsRunListItem = strictObject({
  run: ExecutionRun,
  agent_key: z.string().trim().min(1).optional(),
  session_key: z.string().trim().min(1).optional(),
});
export type WsRunListItem = z.infer<typeof WsRunListItem>;

export const WsRunListResult = strictObject({
  runs: z.array(WsRunListItem),
  steps: z.array(ExecutionStep),
  attempts: z.array(ExecutionAttempt),
});
export type WsRunListResult = z.infer<typeof WsRunListResult>;

export const WsRunListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("run.list"),
  result: WsRunListResult,
});
export type WsRunListResponseOkEnvelope = z.infer<typeof WsRunListResponseOkEnvelope>;

export const WsRunListResponseErrEnvelope = wsResponseErr("run.list");
export type WsRunListResponseErrEnvelope = z.infer<typeof WsRunListResponseErrEnvelope>;

export const WsRunListResponseEnvelope = z.union([
  WsRunListResponseOkEnvelope,
  WsRunListResponseErrEnvelope,
]);
export type WsRunListResponseEnvelope = z.infer<typeof WsRunListResponseEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed) — execution core
// ---------------------------------------------------------------------------

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

export const WsRunUpdatedEventPayload = z
  .object({
    run: ExecutionRun,
  })
  .strict();
export type WsRunUpdatedEventPayload = z.infer<typeof WsRunUpdatedEventPayload>;

export const WsRunUpdatedEvent = wsEvent("run.updated", WsRunUpdatedEventPayload);
export type WsRunUpdatedEvent = z.infer<typeof WsRunUpdatedEvent>;

export const WsRunPausedEventPayload = ExecutionRunPausedPayload;
export type WsRunPausedEventPayload = z.infer<typeof WsRunPausedEventPayload>;

export const WsRunPausedEvent = wsEvent("run.paused", WsRunPausedEventPayload);
export type WsRunPausedEvent = z.infer<typeof WsRunPausedEvent>;

export const WsRunQueuedEventPayload = WsRunIdEventPayload;
export type WsRunQueuedEventPayload = z.infer<typeof WsRunQueuedEventPayload>;

export const WsRunQueuedEvent = wsEvent("run.queued", WsRunQueuedEventPayload);
export type WsRunQueuedEvent = z.infer<typeof WsRunQueuedEvent>;

export const WsRunStartedEventPayload = WsRunIdEventPayload;
export type WsRunStartedEventPayload = z.infer<typeof WsRunStartedEventPayload>;

export const WsRunStartedEvent = wsEvent("run.started", WsRunStartedEventPayload);
export type WsRunStartedEvent = z.infer<typeof WsRunStartedEvent>;

export const WsRunResumedEventPayload = WsRunIdEventPayload;
export type WsRunResumedEventPayload = z.infer<typeof WsRunResumedEventPayload>;

export const WsRunResumedEvent = wsEvent("run.resumed", WsRunResumedEventPayload);
export type WsRunResumedEvent = z.infer<typeof WsRunResumedEvent>;

export const WsRunCompletedEventPayload = WsRunIdEventPayload;
export type WsRunCompletedEventPayload = z.infer<typeof WsRunCompletedEventPayload>;

export const WsRunCompletedEvent = wsEvent("run.completed", WsRunCompletedEventPayload);
export type WsRunCompletedEvent = z.infer<typeof WsRunCompletedEvent>;

export const WsRunFailedEventPayload = WsRunIdEventPayload;
export type WsRunFailedEventPayload = z.infer<typeof WsRunFailedEventPayload>;

export const WsRunFailedEvent = wsEvent("run.failed", WsRunFailedEventPayload);
export type WsRunFailedEvent = z.infer<typeof WsRunFailedEvent>;

export const WsRunCancelledEventPayload = z
  .object({
    run_id: ExecutionRunId,
    reason: z.string().optional(),
  })
  .strict();
export type WsRunCancelledEventPayload = z.infer<typeof WsRunCancelledEventPayload>;

export const WsRunCancelledEvent = wsEvent("run.cancelled", WsRunCancelledEventPayload);
export type WsRunCancelledEvent = z.infer<typeof WsRunCancelledEvent>;

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
    run_id: ExecutionRunId,
    step_id: ExecutionStepId,
    attempt_id: ExecutionAttemptId,
    evidence: z.unknown(),
  })
  .strict();
export type WsAttemptEvidenceEventPayload = z.infer<typeof WsAttemptEvidenceEventPayload>;

export const WsAttemptEvidenceEvent = wsEvent("attempt.evidence", WsAttemptEvidenceEventPayload);
export type WsAttemptEvidenceEvent = z.infer<typeof WsAttemptEvidenceEvent>;
