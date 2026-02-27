import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { AgentId, Lane, TenantId, WorkspaceId } from "./keys.js";
import { WorkItemId, WorkItemTaskId } from "./workboard.js";

export const SubagentId = UuidSchema;
export type SubagentId = z.infer<typeof SubagentId>;

export const SubagentStatus = z.enum(["running", "closing", "closed", "failed"]);
export type SubagentStatus = z.infer<typeof SubagentStatus>;

export const SubagentSessionKey = z
  .string()
  .trim()
  .regex(
    /^agent:[^:]+:subagent:[^:]+$/,
    "subagent session key must be agent:<agentId>:subagent:<subagentId>",
  );
export type SubagentSessionKey = z.infer<typeof SubagentSessionKey>;

export const SubagentDescriptor = z
  .object({
    subagent_id: SubagentId,
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    work_item_id: WorkItemId.optional(),
    work_item_task_id: WorkItemTaskId.optional(),
    execution_profile: z.string().trim().min(1),
    session_key: SubagentSessionKey,
    lane: Lane.default("subagent"),
    status: SubagentStatus,
    created_at: DateTimeSchema,
    last_heartbeat_at: DateTimeSchema.nullable().optional(),
    updated_at: DateTimeSchema.optional(),
    closed_at: DateTimeSchema.nullable().optional(),
  })
  .strict();
export type SubagentDescriptor = z.infer<typeof SubagentDescriptor>;

export const Subagent = SubagentDescriptor;
export type Subagent = z.infer<typeof Subagent>;
