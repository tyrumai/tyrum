import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { AgentId, TenantId, TyrumKey, WorkspaceId } from "./keys.js";
import { SubagentId } from "./subagent.js";
import { WorkItemId } from "./workboard.js";

export const WorkClarificationId = UuidSchema;
export type WorkClarificationId = z.infer<typeof WorkClarificationId>;

export const WorkClarificationStatus = z.enum(["open", "answered", "cancelled"]);
export type WorkClarificationStatus = z.infer<typeof WorkClarificationStatus>;

export const WorkClarification = z
  .object({
    clarification_id: WorkClarificationId,
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    work_item_id: WorkItemId,
    status: WorkClarificationStatus,
    question: z.string().trim().min(1),
    requested_by_subagent_id: SubagentId.optional(),
    requested_for_session_key: TyrumKey,
    requested_at: DateTimeSchema,
    answered_at: DateTimeSchema.nullable().optional(),
    answer_text: z.string().trim().min(1).optional(),
    answered_by_session_key: TyrumKey.optional(),
    updated_at: DateTimeSchema,
  })
  .strict();
export type WorkClarification = z.infer<typeof WorkClarification>;
