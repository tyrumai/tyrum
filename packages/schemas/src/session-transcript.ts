import { z } from "zod";
import { ApprovalStatus } from "./approval.js";
import { DateTimeSchema } from "./common.js";
import { AgentId, ChannelKey, ThreadId, WorkspaceId } from "./keys.js";
import { ExecutionRunId } from "./execution.js";

export const SessionTranscriptTextRole = z.enum(["assistant", "user", "system"]);
export type SessionTranscriptTextRole = z.infer<typeof SessionTranscriptTextRole>;

export const SessionTranscriptTextItem = z
  .object({
    kind: z.literal("text"),
    id: z.string().trim().min(1),
    role: SessionTranscriptTextRole,
    content: z.string(),
    created_at: DateTimeSchema,
  })
  .strict();
export type SessionTranscriptTextItem = z.infer<typeof SessionTranscriptTextItem>;

export const SessionTranscriptReasoningItem = z
  .object({
    kind: z.literal("reasoning"),
    id: z.string().trim().min(1),
    content: z.string(),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();
export type SessionTranscriptReasoningItem = z.infer<typeof SessionTranscriptReasoningItem>;

export const SessionTranscriptToolStatus = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);
export type SessionTranscriptToolStatus = z.infer<typeof SessionTranscriptToolStatus>;

export const SessionTranscriptToolItem = z
  .object({
    kind: z.literal("tool"),
    id: z.string().trim().min(1),
    tool_id: z.string().trim().min(1),
    tool_call_id: z.string().trim().min(1),
    status: SessionTranscriptToolStatus,
    summary: z.string().default(""),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
    duration_ms: z.number().int().nonnegative().optional(),
    error: z.string().trim().min(1).optional(),
    run_id: ExecutionRunId.optional(),
    agent_id: AgentId.optional(),
    workspace_id: WorkspaceId.optional(),
    channel: ChannelKey.optional(),
    thread_id: ThreadId.optional(),
  })
  .strict();
export type SessionTranscriptToolItem = z.infer<typeof SessionTranscriptToolItem>;

export const SessionTranscriptApprovalItem = z
  .object({
    kind: z.literal("approval"),
    id: z.string().trim().min(1),
    approval_id: z.string().trim().min(1),
    tool_call_id: z.string().trim().min(1).optional(),
    status: ApprovalStatus,
    title: z.string().default("Approval required"),
    detail: z.string().default(""),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
    run_id: ExecutionRunId.optional(),
  })
  .strict();
export type SessionTranscriptApprovalItem = z.infer<typeof SessionTranscriptApprovalItem>;

export const SessionTranscriptItem = z.discriminatedUnion("kind", [
  SessionTranscriptTextItem,
  SessionTranscriptReasoningItem,
  SessionTranscriptToolItem,
  SessionTranscriptApprovalItem,
]);
export type SessionTranscriptItem = z.infer<typeof SessionTranscriptItem>;

export const SessionTranscriptTextPreview = z
  .object({
    role: SessionTranscriptTextRole,
    content: z.string(),
  })
  .strict();
export type SessionTranscriptTextPreview = z.infer<typeof SessionTranscriptTextPreview>;
