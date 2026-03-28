import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { DesktopEnvironmentId } from "./desktop-environment.js";
import { AgentId, NodeId, TenantId, WorkspaceId } from "./keys.js";
import { WorkItemId, WorkItemTaskId } from "./workboard.js";

export const SubagentId = UuidSchema;
export type SubagentId = z.infer<typeof SubagentId>;

export const SubagentStatus = z.enum(["running", "paused", "closing", "closed", "failed"]);
export type SubagentStatus = z.infer<typeof SubagentStatus>;

export const SubagentConversationKey = z
  .string()
  .trim()
  .regex(
    /^agent:[^:]+:subagent:[^:]+$/,
    "subagent conversation key must be agent:<agentId>:subagent:<subagentId>",
  );
export type SubagentConversationKey = z.infer<typeof SubagentConversationKey>;

export const SubagentDescriptor = z
  .object({
    subagent_id: SubagentId,
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    parent_conversation_key: z.string().trim().min(1).optional(),
    work_item_id: WorkItemId.optional(),
    work_item_task_id: WorkItemTaskId.optional(),
    execution_profile: z.string().trim().min(1),
    conversation_key: SubagentConversationKey,
    status: SubagentStatus,
    desktop_environment_id: DesktopEnvironmentId.optional(),
    attached_node_id: NodeId.optional(),
    created_at: DateTimeSchema,
    last_heartbeat_at: DateTimeSchema.nullable().optional(),
    updated_at: DateTimeSchema.optional(),
    closed_at: DateTimeSchema.nullable().optional(),
  })
  .strict();
export type SubagentDescriptor = z.infer<typeof SubagentDescriptor>;

export const Subagent = SubagentDescriptor;
export type Subagent = z.infer<typeof Subagent>;
