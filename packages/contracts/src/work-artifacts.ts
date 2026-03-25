import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { TurnId } from "./execution.js";
import { AgentId, TenantId, WorkspaceId } from "./keys.js";
import { WorkItemId } from "./workboard.js";

export const WorkArtifactId = UuidSchema;
export type WorkArtifactId = z.infer<typeof WorkArtifactId>;

export const WorkArtifactKind = z.enum([
  "candidate_plan",
  "hypothesis",
  "risk",
  "tool_intent",
  "verification_report",
  "jury_opinion",
  "result_summary",
  "other",
]);
export type WorkArtifactKind = z.infer<typeof WorkArtifactKind>;

export const WorkArtifact = z
  .object({
    artifact_id: WorkArtifactId,
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    work_item_id: WorkItemId.nullable().optional(),
    kind: WorkArtifactKind,
    title: z.string().trim().min(1),
    body_md: z.string().optional(),
    refs: z.array(z.string().trim().min(1)).default([]),
    confidence: z.number().min(0).max(1).optional(),
    created_at: DateTimeSchema,
    created_by_turn_id: TurnId.optional(),
    created_by_subagent_id: UuidSchema.optional(),
    provenance_json: z.unknown().optional(),
  })
  .strict();
export type WorkArtifact = z.infer<typeof WorkArtifact>;
