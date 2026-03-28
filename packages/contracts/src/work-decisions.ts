import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { TurnId } from "./execution.js";
import { AgentId, TenantId, WorkspaceId } from "./keys.js";
import { WorkArtifactId } from "./work-artifacts.js";
import { WorkItemId } from "./workboard.js";

export const DecisionRecordId = UuidSchema;
export type DecisionRecordId = z.infer<typeof DecisionRecordId>;

export const DecisionRecord = z
  .object({
    decision_id: DecisionRecordId,
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    work_item_id: WorkItemId.nullable().optional(),
    question: z.string().trim().min(1),
    chosen: z.string().trim().min(1),
    alternatives: z.array(z.string().trim().min(1)).default([]),
    rationale_md: z.string().trim().min(1),
    input_artifact_ids: z.array(WorkArtifactId).default([]),
    created_at: DateTimeSchema,
    created_by_turn_id: TurnId.optional(),
    created_by_subagent_id: UuidSchema.optional(),
  })
  .strict();
export type DecisionRecord = z.infer<typeof DecisionRecord>;
