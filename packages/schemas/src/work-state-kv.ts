import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { ExecutionRunId } from "./execution.js";
import { AgentId, TenantId, WorkspaceId } from "./keys.js";
import { WorkItemId } from "./workboard.js";

export const WorkStateKVKey = z.string().trim().min(1);
export type WorkStateKVKey = z.infer<typeof WorkStateKVKey>;

export const WorkStateKVScope = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("agent"),
      tenant_id: TenantId,
      agent_id: AgentId,
      workspace_id: WorkspaceId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("work_item"),
      tenant_id: TenantId,
      agent_id: AgentId,
      workspace_id: WorkspaceId,
      work_item_id: WorkItemId,
    })
    .strict(),
]);
export type WorkStateKVScope = z.infer<typeof WorkStateKVScope>;

export const AgentStateKVEntry = z
  .object({
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    key: WorkStateKVKey,
    value_json: z.unknown(),
    updated_at: DateTimeSchema,
    updated_by_run_id: ExecutionRunId.optional(),
    provenance_json: z.unknown().optional(),
  })
  .strict();
export type AgentStateKVEntry = z.infer<typeof AgentStateKVEntry>;

export const WorkItemStateKVEntry = z
  .object({
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    work_item_id: WorkItemId,
    key: WorkStateKVKey,
    value_json: z.unknown(),
    updated_at: DateTimeSchema,
    updated_by_run_id: ExecutionRunId.optional(),
    provenance_json: z.unknown().optional(),
  })
  .strict();
export type WorkItemStateKVEntry = z.infer<typeof WorkItemStateKVEntry>;
