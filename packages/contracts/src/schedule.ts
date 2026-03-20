import { z } from "zod";
import { ActionPrimitive } from "./planner.js";

export const ScheduleKind = z.enum(["heartbeat", "cron"]);
export type ScheduleKind = z.infer<typeof ScheduleKind>;

export const ScheduleDeliveryMode = z.enum(["quiet", "notify"]);
export type ScheduleDeliveryMode = z.infer<typeof ScheduleDeliveryMode>;

export const ScheduleCadence = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("interval"),
      interval_ms: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("cron"),
      expression: z.string().trim().min(1),
      timezone: z.string().trim().min(1),
    })
    .strict(),
]);
export type ScheduleCadence = z.infer<typeof ScheduleCadence>;

export const ScheduleExecution = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("agent_turn"),
      instruction: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("playbook"),
      playbook_id: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("steps"),
      steps: z.array(ActionPrimitive).min(1),
    })
    .strict(),
]);
export type ScheduleExecution = z.infer<typeof ScheduleExecution>;

export const ScheduleRecord = z
  .object({
    schedule_id: z.string(),
    watcher_key: z.string(),
    kind: ScheduleKind,
    enabled: z.boolean(),
    cadence: ScheduleCadence,
    execution: ScheduleExecution,
    delivery: z.object({ mode: ScheduleDeliveryMode }).strict(),
    seeded_default: z.boolean(),
    deleted: z.boolean(),
    target_scope: z
      .object({
        agent_key: z.string(),
        workspace_key: z.string(),
      })
      .strict(),
    created_at: z.string(),
    updated_at: z.string(),
    last_fired_at: z.string().nullable(),
    next_fire_at: z.string().nullable(),
  })
  .strict();
export type ScheduleRecord = z.infer<typeof ScheduleRecord>;

export const ScheduleListResponse = z.object({ schedules: z.array(ScheduleRecord) }).strict();
export type ScheduleListResponse = z.infer<typeof ScheduleListResponse>;

export const ScheduleSingleResponse = z.object({ schedule: ScheduleRecord }).strict();
export type ScheduleSingleResponse = z.infer<typeof ScheduleSingleResponse>;

export const ScheduleDeleteResponse = z
  .object({
    schedule_id: z.string(),
    deleted: z.literal(true),
  })
  .strict();
export type ScheduleDeleteResponse = z.infer<typeof ScheduleDeleteResponse>;
