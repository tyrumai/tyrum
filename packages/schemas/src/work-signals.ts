import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { AgentId, TenantId, WorkspaceId } from "./keys.js";
import { WorkItemId } from "./workboard.js";

export const WorkSignalId = UuidSchema;
export type WorkSignalId = z.infer<typeof WorkSignalId>;

export const WorkSignalTriggerKind = z.enum(["time", "event"]);
export type WorkSignalTriggerKind = z.infer<typeof WorkSignalTriggerKind>;

export const WorkSignalStatus = z.enum(["active", "paused", "fired", "resolved", "cancelled"]);
export type WorkSignalStatus = z.infer<typeof WorkSignalStatus>;

export const WorkSignal = z
  .object({
    signal_id: WorkSignalId,
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    work_item_id: WorkItemId.nullable().optional(),
    trigger_kind: WorkSignalTriggerKind,
    trigger_spec_json: z.unknown(),
    payload_json: z.unknown().optional(),
    status: WorkSignalStatus,
    created_at: DateTimeSchema,
    last_fired_at: DateTimeSchema.nullable().optional(),
  })
  .strict();
export type WorkSignal = z.infer<typeof WorkSignal>;
