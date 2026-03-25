import { z } from "zod";
import { Approval } from "../approval.js";
import { DateTimeSchema } from "../common.js";
import { ExecutionAttempt, ExecutionRun, ExecutionRunStatus, ExecutionStep } from "../execution.js";
import { AgentKey, Lane } from "../keys.js";
import { Subagent, SubagentStatus } from "../subagent.js";
import { TyrumUIMessage } from "../ui-message.js";
import { WsRequestEnvelope, WsResponseErrEnvelope, WsResponseOkEnvelope } from "./envelopes.js";

const NonEmptyString = z.string().trim().min(1);

export type TranscriptSessionSummary = {
  session_id: string;
  session_key: string;
  agent_key: string;
  channel: string;
  account_key?: string;
  thread_id: string;
  container_kind?: string;
  title: string;
  message_count: number;
  updated_at: string;
  created_at: string;
  archived: boolean;
  parent_session_key?: string;
  subagent_id?: string;
  lane?: z.infer<typeof Lane>;
  execution_profile?: string;
  subagent_status?: z.infer<typeof SubagentStatus>;
  latest_run_id: string | null;
  latest_run_status: z.infer<typeof ExecutionRunStatus> | null;
  has_active_run: boolean;
  pending_approval_count: number;
  child_sessions?: TranscriptSessionSummary[];
};

export const TranscriptSessionSummary: z.ZodType<TranscriptSessionSummary> = z.lazy(() =>
  z
    .object({
      session_id: NonEmptyString,
      session_key: NonEmptyString,
      agent_key: AgentKey,
      channel: NonEmptyString,
      account_key: NonEmptyString.optional(),
      thread_id: NonEmptyString,
      container_kind: NonEmptyString.optional(),
      title: z.string().default(""),
      message_count: z.number().int().nonnegative(),
      updated_at: DateTimeSchema,
      created_at: DateTimeSchema,
      archived: z.boolean().default(false),
      parent_session_key: NonEmptyString.optional(),
      subagent_id: NonEmptyString.optional(),
      lane: Lane.optional(),
      execution_profile: NonEmptyString.optional(),
      subagent_status: SubagentStatus.optional(),
      latest_run_id: NonEmptyString.nullable(),
      latest_run_status: ExecutionRunStatus.nullable(),
      has_active_run: z.boolean().default(false),
      pending_approval_count: z.number().int().nonnegative().default(0),
      child_sessions: z.array(TranscriptSessionSummary).optional(),
    })
    .strict(),
);

export const TranscriptMessageEvent = z
  .object({
    event_id: NonEmptyString,
    kind: z.literal("message"),
    occurred_at: DateTimeSchema,
    session_key: NonEmptyString,
    parent_session_key: NonEmptyString.optional(),
    subagent_id: NonEmptyString.optional(),
    payload: z
      .object({
        message: TyrumUIMessage,
      })
      .strict(),
  })
  .strict();
export type TranscriptMessageEvent = z.infer<typeof TranscriptMessageEvent>;

export const TranscriptRunEvent = z
  .object({
    event_id: NonEmptyString,
    kind: z.literal("run"),
    occurred_at: DateTimeSchema,
    session_key: NonEmptyString,
    parent_session_key: NonEmptyString.optional(),
    subagent_id: NonEmptyString.optional(),
    payload: z
      .object({
        run: ExecutionRun,
        steps: z.array(ExecutionStep),
        attempts: z.array(ExecutionAttempt),
      })
      .strict(),
  })
  .strict();
export type TranscriptRunEvent = z.infer<typeof TranscriptRunEvent>;

export const TranscriptApprovalEvent = z
  .object({
    event_id: NonEmptyString,
    kind: z.literal("approval"),
    occurred_at: DateTimeSchema,
    session_key: NonEmptyString,
    parent_session_key: NonEmptyString.optional(),
    subagent_id: NonEmptyString.optional(),
    payload: z
      .object({
        approval: Approval,
      })
      .strict(),
  })
  .strict();
export type TranscriptApprovalEvent = z.infer<typeof TranscriptApprovalEvent>;

export const TranscriptSubagentEvent = z
  .object({
    event_id: NonEmptyString,
    kind: z.literal("subagent"),
    occurred_at: DateTimeSchema,
    session_key: NonEmptyString,
    parent_session_key: NonEmptyString.optional(),
    subagent_id: NonEmptyString.optional(),
    payload: z
      .object({
        phase: z.enum(["spawned", "closed"]),
        subagent: Subagent,
      })
      .strict(),
  })
  .strict();
export type TranscriptSubagentEvent = z.infer<typeof TranscriptSubagentEvent>;

export const TranscriptTimelineEvent = z.discriminatedUnion("kind", [
  TranscriptMessageEvent,
  TranscriptRunEvent,
  TranscriptApprovalEvent,
  TranscriptSubagentEvent,
]);
export type TranscriptTimelineEvent = z.infer<typeof TranscriptTimelineEvent>;

export const WsTranscriptListPayload = z
  .object({
    agent_key: AgentKey.optional(),
    channel: NonEmptyString.optional(),
    archived: z.boolean().optional(),
    active_only: z.boolean().optional(),
    limit: z.number().int().positive().max(200).optional(),
    cursor: NonEmptyString.optional(),
  })
  .strict();
export type WsTranscriptListPayload = z.infer<typeof WsTranscriptListPayload>;

export const WsTranscriptListRequest = WsRequestEnvelope.extend({
  type: z.literal("transcript.list"),
  payload: WsTranscriptListPayload,
});
export type WsTranscriptListRequest = z.infer<typeof WsTranscriptListRequest>;

export const WsTranscriptListResult = z
  .object({
    sessions: z.array(TranscriptSessionSummary),
    next_cursor: NonEmptyString.nullable().optional(),
  })
  .strict();
export type WsTranscriptListResult = z.infer<typeof WsTranscriptListResult>;

export const WsTranscriptListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("transcript.list"),
  result: WsTranscriptListResult,
});
export type WsTranscriptListResponseOkEnvelope = z.infer<typeof WsTranscriptListResponseOkEnvelope>;

export const WsTranscriptListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("transcript.list"),
});
export type WsTranscriptListResponseErrEnvelope = z.infer<
  typeof WsTranscriptListResponseErrEnvelope
>;

export const WsTranscriptGetPayload = z
  .object({
    session_key: NonEmptyString,
  })
  .strict();
export type WsTranscriptGetPayload = z.infer<typeof WsTranscriptGetPayload>;

export const WsTranscriptGetRequest = WsRequestEnvelope.extend({
  type: z.literal("transcript.get"),
  payload: WsTranscriptGetPayload,
});
export type WsTranscriptGetRequest = z.infer<typeof WsTranscriptGetRequest>;

export const WsTranscriptGetResult = z
  .object({
    root_session_key: NonEmptyString,
    focus_session_key: NonEmptyString,
    sessions: z.array(TranscriptSessionSummary),
    events: z.array(TranscriptTimelineEvent),
  })
  .strict();
export type WsTranscriptGetResult = z.infer<typeof WsTranscriptGetResult>;

export const WsTranscriptGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("transcript.get"),
  result: WsTranscriptGetResult,
});
export type WsTranscriptGetResponseOkEnvelope = z.infer<typeof WsTranscriptGetResponseOkEnvelope>;

export const WsTranscriptGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("transcript.get"),
});
export type WsTranscriptGetResponseErrEnvelope = z.infer<typeof WsTranscriptGetResponseErrEnvelope>;
